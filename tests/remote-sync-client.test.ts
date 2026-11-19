import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { ClientError, type CommitInput, type RemoteBucket } from "@myfield/sdk";
import { BucketSyncClient } from "../src/sync/bucket-sync-client.ts";
import { decryptEnvelope, encryptEnvelopeFields } from "../src/sync/bucket-crypto.ts";

const id = "mine:1";
const options = { expectedHeadVersionId: "older", parentVersionIds: ["older"] };

async function bucketKey() {
  const bucketKey = await crypto.subtle.importKey("raw", new Uint8Array(32), "AES-GCM", false, ["encrypt", "decrypt"]);
  return { bucketId: "card.myfield.one", keyId: "key-1", bucketKey };
}

test("Remote sends the legacy Card envelope and hashes precisely the encrypted wire bytes", async () => {
  const key = await bucketKey();
  const remote = { async commit(input: CommitInput) {
    assert.equal(input.expectedHeadVersionId, "older");
    assert.deepEqual(input.meta.parentVersionIds, ["older"]);
    assert.ok(input.payload instanceof Uint8Array);
    const hash = createHash("sha256").update(input.payload).digest("base64url");
    assert.equal(input.meta.payloadHash, `sha256:${hash}`);
    const decoded = await decryptEnvelope(key, id, input.meta.versionId, input.payload);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(decoded)), { title: "Existing card" });
    return { ok: false, reason: "version-mismatch" };
  } } as RemoteBucket;
  assert.deepEqual(await new BucketSyncClient(remote, key).push(id, { title: "Existing card" }, options),
    { ok: false, conflict: true, remoteVersionId: null });
});

test("a missing payload follows a concurrently replaced head without treating it as deletion", async () => {
  const key = await bucketKey();
  const fields = await encryptEnvelopeFields(key, id, "newer", new TextEncoder().encode('{"title":"Recovered"}'));
  let heads = 0;
  const remote = {
    async getCurrent() { return { versionId: heads++ === 0 ? "older" : "newer" }; },
    async getPayload(_: string, versionId: string) {
      if (versionId === "older") throw new ClientError("HTTP_ERROR", "Missing payload", { status: 404 });
      return new Response(JSON.stringify({ objectId: id, versionId, ...fields }));
    },
  } as RemoteBucket;
  assert.deepEqual(await new BucketSyncClient(remote, key).pullCurrent(id, (value) => value),
    { found: true, versionId: "newer", payload: { title: "Recovered" } });

  remote.getCurrent = async () => ({ versionId: "older", headVersionMeta: { objectId: id, versionId: "older", parentVersionIds: [] } });
  await assert.rejects(new BucketSyncClient(remote, key).pullCurrent(id, (value) => value), /Missing payload/);
});

test("a lost commit response propagates without retrying the write", async () => {
  const key = await bucketKey();
  let attempts = 0;
  const failure = new ClientError("NETWORK_ERROR", "Connection lost after upload");
  const remote = {
    async commit() {
      attempts++;
      throw failure;
    },
  } as unknown as RemoteBucket;
  await assert.rejects(new BucketSyncClient(remote, key).push(id, { title: "Keep locally" }, options),
    (error) => error === failure);
  assert.equal(attempts, 1);
});
