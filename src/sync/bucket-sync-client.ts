import { decryptEnvelope, encryptEnvelopeFields, fnv1a32Bytes, type BucketCryptoKey } from "./bucket-crypto";

export type BucketSyncSessionCredential = { carrier: "cookie" } | { carrier: "bearer"; token: string };

export type BucketSyncAuth = BucketCryptoKey & {
  mfid: string;
  session: BucketSyncSessionCredential;
};

export type PullResult<T> = { found: false } | { found: true; versionId: string; payload: T };

export type PushResult = { ok: true; versionId: string } | { ok: false; conflict: true; remoteVersionId: string | null };

const enc = new TextEncoder();
const dec = new TextDecoder();

export class BucketSyncClient {
  private readonly apiBase: string;
  private readonly auth: BucketSyncAuth;
  private streamAbort: AbortController | null = null;
  private streamReconnectHandle: number | null = null;
  private disposed = false;

  constructor(apiBase: string, auth: BucketSyncAuth) {
    this.apiBase = apiBase.replace(/\/+$/, "");
    this.auth = auth;
  }

  async pullCurrent<T>(objectId: string, parse: (value: unknown) => T | null): Promise<PullResult<T>> {
    const res = await fetch(this.url(objectId, "/current?miss=null"), { headers: this.headers(), credentials: this.credentials() });
    if (res.status === 404) return { found: false };
    if (!res.ok) throw new Error(`pull current failed: ${res.status}`);
    const body = (await res.json()) as { versionId?: string | null };
    if (!body.versionId) return { found: false };
    const versionId = body.versionId;
    const payloadRes = await fetch(this.url(objectId, `/versions/${encodeURIComponent(versionId)}/payload`), {
      headers: this.headers(),
      credentials: this.credentials(),
    });
    if (payloadRes.status === 404) return { found: false };
    if (!payloadRes.ok) throw new Error(`pull payload failed: ${payloadRes.status}`);
    let payload: T | null = null;
    try {
      const envelope = new Uint8Array(await payloadRes.arrayBuffer());
      const plaintext = await decryptEnvelope(this.auth, objectId, versionId, envelope);
      payload = parse(JSON.parse(dec.decode(plaintext)));
    } catch (error) {
      console.warn("Skipping unreadable sync payload", { objectId, versionId, error });
      return { found: false };
    }
    if (!payload) {
      console.warn("Skipping invalid sync payload", { objectId, versionId });
      return { found: false };
    }
    return { found: true, versionId, payload };
  }

  async push<T>(
    objectId: string,
    payload: T,
    opts: { expectedHeadVersionId: string | null; parentVersionIds: string[] }
  ): Promise<PushResult> {
    const versionId = crypto.randomUUID();
    const kind = opts.parentVersionIds.length === 0 ? "create" : "update";
    const plaintext = enc.encode(JSON.stringify(payload));
    const cipherFields = await encryptEnvelopeFields(this.auth, objectId, versionId, plaintext);
    const versionPayload = enc.encode(JSON.stringify({ objectId, versionId, kind, parentVersionIds: opts.parentVersionIds, ...cipherFields }));
    const contentHash = fnv1a32Bytes(versionPayload);
    const versionMeta = { objectId, versionId, parentVersionIds: opts.parentVersionIds, contentHash, kind, timestamp: Date.now() };
    const headState = { headVersionId: versionId, historyMap: { [versionId]: opts.parentVersionIds }, fieldSources: {} };
    const form = new FormData();
    form.set("versionMeta", JSON.stringify(versionMeta));
    form.set("headState", JSON.stringify(headState));
    form.set("versionPayload", new Blob([versionPayload], { type: "application/octet-stream" }));
    if (opts.expectedHeadVersionId != null) form.set("expectedHeadVersionId", opts.expectedHeadVersionId);
    const res = await fetch(this.url(objectId), { method: "POST", headers: this.headers(), credentials: this.credentials(), body: form });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; reason?: string; headVersionId?: string | null } | null;
    if (res.status === 409) {
      return { ok: false, conflict: true, remoteVersionId: body?.headVersionId ?? null };
    }
    if (!res.ok) throw new Error(`push failed: ${res.status}`);
    if (body?.ok === false) {
      if (body.reason === "version-mismatch" || body.reason === "conflict") {
        return { ok: false, conflict: true, remoteVersionId: body.headVersionId ?? null };
      }
      throw new Error(`push rejected: ${body.reason || "unknown"}`);
    }
    return { ok: true, versionId };
  }

  startStream(objectIds: Iterable<string>, onHint: (objectId: string | null) => void, onError?: (error: unknown) => void): void {
    this.stopStream();
    const watched = new Set(objectIds);
    const abortController = new AbortController();
    this.streamAbort = abortController;
    void this.runStream(watched, onHint, abortController).catch((error) => {
      if (abortController.signal.aborted || this.disposed) return;
      onError?.(error);
      this.streamReconnectHandle = window.setTimeout(() => {
        this.streamReconnectHandle = null;
        this.startStream(watched, onHint, onError);
      }, 3_000);
    });
  }

  stopStream(): void {
    if (this.streamReconnectHandle != null) {
      window.clearTimeout(this.streamReconnectHandle);
      this.streamReconnectHandle = null;
    }
    this.streamAbort?.abort();
    this.streamAbort = null;
  }

  dispose(): void {
    this.disposed = true;
    this.stopStream();
  }

  private async runStream(watched: Set<string>, onHint: (objectId: string | null) => void, abortController: AbortController): Promise<void> {
    const res = await fetch(`${this.apiBase}/v1/api/sync/buckets/${encodeURIComponent(this.auth.bucketId)}/feed/stream`, {
      headers: this.headers(),
      credentials: this.credentials(),
      signal: abortController.signal,
    });
    if (!res.ok) throw new Error(`feed stream failed: ${res.status}`);
    if (!res.body) throw new Error("feed stream missing body");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let nextFrame = takeNextSseFrame(buffer);
        while (nextFrame) {
          buffer = nextFrame.rest;
          const outcome = classifySseFrame(nextFrame.frame);
          if (outcome.kind === "all") onHint(null);
          if (outcome.kind === "ids") {
            for (const id of outcome.ids) {
              if (watched.has(id)) onHint(id);
            }
          }
          nextFrame = takeNextSseFrame(buffer);
        }
      }
    } finally {
      reader.releaseLock();
    }
    if (!abortController.signal.aborted) throw new Error("feed stream closed");
  }

  private url(objectId: string, suffix = ""): string {
    return `${this.apiBase}/v1/api/sync/buckets/${encodeURIComponent(this.auth.bucketId)}/objects/${encodeURIComponent(objectId)}${suffix}`;
  }

  private headers(): Headers {
    const headers = new Headers();
    headers.set("x-myfield-mfid", this.auth.mfid);
    if (this.auth.session.carrier === "bearer") headers.set("Authorization", `Bearer ${this.auth.session.token}`);
    return headers;
  }

  private credentials(): RequestCredentials | undefined {
    return this.auth.session.carrier === "cookie" ? "include" : undefined;
  }
}

type FrameOutcome = { kind: "ignore" } | { kind: "all" } | { kind: "ids"; ids: string[] };

function takeNextSseFrame(buffer: string): { frame: string; rest: string } | null {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (lf < 0 && crlf < 0) return null;
  if (crlf >= 0 && (lf < 0 || crlf <= lf)) return { frame: buffer.slice(0, crlf), rest: buffer.slice(crlf + 4) };
  return { frame: buffer.slice(0, lf), rest: buffer.slice(lf + 2) };
}

function classifySseFrame(frame: string): FrameOutcome {
  const lines = frame.split(/\r?\n/);
  const eventName = lines.find((line) => line.startsWith("event:"))?.slice("event:".length).trim();
  if (eventName === "sync-ready") return { kind: "ignore" };
  if (eventName !== "sync-feed") return { kind: "ignore" };
  const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice("data:".length).trim()).join("\n");
  if (!data) return { kind: "all" };
  try {
    const parsed = JSON.parse(data) as { objectId?: unknown; entries?: unknown; objectRefs?: unknown };
    const ids: unknown[] = [
      parsed.objectId,
      ...(Array.isArray(parsed.entries) ? parsed.entries.map((entry: { objectId?: unknown }) => entry?.objectId) : []),
      ...(Array.isArray(parsed.objectRefs) ? parsed.objectRefs.map((ref: { objectId?: unknown }) => ref?.objectId) : []),
    ];
    const stringIds = ids.filter((id): id is string => typeof id === "string");
    if (stringIds.length === 0) return { kind: "all" };
    return { kind: "ids", ids: stringIds };
  } catch {
    return { kind: "all" };
  }
}
