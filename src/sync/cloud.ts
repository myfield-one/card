import { createInstance } from "@myfield/sdk";
import { BucketSyncClient } from "./bucket-sync-client";
import { createCardSyncController } from "./card-sync-controller";
import { importLegacyIdentity, needsSyncReconnect, readLegacyInstanceKey } from "./instance-auth";

const appId = "card.myfield.one";
const options = { autoSync: false };
const env = import.meta.env as Record<string, unknown>;
const webBase = typeof env.VITE_WEB_BASE === "string" ? env.VITE_WEB_BASE.trim() : "";
const authUrl = typeof env.VITE_MYFIELD_AUTH_URL === "string" && env.VITE_MYFIELD_AUTH_URL.trim()
  ? env.VITE_MYFIELD_AUTH_URL.trim()
  : new URL("/auth/", webBase || "https://myfield.one").href;
const instance = createInstance({ appId, authUrl });
let preparingIdentity: Promise<void> | undefined;

function prepareIdentity(): Promise<void> {
  preparingIdentity ??= importLegacyIdentity(instance, () => readLegacyInstanceKey(appId)).catch((error) => {
    preparingIdentity = undefined;
    throw error;
  });
  return preparingIdentity;
}

export async function handleCardSyncAuthCallback(): Promise<"none" | "approved" | "handled"> {
  const { searchParams } = new URL(location.href);
  if (!searchParams.has("mf_request_id") || !searchParams.has("state") ||
    (!searchParams.has("mf_result") && !searchParams.has("error"))) return "none";
  try {
    await prepareIdentity();
    return await instance.resume(options) === "connected" ? "approved" : "handled";
  } catch (error) {
    console.warn("[sync] Card authorization could not be resumed", error);
    return "handled";
  }
}

export async function authorizeCardSync(): Promise<void> {
  await prepareIdentity();
  await instance.connect(options);
}

export async function connectCardSync() {
  await prepareIdentity();
  if (await instance.resume(options) !== "connected") return null;
  const remote = instance.remote.getBucket();
  const { bucketId, keyId, cryptoKey: bucketKey } = await remote.getBucketKey();
  return createCardSyncController(new BucketSyncClient(remote, { bucketId, keyId, bucketKey }));
}

export function onCardSyncDisconnected(handler: () => void): () => void {
  return instance.on("state", (state) => {
    if (state === "disconnected") handler();
  });
}

export async function clearCardSyncAuthorization(): Promise<void> {
  await instance.disconnect();
}

export function needsCardSyncReconnect(reconnected: boolean, dismissed = false): Promise<boolean> {
  return needsSyncReconnect(reconnected, dismissed, () => readLegacyInstanceKey(appId));
}
