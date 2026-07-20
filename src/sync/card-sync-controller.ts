import { normalizeCardData } from "../crypto";
import {
  loadLocalAssetRecord,
  loadDeletedCardEntries,
  loadMine,
  loadReceived,
  deleteMineCard,
  deleteReceivedEntry,
  saveLocalAssetRecord,
  upsertMineCard,
  upsertReceivedEntry,
  type LocalAssetRecord,
  type MineCard,
  type ReceivedEntry,
} from "../storage";
import type { BucketSyncClient, PullResult, PushResult } from "./bucket-sync-client";
import {
  CARD_SYNC_INDEX_OBJECT_ID,
  assetObjectId,
  buildCardSyncIndex,
  changedCardSyncIndexEntries,
  cardSyncIndexesEqual,
  checkpointHeadAfterRemoteApply,
  hashCardAssetDataUrl,
  mergeCardRecord,
  mergeCardSyncIndexes,
  parseCardSyncIndex,
  type CardSyncAsset,
  type CardSyncIndex,
  type CardSyncIndexEntry,
  type CardSyncIndexRecord,
  type CardSyncObjectId,
} from "./model";

export type CardSyncStatus = {
  connected: boolean;
  running: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  warnings: string[];
};

export type CardSyncResult = {
  status: CardSyncStatus;
  changed: boolean;
  pulled: number;
  pushed: number;
  warnings: string[];
};

type SyncHeadStore = Record<string, string | null>;
type SyncClient = Pick<BucketSyncClient, "pullCurrent" | "push" | "startStream" | "stopStream" | "dispose">;

const SYNC_HEADS_KEY = "mycard.sync.heads";
const SYNC_INDEX_KEY = "mycard.sync.index";
const DEFAULT_STATUS: CardSyncStatus = { connected: false, running: false, lastSyncedAt: null, lastError: null, warnings: [] };
const EMPTY_INDEX: CardSyncIndex = { v: 1, updatedAt: "1970-01-01T00:00:00.000Z", entries: [] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSyncHeads(value: string | null): SyncHeadStore {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!isRecord(parsed)) return {};
    const out: SyncHeadStore = {};
    for (const [key, head] of Object.entries(parsed)) {
      if (typeof key === "string" && (typeof head === "string" || head === null)) out[key] = head;
    }
    return out;
  } catch {
    return {};
  }
}

function loadHeads(): SyncHeadStore {
  return parseSyncHeads(localStorage.getItem(SYNC_HEADS_KEY));
}

function saveHeads(heads: SyncHeadStore): void {
  localStorage.setItem(SYNC_HEADS_KEY, JSON.stringify(heads));
}

function parseCardSyncIndexRecord(value: string | null): CardSyncIndexRecord | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!isRecord(parsed)) return null;
    const index = parseCardSyncIndex(parsed.index);
    if (!index) return null;
    return { index, headVersionId: typeof parsed.headVersionId === "string" ? parsed.headVersionId : null };
  } catch {
    return null;
  }
}

function loadIndexRecord(): CardSyncIndexRecord | null {
  return parseCardSyncIndexRecord(localStorage.getItem(SYNC_INDEX_KEY));
}

function saveIndexRecord(record: CardSyncIndexRecord): void {
  localStorage.setItem(SYNC_INDEX_KEY, JSON.stringify(record));
  const heads = loadHeads();
  heads[CARD_SYNC_INDEX_OBJECT_ID] = record.headVersionId;
  saveHeads(heads);
}

function payloadsEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function parseMineCard(value: unknown): MineCard | null {
  if (!isRecord(value) || typeof value.updatedAt !== "string" || Number.isNaN(Date.parse(value.updatedAt))) return null;
  const data = normalizeCardData(value);
  return data ? { ...data, updatedAt: value.updatedAt } : null;
}

function parseReceivedEntry(value: unknown): ReceivedEntry | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.receivedAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    Number.isNaN(Date.parse(value.receivedAt)) ||
    Number.isNaN(Date.parse(value.updatedAt))
  ) {
    return null;
  }
  const data = normalizeCardData(value.data);
  return data ? { id: value.id, receivedAt: value.receivedAt, updatedAt: value.updatedAt, data } : null;
}

function parseSyncAsset(value: unknown): CardSyncAsset | null {
  if (!isRecord(value) || value.v !== 1) return null;
  if (typeof value.id !== "string" || typeof value.mediaType !== "string" || typeof value.contentHash !== "string" || typeof value.dataUrl !== "string") {
    return null;
  }
  if (typeof value.createdAt !== "string" || Number.isNaN(Date.parse(value.createdAt))) return null;
  if (!/^data:image\/[-+.\w]+;base64,/i.test(value.dataUrl)) return null;
  return { v: 1, id: value.id, mediaType: value.mediaType, contentHash: value.contentHash, dataUrl: value.dataUrl, createdAt: value.createdAt };
}

async function toSyncAsset(record: LocalAssetRecord, createdAt = new Date().toISOString()): Promise<CardSyncAsset> {
  return {
    v: 1,
    id: record.id,
    mediaType: record.mediaType,
    contentHash: await hashCardAssetDataUrl(record.dataUrl),
    dataUrl: record.dataUrl,
    createdAt,
  };
}

function assetIdsForEntry(entry: CardSyncIndexEntry): string[] {
  return entry.deleted ? [] : entry.assetIds || [];
}

export function createCardSyncController(client: SyncClient) {
  let status: CardSyncStatus = { ...DEFAULT_STATUS, connected: true };

  const setStatus = (patch: Partial<CardSyncStatus>): CardSyncStatus => {
    status = { ...status, ...patch };
    return status;
  };

  async function pushWithConflictMerge<T>(
    objectId: CardSyncObjectId,
    localPayload: T,
    parse: (value: unknown) => T | null,
    merge: (local: T, remote: T) => T,
  ): Promise<{ payload: T; headVersionId: string | null; pulled: number; pushed: number }> {
    const heads = loadHeads();
    let expectedHeadVersionId = heads[objectId] ?? null;
    let parentVersionIds = expectedHeadVersionId ? [expectedHeadVersionId] : [];
    let payload = localPayload;
    let pulled = 0;
    let pushed = 0;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result: PushResult = await client.push(objectId, payload, { expectedHeadVersionId, parentVersionIds });
      if (result.ok) {
        heads[objectId] = result.versionId;
        saveHeads(heads);
        return { payload, headVersionId: result.versionId, pulled, pushed: pushed + 1 };
      }

      const remote: PullResult<T> = await client.pullCurrent(objectId, parse);
      pulled += remote.found ? 1 : 0;
      if (!remote.found) {
        expectedHeadVersionId = null;
        parentVersionIds = [];
        continue;
      }
      payload = merge(payload, remote.payload);
      expectedHeadVersionId = remote.versionId;
      parentVersionIds = [remote.versionId];
    }
    throw new Error(`sync conflict did not converge for ${objectId}`);
  }

  async function buildLocalIndex(): Promise<CardSyncIndex> {
    return buildCardSyncIndex(await loadMine(), await loadReceived(), new Date().toISOString(), await loadDeletedCardEntries());
  }

  async function pushIndex(index: CardSyncIndex, headVersionId: string | null): Promise<{ ok: true; pushed: number; versionId: string | null } | { ok: false }> {
    if (index.entries.length === 0 && headVersionId === null) {
      saveIndexRecord({ index, headVersionId: null });
      return { ok: true, pushed: 0, versionId: null };
    }
    const result = await client.push(CARD_SYNC_INDEX_OBJECT_ID, index, {
      expectedHeadVersionId: headVersionId,
      parentVersionIds: headVersionId ? [headVersionId] : [],
    });
    if (!result.ok) return { ok: false };
    saveIndexRecord({ index, headVersionId: result.versionId });
    return { ok: true, pushed: 1, versionId: result.versionId };
  }

  async function syncMine(entry: CardSyncIndexEntry): Promise<{ pulled: number; pushed: number; changed: boolean }> {
    const local = (await loadMine()).find((card) => card.id === entry.id);
    if (!local) {
      const remote = await client.pullCurrent(entry.objectId, parseMineCard);
      if (!remote.found) return { pulled: 0, pushed: 0, changed: false };
      await upsertMineCard(remote.payload);
      const heads = loadHeads();
      heads[entry.objectId] = remote.versionId;
      saveHeads(heads);
      return { pulled: 1, pushed: 0, changed: true };
    }
    const remote = await client.pullCurrent(entry.objectId, parseMineCard);
    if (remote.found) {
      const heads = loadHeads();
      heads[entry.objectId] = remote.versionId;
      saveHeads(heads);
      const merged = mergeCardRecord(local, remote.payload);
      const localChanged = !payloadsEqual(merged, local);
      if (payloadsEqual(merged, remote.payload)) {
        if (localChanged) await upsertMineCard(merged);
        return { pulled: 1, pushed: 0, changed: localChanged };
      }
    }
    const result = await pushWithConflictMerge(entry.objectId, local, parseMineCard, mergeCardRecord);
    if (result.payload !== local) await upsertMineCard(result.payload);
    return { pulled: (remote.found ? 1 : 0) + result.pulled, pushed: result.pushed, changed: result.payload !== local };
  }

  async function syncReceived(entry: CardSyncIndexEntry): Promise<{ pulled: number; pushed: number; changed: boolean }> {
    const local = (await loadReceived()).find((item) => item.id === entry.id);
    if (!local) {
      const remote = await client.pullCurrent(entry.objectId, parseReceivedEntry);
      if (!remote.found) return { pulled: 0, pushed: 0, changed: false };
      await upsertReceivedEntry(remote.payload);
      const heads = loadHeads();
      heads[entry.objectId] = remote.versionId;
      saveHeads(heads);
      return { pulled: 1, pushed: 0, changed: true };
    }
    const remote = await client.pullCurrent(entry.objectId, parseReceivedEntry);
    if (remote.found) {
      const heads = loadHeads();
      heads[entry.objectId] = remote.versionId;
      saveHeads(heads);
      const merged = mergeCardRecord(local, remote.payload);
      const localChanged = !payloadsEqual(merged, local);
      if (payloadsEqual(merged, remote.payload)) {
        if (localChanged) await upsertReceivedEntry(merged);
        return { pulled: 1, pushed: 0, changed: localChanged };
      }
    }
    const result = await pushWithConflictMerge(entry.objectId, local, parseReceivedEntry, mergeCardRecord);
    if (result.payload !== local) await upsertReceivedEntry(result.payload);
    return { pulled: (remote.found ? 1 : 0) + result.pulled, pushed: result.pushed, changed: result.payload !== local };
  }

  async function pullRemoteMine(entry: CardSyncIndexEntry): Promise<{ pulled: number; changed: boolean; applied: boolean }> {
    const remote = await client.pullCurrent(entry.objectId, parseMineCard);
    if (!remote.found) return { pulled: 0, changed: false, applied: false };
    const heads = loadHeads();
    heads[entry.objectId] = remote.versionId;
    saveHeads(heads);
    const local = (await loadMine()).find((card) => card.id === entry.id);
    const merged = local ? mergeCardRecord(local, remote.payload) : remote.payload;
    const localChanged = !local || !payloadsEqual(merged, local);
    if (localChanged) await upsertMineCard(merged);
    return { pulled: 1, changed: localChanged, applied: true };
  }

  async function pullRemoteReceived(entry: CardSyncIndexEntry): Promise<{ pulled: number; changed: boolean; applied: boolean }> {
    const remote = await client.pullCurrent(entry.objectId, parseReceivedEntry);
    if (!remote.found) return { pulled: 0, changed: false, applied: false };
    const heads = loadHeads();
    heads[entry.objectId] = remote.versionId;
    saveHeads(heads);
    const local = (await loadReceived()).find((item) => item.id === entry.id);
    const merged = local ? mergeCardRecord(local, remote.payload) : remote.payload;
    const localChanged = !local || !payloadsEqual(merged, local);
    if (localChanged) await upsertReceivedEntry(merged);
    return { pulled: 1, changed: localChanged, applied: true };
  }

  async function applyDeletedEntry(entry: CardSyncIndexEntry): Promise<{ changed: boolean }> {
    if (entry.kind === "mine") {
      const existed = (await loadMine()).some((card) => card.id === entry.id);
      await deleteMineCard(entry.id, entry.updatedAt);
      return { changed: existed };
    }
    const existed = (await loadReceived()).some((item) => item.id === entry.id);
    await deleteReceivedEntry(entry.id, entry.updatedAt);
    return { changed: existed };
  }

  async function syncLocalEntry(entry: CardSyncIndexEntry): Promise<{ pulled: number; pushed: number; changed: boolean; warnings: string[] }> {
    const warnings: string[] = [];
    let pulled = 0;
    let pushed = 0;
    let changed = false;
    if (entry.deleted) return { pulled, pushed, changed, warnings };

    const recordResult = entry.kind === "mine" ? await syncMine(entry) : await syncReceived(entry);
    pulled += recordResult.pulled;
    pushed += recordResult.pushed;
    changed = changed || recordResult.changed;
    for (const assetId of assetIdsForEntry(entry)) {
      const assetResult = await syncAsset(assetId);
      pulled += assetResult.pulled;
      pushed += assetResult.pushed;
      changed = changed || assetResult.changed;
      if (assetResult.warning) warnings.push(assetResult.warning);
    }
    return { pulled, pushed, changed, warnings };
  }

  async function applyRemoteEntry(entry: CardSyncIndexEntry): Promise<{ pulled: number; pushed: number; changed: boolean; applied: boolean; warnings: string[] }> {
    const warnings: string[] = [];
    let pulled = 0;
    let pushed = 0;
    let changed = false;
    if (entry.deleted) {
      const deletedResult = await applyDeletedEntry(entry);
      return { pulled, pushed, changed: deletedResult.changed, applied: true, warnings };
    }

    const recordResult = entry.kind === "mine" ? await pullRemoteMine(entry) : await pullRemoteReceived(entry);
    pulled += recordResult.pulled;
    changed = changed || recordResult.changed;
    if (!recordResult.applied) {
      warnings.push(`${entry.objectId} is listed in remote index but its payload is not available yet`);
      return { pulled, pushed, changed, applied: false, warnings };
    }
    for (const assetId of assetIdsForEntry(entry)) {
      const assetResult = await pullRemoteAsset(assetId);
      pulled += assetResult.pulled;
      changed = changed || assetResult.changed;
      if (assetResult.warning) warnings.push(assetResult.warning);
      if (!assetResult.applied) {
        warnings.push(`asset:${assetId} is listed in remote index but its payload is not available yet`);
        return { pulled, pushed, changed, applied: false, warnings };
      }
    }
    return { pulled, pushed, changed, applied: true, warnings };
  }

  async function syncAsset(assetId: string): Promise<{ pulled: number; pushed: number; changed: boolean; warning?: string }> {
    const objectId = assetObjectId(assetId);
    const local = await loadLocalAssetRecord(assetId);
    const remote = await client.pullCurrent(objectId, parseSyncAsset);
    let pulled = remote.found ? 1 : 0;
    if (!local && remote.found) {
      await saveLocalAssetRecord({ id: remote.payload.id, mediaType: remote.payload.mediaType, dataUrl: remote.payload.dataUrl });
      const heads = loadHeads();
      heads[objectId] = remote.versionId;
      saveHeads(heads);
      return { pulled, pushed: 0, changed: true };
    }
    if (!local) return { pulled, pushed: 0, changed: false };

    const localPayload = await toSyncAsset(local);
    if (remote.found) {
      const heads = loadHeads();
      heads[objectId] = remote.versionId;
      saveHeads(heads);
      if (remote.payload.contentHash === localPayload.contentHash) return { pulled, pushed: 0, changed: false };
      return { pulled, pushed: 0, changed: false, warning: `asset:${assetId} content conflict; kept local copy` };
    }

    const heads = loadHeads();
    const expectedHeadVersionId = heads[objectId] ?? null;
    const result = await client.push(objectId, localPayload, {
      expectedHeadVersionId,
      parentVersionIds: expectedHeadVersionId ? [expectedHeadVersionId] : [],
    });
    if (result.ok) {
      heads[objectId] = result.versionId;
      saveHeads(heads);
      return { pulled, pushed: 1, changed: false };
    }
    const conflictedRemote = await client.pullCurrent(objectId, parseSyncAsset);
    pulled += conflictedRemote.found ? 1 : 0;
    if (!conflictedRemote.found) return { pulled, pushed: 0, changed: false, warning: `asset:${assetId} push conflicted but remote payload is not available yet` };
    heads[objectId] = conflictedRemote.versionId;
    saveHeads(heads);
    if (conflictedRemote.payload.contentHash === localPayload.contentHash) {
      return { pulled, pushed: 0, changed: false };
    }
    return { pulled, pushed: 0, changed: false, warning: `asset:${assetId} content conflict; kept local copy` };
  }

  async function pullRemoteAsset(assetId: string): Promise<{ pulled: number; changed: boolean; applied: boolean; warning?: string }> {
    const objectId = assetObjectId(assetId);
    const remote = await client.pullCurrent(objectId, parseSyncAsset);
    if (!remote.found) return { pulled: 0, changed: false, applied: false };
    const heads = loadHeads();
    heads[objectId] = remote.versionId;
    saveHeads(heads);
    const local = await loadLocalAssetRecord(assetId);
    const localHash = local ? await hashCardAssetDataUrl(local.dataUrl) : null;
    if (localHash === remote.payload.contentHash) return { pulled: 1, changed: false, applied: true };
    if (local) {
      return { pulled: 1, changed: false, applied: true, warning: `asset:${assetId} content conflict; kept local copy` };
    }
    await saveLocalAssetRecord({ id: remote.payload.id, mediaType: remote.payload.mediaType, dataUrl: remote.payload.dataUrl });
    return {
      pulled: 1,
      changed: true,
      applied: true,
    };
  }

  async function syncNow(): Promise<CardSyncResult> {
    setStatus({ running: true, lastError: null, warnings: [] });
    const warnings: string[] = [];
    let pulled = 0;
    let pushed = 0;
    let changed = false;
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const localRecord = loadIndexRecord();
        const previousIndexHeadVersionId = localRecord?.headVersionId ?? null;
        const baseIndex = localRecord?.index || EMPTY_INDEX;
        let skippedRemotePayloads = false;
        let localIndex = await buildLocalIndex();
        const localEntries = changedCardSyncIndexEntries(baseIndex, localIndex);

        for (const entry of localEntries) {
          const result = await syncLocalEntry(entry);
          pulled += result.pulled;
          pushed += result.pushed;
          changed = changed || result.changed;
          warnings.push(...result.warnings);
        }

        localIndex = await buildLocalIndex();
        const remote = await client.pullCurrent(CARD_SYNC_INDEX_OBJECT_ID, parseCardSyncIndex);
        pulled += remote.found ? 1 : 0;
        const remoteIndex = remote.found ? remote.payload : EMPTY_INDEX;
        const remoteChanged = remote.found && localRecord?.headVersionId !== remote.versionId;
        const mergedIndex = mergeCardSyncIndexes(localIndex, remoteIndex);
        const remoteEntries = remoteChanged ? changedCardSyncIndexEntries(localIndex, mergedIndex) : [];

        for (const entry of remoteEntries) {
          const result = await applyRemoteEntry(entry);
          pulled += result.pulled;
          pushed += result.pushed;
          changed = changed || result.changed;
          warnings.push(...result.warnings);
          if (!result.applied) {
            skippedRemotePayloads = true;
          }
        }

        const finalIndex = mergeCardSyncIndexes(await buildLocalIndex(), mergedIndex);
        if (remote.found && cardSyncIndexesEqual(finalIndex, remote.payload)) {
          saveIndexRecord({
            index: finalIndex,
            headVersionId: checkpointHeadAfterRemoteApply(remote.versionId, previousIndexHeadVersionId, skippedRemotePayloads),
          });
          const nextStatus = setStatus({ connected: true, running: false, lastError: null, lastSyncedAt: new Date().toISOString(), warnings });
          return { status: nextStatus, changed, pulled, pushed, warnings };
        }

        const publish = await pushIndex(finalIndex, remote.found ? remote.versionId : null);
        if (publish.ok) {
          pushed += publish.pushed;
          if (skippedRemotePayloads) {
            saveIndexRecord({ index: finalIndex, headVersionId: previousIndexHeadVersionId });
          }
          const nextStatus = setStatus({ connected: true, running: false, lastError: null, lastSyncedAt: new Date().toISOString(), warnings });
          return { status: nextStatus, changed, pulled, pushed, warnings };
        }
      }
      throw new Error("index sync conflict did not converge");
    } catch (error) {
      const nextStatus = setStatus({ connected: false, running: false, lastError: error instanceof Error ? error.message : String(error), warnings });
      return { status: nextStatus, changed, pulled, pushed, warnings };
    }
  }

  function startRemoteHints(onHint: (objectId: string | null) => void, onError?: (error: unknown) => void): void {
    client.startStream([CARD_SYNC_INDEX_OBJECT_ID], onHint, onError);
  }

  function stop(): void {
    client.stopStream();
  }

  function dispose(): void {
    client.dispose();
  }

  return {
    status: () => ({ ...status }),
    syncNow,
    startRemoteHints,
    stop,
    dispose,
  };
}
