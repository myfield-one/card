import { ClientError, type RemoteBucket } from "@myfield/sdk";
import { decryptEnvelope, encryptEnvelopeFields, type BucketCryptoKey } from "./bucket-crypto.ts";

export type PullResult<T> = { found: false } | { found: true; versionId: string; payload: T };
export type PushResult = { ok: true; versionId: string } | { ok: false; conflict: true; remoteVersionId: string | null };

const enc = new TextEncoder();
const dec = new TextDecoder();

export class BucketSyncClient {
  private readonly lifetime = new AbortController();
  private stream: AbortController | null = null;
  private reconnect: ReturnType<typeof setTimeout> | null = null;

  private readonly remote: RemoteBucket;
  private readonly key: BucketCryptoKey;

  constructor(remote: RemoteBucket, key: BucketCryptoKey) {
    this.remote = remote;
    this.key = key;
  }

  async pullCurrent<T>(objectId: string, parse: (value: unknown) => T | null): Promise<PullResult<T>> {
    const options = { signal: this.lifetime.signal };
    const head = await this.remote.getCurrent(objectId, options);
    if (!head) return { found: false };
    let versionId = head.versionId;
    let response: Response;
    try {
      response = await this.remote.getPayload(objectId, versionId, options);
    } catch (error) {
      if (!(error instanceof ClientError) || error.status !== 404) throw error;
      const latest = await this.remote.getCurrent(objectId, options);
      if (!latest || latest.versionId === versionId) throw error;
      versionId = latest.versionId;
      response = await this.remote.getPayload(objectId, versionId, options);
    }
    const payload = parse(JSON.parse(dec.decode(await decryptEnvelope(
      this.key, objectId, versionId, new Uint8Array(await response.arrayBuffer()),
    ))));
    if (payload == null) throw new Error("Invalid Card sync payload");
    return { found: true, versionId, payload };
  }

  async push<T>(
    objectId: string,
    payload: T,
    options: { expectedHeadVersionId: string | null; parentVersionIds: string[] },
  ): Promise<PushResult> {
    const versionId = crypto.randomUUID();
    const { expectedHeadVersionId, parentVersionIds } = options;
    const kind = parentVersionIds.length === 0 ? "create" : "update";
    const fields = await encryptEnvelopeFields(this.key, objectId, versionId, enc.encode(JSON.stringify(payload)));
    const bytes = enc.encode(JSON.stringify({ objectId, versionId, kind, parentVersionIds, ...fields }));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const payloadHash = `sha256:${btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
    const result = await this.remote.commit({
      meta: { objectId, versionId, parentVersionIds, payloadHash, kind, timestamp: Date.now() },
      payload: bytes,
      expectedHeadVersionId,
    }, { signal: this.lifetime.signal });
    return result.ok ? { ok: true, versionId } : { ok: false, conflict: true, remoteVersionId: null };
  }

  startStream(objectIds: Iterable<string>, onHint: (objectId: string | null) => void, onError?: (error: unknown) => void): void {
    this.stopStream();
    if (this.lifetime.signal.aborted) return;
    const ids = new Set(objectIds);
    const stream = new AbortController();
    this.stream = stream;
    void (async () => {
      try {
        const feed = await this.remote.watchFeed({ signal: stream.signal });
        if (!stream.signal.aborted) onHint(null);
        for await (const hint of feed) {
          if (!stream.signal.aborted && ids.has(hint.objectId)) onHint(hint.objectId);
        }
        if (!stream.signal.aborted) throw new Error("Card sync feed closed");
      } catch (error) {
        if (stream.signal.aborted || this.lifetime.signal.aborted) return;
        onError?.(error);
        this.reconnect = setTimeout(() => this.startStream(ids, onHint, onError), 3000);
      }
    })();
  }

  stopStream(): void {
    if (this.reconnect !== null) clearTimeout(this.reconnect);
    this.reconnect = null;
    this.stream?.abort();
    this.stream = null;
  }

  dispose(): void {
    this.lifetime.abort();
    this.stopStream();
  }
}
