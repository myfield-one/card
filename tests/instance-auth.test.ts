import assert from "node:assert/strict";
import test from "node:test";
import { ClientError, type InstanceKey } from "@myfield/sdk";
import { importLegacyIdentity, needsSyncReconnect } from "../src/sync/instance-auth.ts";

const legacyKey = { instanceId: "legacy-instance" } as InstanceKey;

function target(current: InstanceKey | null, importError?: Error) {
  const imported: InstanceKey[] = [];
  return {
    imported,
    async getKey() { return current; },
    async importKey(key: InstanceKey) {
      if (importError) throw importError;
      imported.push(key);
    },
  };
}

test("an existing SDK identity is kept without reading the legacy key", async () => {
  const instance = target({ instanceId: "sdk-instance" } as InstanceKey);
  let reads = 0;
  await importLegacyIdentity(instance, async () => { reads++; return legacyKey; });
  assert.equal(reads, 0);
  assert.deepEqual(instance.imported, []);
});

test("the legacy key is imported once, and new users import nothing", async () => {
  const existing = target(null);
  await importLegacyIdentity(existing, async () => legacyKey);
  assert.deepEqual(existing.imported, [legacyKey]);

  const fresh = target(null);
  await importLegacyIdentity(fresh, async () => null);
  assert.deepEqual(fresh.imported, []);
});

test("an incompatible legacy key falls back to a new identity, while other failures propagate", async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    await importLegacyIdentity(target(null, new ClientError("INVALID_INSTANCE_KEY", "invalid")), async () => legacyKey);
  } finally {
    console.warn = warn;
  }
  const storageFailure = new ClientError("STORAGE_ERROR", "unavailable");
  await assert.rejects(importLegacyIdentity(target(null, storageFailure), async () => legacyKey), storageFailure);
  const readFailure = new Error("legacy database unavailable");
  await assert.rejects(importLegacyIdentity(target(null), async () => { throw readFailure; }), readFailure);
});

test("reconnect is offered only to devices with a legacy identity that have not reconnected or dismissed it", async () => {
  let reads = 0;
  const legacy = async () => { reads++; return legacyKey; };
  assert.equal(await needsSyncReconnect(true, false, legacy), false);
  assert.equal(await needsSyncReconnect(false, true, legacy), false);
  assert.equal(reads, 0);
  assert.equal(await needsSyncReconnect(false, false, legacy), true);
  assert.equal(await needsSyncReconnect(false, false, async () => null), false);
  assert.equal(await needsSyncReconnect(false, false, async () => { throw new Error("unavailable"); }), false);
});
