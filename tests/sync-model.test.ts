import assert from "node:assert/strict";
import test from "node:test";

import type { MineCard, ReceivedEntry } from "../src/storage.ts";
import {
  buildCardSyncIndex,
  changedCardSyncIndexEntries,
  hashCardAssetDataUrl,
  mergeCardRecord,
  mergeCardSyncIndexes,
  parseCardSyncIndex,
} from "../src/sync/model.ts";

const MINE_ID = "11111111-1111-4111-8111-111111111111";
const RECEIVED_ID = "22222222-2222-4222-8222-222222222222";
const ASSET_ID = "33333333-3333-4333-8333-333333333333";

test("buildCardSyncIndex projects mine and received records into a small encrypted-list payload", () => {
  const mine: MineCard[] = [{
    v: 2,
    id: MINE_ID,
    updatedAt: "2026-07-16T00:00:00.000Z",
    contact: { fn: "Ada" },
  }];
  const received: ReceivedEntry[] = [{
    id: RECEIVED_ID,
    receivedAt: "2026-07-16T01:00:00.000Z",
    updatedAt: "2026-07-16T02:00:00.000Z",
    data: {
      v: 2,
      id: RECEIVED_ID,
      contact: { fn: "" },
      assets: [{
        id: ASSET_ID,
        kind: "cardPhoto",
        mediaType: "image/jpeg",
        sourceRef: { store: "assets", id: ASSET_ID },
      }],
    },
  }];

  assert.deepEqual(buildCardSyncIndex(mine, received, "2026-07-16T00:00:00.000Z"), {
    v: 1,
    updatedAt: "2026-07-16T02:00:00.000Z",
    entries: [
      {
        id: MINE_ID,
        kind: "mine",
        objectId: `mine:${MINE_ID}`,
        updatedAt: "2026-07-16T00:00:00.000Z",
      },
      {
        id: RECEIVED_ID,
        kind: "received",
        objectId: `received:${RECEIVED_ID}`,
        updatedAt: "2026-07-16T02:00:00.000Z",
        receivedAt: "2026-07-16T01:00:00.000Z",
        assetIds: [ASSET_ID],
      },
    ],
  });
});

test("buildCardSyncIndex includes tombstones so deletes survive index merges", () => {
  assert.deepEqual(buildCardSyncIndex([], [], "2026-07-16T00:00:00.000Z", [{
    id: RECEIVED_ID,
    kind: "received",
    updatedAt: "2026-07-16T03:00:00.000Z",
  }]), {
    v: 1,
    updatedAt: "2026-07-16T03:00:00.000Z",
    entries: [{
      id: RECEIVED_ID,
      kind: "received",
      objectId: `received:${RECEIVED_ID}`,
      updatedAt: "2026-07-16T03:00:00.000Z",
      deleted: true,
    }],
  });
});

test("buildCardSyncIndex keeps stable updatedAt when entries are unchanged", () => {
  const mine: MineCard[] = [{
    v: 2,
    id: MINE_ID,
    updatedAt: "2026-07-16T00:00:00.000Z",
    contact: { fn: "Ada" },
  }];

  assert.equal(
    buildCardSyncIndex(mine, [], "2026-07-16T05:00:00.000Z").updatedAt,
    "2026-07-16T00:00:00.000Z",
  );
});

test("mergeCardSyncIndexes unions entries and uses entry-level LWW", () => {
  const merged = mergeCardSyncIndexes(
    {
      v: 1,
      updatedAt: "2026-07-16T02:00:00.000Z",
      entries: [
        { id: "a", kind: "mine", objectId: "mine:a", updatedAt: "2026-07-16T00:00:00.000Z" },
        { id: "b", kind: "received", objectId: "received:b", updatedAt: "2026-07-16T02:00:00.000Z" },
      ],
    },
    {
      v: 1,
      updatedAt: "2026-07-16T03:00:00.000Z",
      entries: [
        { id: "a", kind: "mine", objectId: "mine:a", updatedAt: "2026-07-16T03:00:00.000Z", deleted: true },
        { id: "c", kind: "received", objectId: "received:c", updatedAt: "2026-07-16T01:00:00.000Z" },
      ],
    },
  );

  assert.deepEqual(merged.entries, [
    { id: "a", kind: "mine", objectId: "mine:a", updatedAt: "2026-07-16T03:00:00.000Z", deleted: true },
    { id: "b", kind: "received", objectId: "received:b", updatedAt: "2026-07-16T02:00:00.000Z" },
    { id: "c", kind: "received", objectId: "received:c", updatedAt: "2026-07-16T01:00:00.000Z" },
  ]);
  assert.equal(merged.updatedAt, "2026-07-16T03:00:00.000Z");
});

test("changedCardSyncIndexEntries returns only entries that changed from a base index", () => {
  const base = {
    v: 1 as const,
    updatedAt: "2026-07-16T01:00:00.000Z",
    entries: [
      { id: "a", kind: "mine" as const, objectId: "mine:a" as const, updatedAt: "2026-07-16T01:00:00.000Z" },
      { id: "b", kind: "received" as const, objectId: "received:b" as const, updatedAt: "2026-07-16T01:00:00.000Z" },
    ],
  };
  const next = {
    v: 1 as const,
    updatedAt: "2026-07-16T02:00:00.000Z",
    entries: [
      { id: "a", kind: "mine" as const, objectId: "mine:a" as const, updatedAt: "2026-07-16T01:00:00.000Z" },
      { id: "b", kind: "received" as const, objectId: "received:b" as const, updatedAt: "2026-07-16T02:00:00.000Z" },
      { id: "c", kind: "mine" as const, objectId: "mine:c" as const, updatedAt: "2026-07-16T02:00:00.000Z" },
    ],
  };

  assert.deepEqual(changedCardSyncIndexEntries(base, next), [
    { id: "b", kind: "received", objectId: "received:b", updatedAt: "2026-07-16T02:00:00.000Z" },
    { id: "c", kind: "mine", objectId: "mine:c", updatedAt: "2026-07-16T02:00:00.000Z" },
  ]);
});

test("mergeCardRecord uses whole-object LWW", () => {
  assert.deepEqual(
    mergeCardRecord(
      { id: "a", updatedAt: "2026-07-16T01:00:00.000Z", value: "local" },
      { id: "a", updatedAt: "2026-07-16T00:00:00.000Z", value: "remote" },
    ),
    { id: "a", updatedAt: "2026-07-16T01:00:00.000Z", value: "local" },
  );
});

test("parseCardSyncIndex rejects malformed index payloads", () => {
  assert.equal(parseCardSyncIndex({ v: 1, updatedAt: "bad", entries: [] }), null);
  assert.deepEqual(parseCardSyncIndex({
    v: 1,
    updatedAt: "2026-07-16T00:00:00.000Z",
    entries: [{ id: "x", kind: "mine", objectId: "received:x", updatedAt: "2026-07-16T00:00:00.000Z" }],
  }), { v: 1, updatedAt: "2026-07-16T00:00:00.000Z", entries: [] });
});

test("hashCardAssetDataUrl is stable", async () => {
  assert.equal(
    await hashCardAssetDataUrl("data:image/jpeg;base64,AAAA"),
    await hashCardAssetDataUrl(" data:image/jpeg;base64,AAAA "),
  );
});
