import type { CardData } from "../crypto";
import type { DeletedCardEntry, MineCard, ReceivedEntry } from "../storage";

export const CARD_SYNC_INDEX_OBJECT_ID = "index:cards";
export const CARD_SYNC_INDEX_VERSION = 1;
export const CARD_SYNC_ASSET_VERSION = 1;

export type CardSyncCardKind = "mine" | "received";
export type CardSyncCardObjectId = `mine:${string}` | `received:${string}`;
export type CardSyncAssetObjectId = `asset:${string}`;
export type CardSyncObjectId = typeof CARD_SYNC_INDEX_OBJECT_ID | CardSyncCardObjectId | CardSyncAssetObjectId;

export interface CardSyncIndexEntry {
  id: string;
  kind: CardSyncCardKind;
  objectId: CardSyncCardObjectId;
  updatedAt: string;
  receivedAt?: string;
  assetIds?: string[];
  deleted?: true;
}

export interface CardSyncIndex {
  v: typeof CARD_SYNC_INDEX_VERSION;
  updatedAt: string;
  entries: CardSyncIndexEntry[];
}

export interface CardSyncIndexRecord {
  index: CardSyncIndex;
  headVersionId: string | null;
}

export interface CardSyncAsset {
  v: typeof CARD_SYNC_ASSET_VERSION;
  id: string;
  mediaType: string;
  contentHash: string;
  dataUrl: string;
  createdAt: string;
}

export function checkpointHeadAfterRemoteApply(
  remoteHeadVersionId: string | null,
  previousHeadVersionId: string | null,
  skippedRemotePayloads: boolean,
): string | null {
  return skippedRemotePayloads ? previousHeadVersionId : remoteHeadVersionId;
}

export type CardSyncRecordPayload =
  | { kind: "mine"; card: MineCard }
  | { kind: "received"; entry: ReceivedEntry };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isCardObjectId(value: unknown, kind?: CardSyncCardKind): value is CardSyncCardObjectId {
  if (typeof value !== "string") return false;
  if (kind === "mine") return value.startsWith("mine:");
  if (kind === "received") return value.startsWith("received:");
  return value.startsWith("mine:") || value.startsWith("received:");
}

function uniqueStrings(values: unknown, max = 64): string[] | undefined {
  if (!Array.isArray(values)) return undefined;
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || !value || out.includes(value)) continue;
    out.push(value);
    if (out.length >= max) break;
  }
  return out.length ? out : undefined;
}

function parseIndexEntry(value: unknown): CardSyncIndexEntry | null {
  if (!isRecord(value)) return null;
  const { id, kind, objectId, updatedAt, receivedAt, deleted } = value;
  if (typeof id !== "string" || !id) return null;
  if (kind !== "mine" && kind !== "received") return null;
  if (!isCardObjectId(objectId, kind)) return null;
  if (!isIsoDate(updatedAt)) return null;
  if (receivedAt !== undefined && !isIsoDate(receivedAt)) return null;
  return {
    id,
    kind,
    objectId,
    updatedAt,
    ...(receivedAt ? { receivedAt } : {}),
    ...(uniqueStrings(value.assetIds) ? { assetIds: uniqueStrings(value.assetIds) } : {}),
    ...(deleted === true ? { deleted: true } : {}),
  };
}

export function parseCardSyncIndex(value: unknown): CardSyncIndex | null {
  if (!isRecord(value) || value.v !== CARD_SYNC_INDEX_VERSION || !isIsoDate(value.updatedAt) || !Array.isArray(value.entries)) {
    return null;
  }
  const entries = value.entries.map(parseIndexEntry).filter((entry): entry is CardSyncIndexEntry => entry !== null);
  return { v: CARD_SYNC_INDEX_VERSION, updatedAt: value.updatedAt, entries };
}

export function mineObjectId(cardId: string): `mine:${string}` {
  return `mine:${cardId}`;
}

export function receivedObjectId(entryId: string): `received:${string}` {
  return `received:${entryId}`;
}

export function assetObjectId(assetId: string): `asset:${string}` {
  return `asset:${assetId}`;
}

function assetIdsFromCard(data: CardData): string[] | undefined {
  const ids = (data.assets || [])
    .map((asset) => asset.sourceRef?.id || asset.id)
    .filter((id, idx, arr): id is string => typeof id === "string" && id.length > 0 && arr.indexOf(id) === idx);
  return ids.length ? ids : undefined;
}

export function buildCardSyncIndex(
  mine: MineCard[],
  received: ReceivedEntry[],
  nowIso = new Date().toISOString(),
  deleted: DeletedCardEntry[] = [],
): CardSyncIndex {
  const projectedEntries: CardSyncIndexEntry[] = [
    ...mine.map((card) => ({
      id: card.id,
      kind: "mine" as const,
      objectId: mineObjectId(card.id),
      updatedAt: card.updatedAt,
      ...(assetIdsFromCard(card) ? { assetIds: assetIdsFromCard(card) } : {}),
    })),
    ...received.map((entry) => ({
      id: entry.id,
      kind: "received" as const,
      objectId: receivedObjectId(entry.id),
      updatedAt: entry.updatedAt,
      receivedAt: entry.receivedAt,
      ...(assetIdsFromCard(entry.data) ? { assetIds: assetIdsFromCard(entry.data) } : {}),
    })),
    ...deleted.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      objectId: entry.kind === "mine" ? mineObjectId(entry.id) : receivedObjectId(entry.id),
      updatedAt: entry.updatedAt,
      deleted: true as const,
    })),
  ];
  const byKey = new Map<string, CardSyncIndexEntry>();
  for (const entry of projectedEntries) {
    const key = `${entry.kind}:${entry.id}`;
    const existing = byKey.get(key);
    if (!existing || Date.parse(entry.updatedAt) >= Date.parse(existing.updatedAt)) byKey.set(key, entry);
  }
  const entries = [...byKey.values()].sort((a, b) => a.objectId.localeCompare(b.objectId));

  const latestEntryTime = entries.length
    ? entries.map((entry) => entry.updatedAt).sort((a, b) => Date.parse(b) - Date.parse(a))[0]
    : nowIso;
  return { v: CARD_SYNC_INDEX_VERSION, updatedAt: latestEntryTime, entries };
}

function newerIndexEntry(a: CardSyncIndexEntry, b: CardSyncIndexEntry): CardSyncIndexEntry {
  if (Date.parse(a.updatedAt) !== Date.parse(b.updatedAt)) {
    return Date.parse(a.updatedAt) > Date.parse(b.updatedAt) ? a : b;
  }
  return a.objectId >= b.objectId ? a : b;
}

export function mergeCardSyncIndexes(local: CardSyncIndex, remote: CardSyncIndex): CardSyncIndex {
  const byKey = new Map<string, CardSyncIndexEntry>();
  for (const entry of [...remote.entries, ...local.entries]) {
    const key = `${entry.kind}:${entry.id}`;
    const existing = byKey.get(key);
    byKey.set(key, existing ? newerIndexEntry(entry, existing) : entry);
  }
  const entries = [...byKey.values()].sort((a, b) => a.objectId.localeCompare(b.objectId));
  const updatedAt = [local.updatedAt, remote.updatedAt, ...entries.map((entry) => entry.updatedAt)]
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] || new Date().toISOString();
  return { v: CARD_SYNC_INDEX_VERSION, updatedAt, entries };
}

export function cardSyncIndexEntriesEqual(a: CardSyncIndexEntry, b: CardSyncIndexEntry): boolean {
  if (a.id !== b.id || a.kind !== b.kind || a.objectId !== b.objectId || a.updatedAt !== b.updatedAt) return false;
  if ((a.receivedAt || "") !== (b.receivedAt || "")) return false;
  if (a.deleted !== b.deleted) return false;
  const aAssets = a.assetIds || [];
  const bAssets = b.assetIds || [];
  if (aAssets.length !== bAssets.length) return false;
  return aAssets.every((assetId, idx) => assetId === bAssets[idx]);
}

export function cardSyncIndexesEqual(a: CardSyncIndex, b: CardSyncIndex): boolean {
  if (a.v !== b.v || a.updatedAt !== b.updatedAt || a.entries.length !== b.entries.length) return false;
  const byKey = new Map(a.entries.map((entry) => [`${entry.kind}:${entry.id}`, entry]));
  for (const entry of b.entries) {
    const other = byKey.get(`${entry.kind}:${entry.id}`);
    if (!other || !cardSyncIndexEntriesEqual(other, entry)) return false;
  }
  return true;
}

export function changedCardSyncIndexEntries(base: CardSyncIndex, next: CardSyncIndex): CardSyncIndexEntry[] {
  const baseEntries = new Map(base.entries.map((entry) => [`${entry.kind}:${entry.id}`, entry]));
  return next.entries.filter((entry) => {
    const previous = baseEntries.get(`${entry.kind}:${entry.id}`);
    return !previous || !cardSyncIndexEntriesEqual(previous, entry);
  });
}

export function mergeCardRecord<T extends { updatedAt?: string; receivedAt?: string }>(local: T, remote: T): T {
  const localTime = Date.parse(local.updatedAt || local.receivedAt || "");
  const remoteTime = Date.parse(remote.updatedAt || remote.receivedAt || "");
  return localTime >= remoteTime ? local : remote;
}

export function normalizeDataUrlForHash(dataUrl: string): string {
  return dataUrl.trim();
}

export async function hashCardAssetDataUrl(dataUrl: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalizeDataUrlForHash(dataUrl));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
