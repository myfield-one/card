import assert from "node:assert/strict";
import test from "node:test";

import { decryptEnvelope, encryptEnvelopeFields } from "../src/sync/bucket-crypto.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();

test("bucket sync envelope round-trips with a wrapped DEK and is bound to object/version id", async () => {
  const bucketKey = await crypto.subtle.importKey("raw", crypto.getRandomValues(new Uint8Array(32)), "AES-GCM", false, ["encrypt", "decrypt"]);
  const key = { bucketId: "card.myfield.one", keyId: "key-1", bucketKey };
  const fields = await encryptEnvelopeFields(key, "mine:1", "v1", enc.encode(JSON.stringify({ hello: "world" })));
  const envelope = enc.encode(JSON.stringify({ objectId: "mine:1", versionId: "v1", kind: "create", parentVersionIds: [], ...fields }));

  assert.equal(fields.wrappedDEKMeta.alg, "AES-GCM-KW");
  assert.notEqual(fields.wrappedDEK, key.keyId);
  assert.deepEqual(JSON.parse(dec.decode(await decryptEnvelope(key, "mine:1", "v1", envelope))), { hello: "world" });
  await assert.rejects(() => decryptEnvelope(key, "mine:2", "v1", envelope), /corrupted sync envelope|aad mismatch/);
  await assert.rejects(() => decryptEnvelope(key, "mine:1", "v2", envelope), /corrupted sync envelope|aad mismatch/);
});

test("bucket sync envelope rejects legacy bucket-key encrypted payloads", async () => {
  const bucketKey = await crypto.subtle.importKey("raw", crypto.getRandomValues(new Uint8Array(32)), "AES-GCM", false, ["encrypt", "decrypt"]);
  const key = { bucketId: "card.myfield.one", keyId: "key-1", bucketKey };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const legacyAad = "myfield.bucket.sync.v1|card.myfield.one|mine:legacy";
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: enc.encode(legacyAad) },
      bucketKey,
      enc.encode(JSON.stringify({ legacy: true }))
    )
  );
  const envelope = enc.encode(JSON.stringify({
    objectId: "mine:legacy",
    versionId: "old-v1",
    kind: "create",
    parentVersionIds: [],
    ciphertext: bytesToB64url(ciphertext),
    cipherMeta: {
      alg: "AES-GCM",
      iv: bytesToB64url(iv),
      keyId: "key-1",
      bucketId: "card.myfield.one",
      aad: legacyAad,
    },
    wrappedDEK: "key-1",
  }));

  await assert.rejects(() => decryptEnvelope(key, "mine:legacy", "old-v1", envelope), /aad mismatch/);
  await assert.rejects(() => decryptEnvelope(key, "mine:other", "old-v1", envelope), /corrupted sync envelope|aad mismatch/);
});

function bytesToB64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
