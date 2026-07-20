const enc = new TextEncoder();
const dec = new TextDecoder();

export type BucketCryptoKey = {
  bucketId: string;
  keyId: string;
  bucketKey: CryptoKey;
};

export type EncryptedEnvelopeFields = {
  ciphertext: string;
  cipherMeta: { alg: "AES-GCM"; iv: string; keyId: string; bucketId: string; aad: string };
  wrappedDEK: string;
  wrappedDEKMeta: { alg: "AES-GCM-KW"; iv: string; keyId: string; bucketId: string; aad: string };
};

export function fnv1a32Bytes(bytes: Uint8Array): string {
  let hash = 2166136261;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i] as number;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export async function encryptEnvelopeFields(
  key: BucketCryptoKey,
  objectId: string,
  versionId: string,
  plaintext: Uint8Array
): Promise<EncryptedEnvelopeFields> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const dekRaw = crypto.getRandomValues(new Uint8Array(32));
  const dekKey = await importAesGcmKey(dekRaw, ["encrypt"]);
  const aad = buildPayloadAad(key.bucketId, objectId, versionId);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, dekKey, plaintext)
  );
  const wrapIv = crypto.getRandomValues(new Uint8Array(12));
  const wrapAad = buildDekWrapAad(key.bucketId, objectId, versionId, key.keyId);
  const wrappedDEK = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: wrapIv, additionalData: enc.encode(wrapAad) }, key.bucketKey, dekRaw)
  );
  return {
    ciphertext: bytesToB64url(ciphertext),
    cipherMeta: {
      alg: "AES-GCM",
      iv: bytesToB64url(iv),
      keyId: key.keyId,
      bucketId: key.bucketId,
      aad,
    },
    wrappedDEK: bytesToB64url(wrappedDEK),
    wrappedDEKMeta: {
      alg: "AES-GCM-KW",
      iv: bytesToB64url(wrapIv),
      keyId: key.keyId,
      bucketId: key.bucketId,
      aad: wrapAad,
    },
  };
}

export async function decryptEnvelope(key: BucketCryptoKey, objectId: string, versionId: string, envelope: Uint8Array): Promise<Uint8Array> {
  const parsed = JSON.parse(dec.decode(envelope)) as {
    objectId?: unknown;
    versionId?: unknown;
    cipherMeta?: { alg?: unknown; iv?: unknown; keyId?: unknown; bucketId?: unknown; aad?: unknown };
    wrappedDEK?: unknown;
    wrappedDEKMeta?: { alg?: unknown; iv?: unknown; keyId?: unknown; bucketId?: unknown; aad?: unknown };
    ciphertext?: unknown;
  };
  if (
    parsed.objectId !== objectId ||
    parsed.versionId !== versionId ||
    typeof parsed.ciphertext !== "string" ||
    parsed.cipherMeta?.alg !== "AES-GCM" ||
    parsed.cipherMeta.keyId !== key.keyId ||
    parsed.cipherMeta.bucketId !== key.bucketId ||
    typeof parsed.cipherMeta.iv !== "string" ||
    typeof parsed.cipherMeta.aad !== "string"
  ) {
    throw new Error("corrupted sync envelope");
  }
  if (parsed.cipherMeta.aad !== buildPayloadAad(key.bucketId, objectId, versionId)) {
    throw new Error("sync envelope aad mismatch");
  }
  if (
    typeof parsed.wrappedDEK !== "string" ||
    parsed.wrappedDEKMeta?.alg !== "AES-GCM-KW" ||
    parsed.wrappedDEKMeta.keyId !== key.keyId ||
    parsed.wrappedDEKMeta.bucketId !== key.bucketId ||
    typeof parsed.wrappedDEKMeta.iv !== "string" ||
    typeof parsed.wrappedDEKMeta.aad !== "string"
  ) {
    throw new Error("corrupted sync envelope");
  }
  if (parsed.wrappedDEKMeta.aad !== buildDekWrapAad(key.bucketId, objectId, versionId, key.keyId)) {
    throw new Error("sync envelope aad mismatch");
  }
  const dekRaw = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64urlToBytes(parsed.wrappedDEKMeta.iv), additionalData: enc.encode(parsed.wrappedDEKMeta.aad) },
      key.bucketKey,
      b64urlToBytes(parsed.wrappedDEK)
    )
  );
  const dekKey = await importAesGcmKey(dekRaw, ["decrypt"]);
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64urlToBytes(parsed.cipherMeta.iv), additionalData: enc.encode(parsed.cipherMeta.aad) },
      dekKey,
      b64urlToBytes(parsed.ciphertext)
    )
  );
}

function buildPayloadAad(bucketId: string, objectId: string, versionId: string): string {
  return `myfield.bucket.sync.v2|${bucketId}|${objectId}|${versionId}`;
}

function buildDekWrapAad(bucketId: string, objectId: string, versionId: string, keyId: string): string {
  return `myfield.bucket.sync.dek.v1|${bucketId}|${objectId}|${versionId}|${keyId}`;
}

async function importAesGcmKey(rawKey: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM", length: 256 }, false, usages);
}

function bytesToB64url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i] || 0);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlToBytes(value: string): Uint8Array {
  const pad = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob((value + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
