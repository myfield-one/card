import { BucketSyncClient } from "./bucket-sync-client";
import { createCardSyncController } from "./card-sync-controller";
import { createInstanceAuthClient } from "./instance-auth";

export const CARD_SYNC_BUCKET_ID = "card.myfield.one";
export const CARD_SYNC_RESOURCE_ID = `urn:myfield:bucket:${CARD_SYNC_BUCKET_ID}`;

function envString(name: string): string {
  const env = import.meta.env as Record<string, unknown>;
  return String(env[name] || "").trim();
}

function runtimeEnv(): "dev" | "staging" | "prod" {
  const value = envString("MYFIELD_ENV");
  return value === "staging" || value === "prod" ? value : "prod";
}

export function cloudWebBase(): string {
  const explicit = envString("VITE_WEB_BASE") || envString("MYFIELD_WEB_BASE");
  if (explicit) return explicit.replace(/\/+$/, "");
  if (runtimeEnv() === "staging") return "https://staging.myfield.space";
  if (runtimeEnv() === "dev") return "https://dev.myfield.space";
  return "https://myfield.one";
}

export function cloudApiBase(): string {
  const explicit = envString("VITE_API_BASE") || envString("MYFIELD_API_BASE");
  if (explicit) return explicit.replace(/\/+$/, "");
  if (runtimeEnv() === "staging") return "https://api-staging.myfield.space";
  if (runtimeEnv() === "dev") return "https://api-dev.myfield.space";
  return "https://api.myfield.one";
}

function authPageUrl(transport: "same-tab" | "popup"): string {
  const url = new URL("/auth/", cloudWebBase());
  url.searchParams.set("callbackTransport", transport);
  return url.toString();
}

function openAuthPopup(url: string): void {
  const width = 520;
  const height = 720;
  const left = Math.max(0, Math.floor(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.floor(window.screenY + (window.outerHeight - height) / 2));
  const popup = window.open("about:blank", "myfield-card-auth", `popup=yes,width=${width},height=${height},left=${left},top=${top}`);
  if (!popup) throw new Error("Could not open auth popup");
  popup.location.href = url;
}

function shouldUseSameTabAuth(): boolean {
  return true;
}

function baseAuthOptions() {
  return {
    appId: "card.myfield.one",
    apiBase: cloudApiBase(),
    credentialCarrier: "bearer" as const,
    redirectUri: location.origin + location.pathname,
    origin: location.origin,
  };
}

const sameTabAuth = createInstanceAuthClient({
  ...baseAuthOptions(),
  authPageUrl: authPageUrl("same-tab"),
});

const popupAuth = createInstanceAuthClient({
  ...baseAuthOptions(),
  authPageUrl: authPageUrl("popup"),
  openAuthUrl: openAuthPopup,
});

export async function handleCardSyncAuthCallback(): Promise<"none" | "approved" | "handled"> {
  const url = new URL(location.href);
  const hasCallbackParams =
    url.searchParams.has("mf_request_id") &&
    url.searchParams.has("state") &&
    (url.searchParams.has("mf_result") || url.searchParams.has("error"));
  if (!hasCallbackParams) return "none";

  const result = await sameTabAuth.handleCallback(location.href);
  if (!result) return "none";
  history.replaceState(null, "", location.pathname);
  return result.result === "approved" ? "approved" : "handled";
}

export async function authorizeCardSync(): Promise<void> {
  const auth = shouldUseSameTabAuth() ? sameTabAuth : popupAuth;
  await auth.authorize({
    resourceId: CARD_SYNC_RESOURCE_ID,
    capabilities: ["read", "write"],
    callbackVersion: 1,
    authMode: "alias",
  });
}

export async function connectCardSync() {
  const context = await sameTabAuth.getContext(CARD_SYNC_RESOURCE_ID);
  if (!context) return null;
  const session = await sameTabAuth.getSession(CARD_SYNC_RESOURCE_ID);
  const access = await sameTabAuth.getBucketAccess(CARD_SYNC_BUCKET_ID);
  const client = new BucketSyncClient(cloudApiBase(), {
    mfid: access.mfid,
    bucketId: access.bucketId,
    keyId: access.keyId,
    bucketKey: access.bucketKey,
    session: session.carrier === "bearer" ? { carrier: "bearer", token: session.token } : { carrier: "cookie" },
  });
  return createCardSyncController(client);
}

export async function clearCardSyncAuthorization(): Promise<void> {
  await sameTabAuth.clearContext(CARD_SYNC_RESOURCE_ID);
}
