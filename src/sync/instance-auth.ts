type AuthResourceKind = "bucket" | "service";
export type AuthCapability = "read" | "write" | "invoke";

export type AuthInstance = {
  v: 1;
  instanceId: string;
  signingPublicJwk: JsonWebKey;
  signingPrivateKey: CryptoKey;
  wrappingPublicJwk: JsonWebKey;
  wrappingPrivateKey: CryptoKey;
  createdAt: string;
};

export type InstanceAuthContext = {
  v: 1;
  mfid: string;
  resourceId: string;
  instanceId: string;
  requestId: string;
  authorizedAt: string;
  bucketAccessGrant?: BucketAccessGrant;
};

export type CloudSessionCredential =
  | { carrier: "bearer"; token: string; expiresAt: string }
  | { carrier: "cookie"; expiresAt: string };

export type BucketAccess = {
  mfid: string;
  instanceId: string;
  bucketId: string;
  capabilities: AuthCapability[];
  grantRecordId: string;
  keyId: string;
  bucketKey: CryptoKey;
};

export type InstanceAuthClientOptions = {
  appId?: string;
  mfid?: string;
  instance?: AuthInstance;
  apiBase?: string;
  clientId?: string;
  authPageUrl?: string;
  redirectUri?: string;
  origin?: string;
  credentialCarrier?: "cookie" | "bearer";
  openAuthUrl?: (url: string) => void | Promise<void>;
  allowInstanceCreation?: boolean;
};

export type AuthCallbackResult = {
  requestId: string;
  state: string;
  result: "approved" | "denied" | "error";
  resourceId?: string;
  error?: string;
  errorDescription?: string;
};

export type InstanceAuthClient = {
  ensureInstance(): Promise<AuthInstance>;
  authorize(request: { resourceId: string; capabilities: AuthCapability[]; callbackVersion?: 1; authMode?: "alias" }): Promise<void>;
  handleCallback(url?: string): Promise<AuthCallbackResult | null>;
  discardAuthorizationRequest(requestId: string): Promise<void>;
  getContext(resourceId: string): Promise<InstanceAuthContext | null>;
  getSession(resourceId: string, options?: { forceRefresh?: boolean }): Promise<CloudSessionCredential>;
  getBucketAccess(bucketId: string): Promise<BucketAccess>;
  clearContext(resourceId: string): Promise<void>;
};

type AuthGrantBucketKeyEnvelope = {
  kind: "bucket-key";
  bucketId: string;
  keyId: string;
  targetInstanceId: string;
  targetWrappingPublicJwk: JsonWebKey;
  ephemeralPublicJwk: JsonWebKey;
  wrapAlg: "ECDH-HKDF-SHA-256/AES-GCM-256";
  salt: string;
  iv: string;
  aad: string;
  ciphertext: string;
};

type BucketAccessGrant = {
  v: 1;
  grantRecordId: string;
  mfid: string;
  resourceId: string;
  instanceId: string;
  issuedAt: string;
  keyId: string;
  capabilities: AuthCapability[];
  envelope: AuthGrantBucketKeyEnvelope;
};

type StoredAuthAuthorizationResult = {
  v: 1;
  requestId: string;
  state: string;
  result: "approved";
  mfid: string;
  resourceId: string;
  instanceId: string;
  createdAt: string;
  bucketAccessGrant?: BucketAccessGrant;
  expiresAt?: string;
};

type EncryptedAuthAuthorizationResultEnvelope = {
  v: 1;
  typ: "auth.authorization-result.envelope.v1";
  alg: "ECDH-HKDF-SHA-256/AES-GCM-256";
  requestId: string;
  state: string;
  resourceId: string;
  instanceId: string;
  ephemeralPublicJwk: JsonWebKey;
  salt: string;
  iv: string;
  aad: string;
  ciphertext: string;
};

type AuthRequest = {
  clientId: string;
  callbackVersion?: 1;
  authMode?: "alias";
  requestId: string;
  state: string;
  redirectUri: string;
  origin: string;
  resourceId: string;
  capabilities: AuthCapability[];
  instanceId: string;
  instanceSigningPublicJwk: JsonWebKey;
  instanceWrappingPublicJwk: JsonWebKey;
  createdAt: string;
};

type PendingInstanceAuthRequest = {
  v: 1;
  requestId: string;
  state: string;
  resourceId: string;
  capabilities: AuthCapability[];
  instanceId: string;
};

type InstanceAuthCallbackPointer = {
  v: 1;
  requestId: string;
  resourceId: string;
  instanceId: string;
  pendingKey: string;
  createdAt: string;
};

type StoredAuthInstance = AuthInstance & { updatedAt: string };
type ActiveInstancePointer = { v: 1; instanceId: string; updatedAt: string };
type InstanceAuthStorage = {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
};

type StoredCloudSessionCredential = {
  v: 1;
  mfid: string;
  resourceId: string;
  instanceId: string;
  credential: CloudSessionCredential;
  storedAt?: string;
};

type InstanceProof = {
  type: "instance.es256";
  instanceId: string;
  alg: "ES256";
  signedAt: string;
  signature: string;
};

const AUTH_REQUEST_TTL_MS = 10 * 60 * 1000;
const AUTH_CALLBACK_FRAGMENT_PARAM = "mf_auth_result";
const DEFAULT_AUTH_IDB_NAME = "mf-auth-v1";
const DEFAULT_INSTANCE_AUTH_IDB_STORE = "instance";
const AUTH_IDB_BLOCKED_TIMEOUT_MS = 15_000;
const AUTH_IDB_SCHEMA_UPGRADE_MAX_ATTEMPTS = 5;
const BUCKET_ACCESS_CACHE_TTL_MS = 60_000;
const INSTANCE_SESSION_USABLE_WINDOW_MS = 2 * 60 * 1000;
const INSTANCE_SESSION_BEST_EFFORT_REFRESH_WINDOW_MS = 60 * 60 * 1000;

export function createInstanceAuthClient(options: InstanceAuthClientOptions = {}): InstanceAuthClient {
  let instance = options.instance || null;
  const appId = normalizeInstanceAppId(options.appId || options.clientId);
  let mfid = options.mfid || "";
  let currentResourceId = "";
  let currentSession: { resourceId: string; credential: CloudSessionCredential } | null = null;
  const inFlightSessionRefreshes = new Map<string, Promise<CloudSessionCredential>>();
  const storage = createDefaultInstanceAuthStorage();
  const bucketAccessCache = new Map<string, { access: BucketAccess; expiresAt: number }>();

  const activeInstanceKey = () => `instance:${authKeySegment(appId)}:active-instance:current`;
  const instanceKey = (instanceId: string) => `instance:${authKeySegment(appId)}:instance-key:${authKeySegment(instanceId)}`;
  const pendingAuthKey = (resourceId: string, instanceId: string) =>
    `instance:${authKeySegment(appId)}:pending-auth:${authKeySegment(resourceId)}:${authKeySegment(instanceId)}`;
  const callbackPointerKey = (requestId: string) => `instance:${authKeySegment(appId)}:callback-pointer:${authKeySegment(requestId)}`;
  const contextKey = (resourceId: string, instanceId: string) =>
    `instance:${authKeySegment(appId)}:context:${authKeySegment(resourceId)}:${authKeySegment(instanceId)}`;
  const sessionKey = (resourceId: string, instanceId: string) =>
    `instance:${authKeySegment(appId)}:session:${authKeySegment(resourceId)}:${authKeySegment(instanceId)}`;

  function isStoredAuthInstance(value: StoredAuthInstance | null, instanceId?: string): value is StoredAuthInstance {
    return (
      !!value &&
      value.v === 1 &&
      isValidInstanceId(value.instanceId) &&
      (!instanceId || value.instanceId === instanceId) &&
      value.signingPrivateKey instanceof CryptoKey &&
      value.wrappingPrivateKey instanceof CryptoKey
    );
  }

  async function setActiveInstance(instanceId: string): Promise<void> {
    await storage.set(activeInstanceKey(), { v: 1, instanceId, updatedAt: new Date().toISOString() } satisfies ActiveInstancePointer);
  }

  async function readStoredInstance(instanceId: string): Promise<StoredAuthInstance | null> {
    const stored = await storage.get<StoredAuthInstance>(instanceKey(instanceId));
    return isStoredAuthInstance(stored, instanceId) ? stored : null;
  }

  async function writeStoredInstance(authInstance: AuthInstance): Promise<StoredAuthInstance> {
    const existing = await readStoredInstance(authInstance.instanceId);
    const stored: StoredAuthInstance = {
      ...authInstance,
      updatedAt: new Date().toISOString(),
      createdAt: authInstance.createdAt || existing?.createdAt || new Date().toISOString(),
    };
    await storage.set(instanceKey(authInstance.instanceId), stored);
    const verified = await readStoredInstance(authInstance.instanceId);
    if (!verified) throw new Error("auth instance write did not persist keys");
    await setActiveInstance(authInstance.instanceId);
    instance = verified;
    return verified;
  }

  async function readActiveStoredInstance(): Promise<StoredAuthInstance | null> {
    const active = await storage.get<ActiveInstancePointer>(activeInstanceKey());
    if (!active || active.v !== 1 || !isValidInstanceId(active.instanceId)) return null;
    return readStoredInstance(active.instanceId);
  }

  async function ensureStoredInstance(): Promise<StoredAuthInstance> {
    if (instance) {
      const stored = await readStoredInstance(instance.instanceId);
      if (stored) return stored;
      return writeStoredInstance(instance);
    }
    const active = await readActiveStoredInstance();
    if (active) {
      instance = active;
      return active;
    }
    if (options.allowInstanceCreation === false) {
      throw new Error("no usable stored auth instance; re-authorize from the primary app context");
    }
    if (options.instance) return writeStoredInstance(options.instance);
    return writeStoredInstance(await generateAuthInstance());
  }

  async function readContext(resourceId: string): Promise<InstanceAuthContext | null> {
    if (!resolveAuthResourceId(resourceId)) return null;
    const authInstance = await readActiveStoredInstance();
    if (!authInstance) return null;
    const context = await storage.get<InstanceAuthContext>(contextKey(resourceId, authInstance.instanceId));
    if (
      !context ||
      context.v !== 1 ||
      !isValidMfid(context.mfid) ||
      context.resourceId !== resourceId ||
      context.instanceId !== authInstance.instanceId
    ) {
      return null;
    }
    mfid = context.mfid;
    currentResourceId = context.resourceId;
    instance = authInstance;
    return context;
  }

  async function writeContext(context: InstanceAuthContext): Promise<void> {
    mfid = context.mfid;
    currentResourceId = context.resourceId;
    const authInstance = await readStoredInstance(context.instanceId);
    if (!authInstance) throw new Error("stored instance missing");
    await storage.set(contextKey(context.resourceId, context.instanceId), context);
    await writeStoredInstance(authInstance);
  }

  async function invalidateSession(resourceId: string, instanceId: string): Promise<void> {
    if (currentSession?.resourceId === resourceId) currentSession = null;
    await storage.remove(sessionKey(resourceId, instanceId));
  }

  async function clearContext(resourceId: string): Promise<void> {
    if (!resolveAuthResourceId(resourceId)) return;
    const authInstance = await readActiveStoredInstance();
    if (!authInstance) {
      if (currentResourceId === resourceId) {
        mfid = "";
        currentResourceId = "";
        currentSession = null;
        bucketAccessCache.clear();
      }
      return;
    }
    await storage.remove(contextKey(resourceId, authInstance.instanceId));
    await storage.remove(sessionKey(resourceId, authInstance.instanceId));
    await writeStoredInstance(authInstance);
    if (currentResourceId === resourceId || instance?.instanceId === authInstance.instanceId) {
      mfid = "";
      currentResourceId = "";
      currentSession = null;
      bucketAccessCache.clear();
    }
  }

  async function getSessionForResource(resourceId: string, sessionOptions?: { forceRefresh?: boolean }): Promise<CloudSessionCredential> {
    const context = await readContext(resourceId);
    if (!mfid || !context) throw new Error("mfid required; handle an approved auth callback first");
    const authInstance = await ensureStoredInstance();
    if (authInstance.instanceId !== context.instanceId) throw new Error("stored instance does not match authorization context");
    const forceRefresh = sessionOptions?.forceRefresh === true;
    const carrier = options.credentialCarrier || "bearer";
    const refreshSessionKey = `${context.resourceId}:${authInstance.instanceId}:${carrier}`;

    const performRefreshSession = async (): Promise<CloudSessionCredential> => {
      const challenge = await postJson<{ challengeId: string; challenge: string }>(options.apiBase, "/v1/api/auth/instance-challenge", {
        mfid,
        resourceId: context.resourceId,
        instanceId: authInstance.instanceId,
      });
      const proof = await signInstanceChallenge({
        instance: authInstance,
        challengeId: challenge.challengeId,
        challenge: challenge.challenge,
        mfid,
        resourceId: context.resourceId,
      });
      const session = await postJson<{ credential: CloudSessionCredential }>(options.apiBase, "/v1/api/auth/instance-session", {
        mfid,
        resourceId: context.resourceId,
        instanceId: authInstance.instanceId,
        challengeId: challenge.challengeId,
        proof,
        credentialCarrier: carrier,
      });
      currentSession = { resourceId: context.resourceId, credential: session.credential };
      if (session.credential.carrier === "bearer") {
        await storage.set(sessionKey(context.resourceId, context.instanceId), {
          v: 1,
          mfid,
          resourceId: context.resourceId,
          instanceId: authInstance.instanceId,
          credential: session.credential,
          storedAt: new Date().toISOString(),
        } satisfies StoredCloudSessionCredential);
      }
      return session.credential;
    };

    const refreshSession = (): Promise<CloudSessionCredential> => {
      const inFlight = inFlightSessionRefreshes.get(refreshSessionKey);
      if (inFlight) return inFlight;
      const promise = performRefreshSession().finally(() => {
        if (inFlightSessionRefreshes.get(refreshSessionKey) === promise) inFlightSessionRefreshes.delete(refreshSessionKey);
      });
      inFlightSessionRefreshes.set(refreshSessionKey, promise);
      return promise;
    };

    if (!forceRefresh) {
      let cachedCredential: CloudSessionCredential | null = null;
      if (currentSession?.resourceId === context.resourceId && isSessionUsable(currentSession.credential, carrier)) {
        cachedCredential = currentSession.credential;
      } else {
        const stored = await storage.get<StoredCloudSessionCredential>(sessionKey(context.resourceId, context.instanceId));
        if (
          stored?.v === 1 &&
          stored.mfid === mfid &&
          stored.resourceId === context.resourceId &&
          stored.instanceId === authInstance.instanceId &&
          isSessionUsable(stored.credential, carrier)
        ) {
          currentSession = { resourceId: context.resourceId, credential: stored.credential };
          cachedCredential = stored.credential;
        }
      }
      if (cachedCredential) {
        if (shouldBestEffortRefreshSession(cachedCredential, carrier)) void refreshSession().catch(() => undefined);
        return cachedCredential;
      }
    }

    if (forceRefresh) inFlightSessionRefreshes.delete(refreshSessionKey);
    return refreshSession();
  }

  return {
    async ensureInstance() {
      return ensureStoredInstance();
    },
    async authorize(request) {
      const resolved = requireResolvedAuthResource(request.resourceId);
      const capabilities = normalizeCapabilitiesForResource(resolved.kind, request.capabilities);
      if (!capabilities.length) throw new Error("capabilities required");
      const authInstance = await ensureStoredInstance();
      currentResourceId = resolved.resourceId;
      const state = randomId("state");
      const requestId = randomId("req");
      const nextPendingKey = pendingAuthKey(resolved.resourceId, authInstance.instanceId);
      const authRequest = buildAuthRequestFragment({
        clientId: options.clientId || appId,
        ...(request.callbackVersion ? { callbackVersion: request.callbackVersion } : {}),
        ...(request.authMode === "alias" ? { authMode: "alias" as const } : {}),
        requestId,
        state,
        redirectUri: options.redirectUri || browserLocationHref(),
        origin: options.origin || browserLocationOrigin(),
        resourceId: resolved.resourceId,
        capabilities,
        instanceId: authInstance.instanceId,
        instanceSigningPublicJwk: authInstance.signingPublicJwk,
        instanceWrappingPublicJwk: authInstance.wrappingPublicJwk,
        createdAt: new Date().toISOString(),
      });
      await storage.set(nextPendingKey, { v: 1, requestId, state, resourceId: resolved.resourceId, capabilities, instanceId: authInstance.instanceId } satisfies PendingInstanceAuthRequest);
      await storage.set(callbackPointerKey(requestId), {
        v: 1,
        requestId,
        resourceId: resolved.resourceId,
        instanceId: authInstance.instanceId,
        pendingKey: nextPendingKey,
        createdAt: new Date().toISOString(),
      } satisfies InstanceAuthCallbackPointer);
      const authPageUrl = String(options.authPageUrl || "").trim();
      if (!authPageUrl) throw new Error("authPageUrl is required to authorize an instance");
      const authUrl = `${authPageUrl}${authRequest}`;
      if (options.openAuthUrl) {
        await options.openAuthUrl(authUrl);
        return;
      }
      if (typeof window === "undefined") throw new Error("browser window required for authorize redirect");
      window.location.href = authUrl;
    },
    async handleCallback(url) {
      const parsed = new URL(url || browserLocationHref(), browserLocationOrigin());
      let encryptedEnvelope: EncryptedAuthAuthorizationResultEnvelope | null = null;
      let encryptedEnvelopeInvalid = false;
      try {
        encryptedEnvelope = parseEncryptedAuthAuthorizationResultFragment(parsed.hash);
      } catch {
        encryptedEnvelopeInvalid = true;
      }
      const result: AuthCallbackResult = {
        requestId: parsed.searchParams.get("mf_request_id") || "",
        state: parsed.searchParams.get("state") || "",
        result: (parsed.searchParams.get("mf_result") || (parsed.searchParams.get("error") ? "error" : "")) as AuthCallbackResult["result"],
        ...(parsed.searchParams.get("error") ? { error: parsed.searchParams.get("error") || undefined } : {}),
        ...(parsed.searchParams.get("error_description") ? { errorDescription: parsed.searchParams.get("error_description") || undefined } : {}),
      };
      if (!result.requestId || !result.state || !["approved", "denied", "error"].includes(result.result)) return null;
      const pointer = await storage.get<InstanceAuthCallbackPointer>(callbackPointerKey(result.requestId));
      if (!pointer || pointer.v !== 1 || pointer.requestId !== result.requestId || !isFresh(pointer.createdAt)) return null;
      const expected = await storage.get<PendingInstanceAuthRequest>(pointer.pendingKey);
      if (!expected || expected.v !== 1 || expected.requestId !== result.requestId || expected.state !== result.state) return null;
      result.resourceId = expected.resourceId;
      if (result.result === "approved") {
        if (encryptedEnvelopeInvalid || !encryptedEnvelope) {
          return { ...result, result: "error", error: "server_error", errorDescription: "authorization_result_invalid" };
        }
        const authInstance = await readStoredInstance(expected.instanceId);
        if (!authInstance) return { ...result, result: "error", error: "server_error", errorDescription: "authorization_instance_missing" };
        let stored: StoredAuthAuthorizationResult;
        try {
          stored = await decryptEncryptedAuthAuthorizationResult({
            envelope: encryptedEnvelope,
            instanceWrappingPrivateKey: authInstance.wrappingPrivateKey,
            expectedRequestId: result.requestId,
            expectedState: result.state,
            expectedResourceId: expected.resourceId,
            expectedInstanceId: expected.instanceId,
          });
        } catch {
          return { ...result, result: "error", error: "server_error", errorDescription: "authorization_result_invalid" };
        }
        if (stored.resourceId !== pointer.resourceId || stored.instanceId !== pointer.instanceId) {
          return { ...result, result: "error", error: "server_error", errorDescription: "authorization_context_mismatch" };
        }
        await writeContext({
          v: 1,
          mfid: stored.mfid,
          resourceId: stored.resourceId,
          instanceId: stored.instanceId,
          requestId: result.requestId,
          authorizedAt: new Date().toISOString(),
          ...(stored.bucketAccessGrant ? { bucketAccessGrant: stored.bucketAccessGrant } : {}),
        });
        await invalidateSession(stored.resourceId, stored.instanceId);
        bucketAccessCache.clear();
      }
      await storage.remove(pointer.pendingKey);
      await storage.remove(callbackPointerKey(result.requestId));
      return result;
    },
    async discardAuthorizationRequest(requestId) {
      const safeRequestId = String(requestId || "").trim();
      if (!safeRequestId) return;
      const pointer = await storage.get<InstanceAuthCallbackPointer>(callbackPointerKey(safeRequestId));
      if (!pointer || pointer.v !== 1 || pointer.requestId !== safeRequestId) return;
      await storage.remove(pointer.pendingKey);
      await storage.remove(callbackPointerKey(safeRequestId));
    },
    getContext: readContext,
    getSession: getSessionForResource,
    async getBucketAccess(bucketId) {
      const resourceId = bucketResourceId(bucketId);
      const context = await readContext(resourceId);
      if (!mfid || !context) throw new Error("mfid required; handle an approved auth callback first");
      if (bucketIdFromResourceId(context.resourceId) !== bucketId) throw new Error("bucketId does not match authorization context");
      const authInstance = await ensureStoredInstance();
      if (authInstance.instanceId !== context.instanceId) throw new Error("stored instance does not match authorization context");
      const cacheKey = `${mfid}:${bucketId}:${authInstance.instanceId}`;
      const cached = bucketAccessCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) return cached.access;
      const bucketGrant = normalizeBucketAccessGrant(context.bucketAccessGrant);
      if (!bucketGrant) throw new Error("bucket access grant unavailable; reauthorize required");
      const access = await unwrapBucketAccess(
        { mfid, bucketId, instanceId: authInstance.instanceId, capabilities: bucketGrant.capabilities, bucketAccessGrant: bucketGrant },
        authInstance.wrappingPrivateKey,
        ["read", "write"]
      );
      bucketAccessCache.set(cacheKey, { access, expiresAt: Date.now() + BUCKET_ACCESS_CACHE_TTL_MS });
      return access;
    },
    clearContext,
  };
}

function createDefaultInstanceAuthStorage(): InstanceAuthStorage {
  const storageOptions = { dbName: DEFAULT_AUTH_IDB_NAME, storeName: DEFAULT_INSTANCE_AUTH_IDB_STORE };
  return {
    get: (key) => indexedDbGet(key, storageOptions),
    set: (key, value) => indexedDbSet(key, value, storageOptions),
    remove: (key) => indexedDbDelete(key, storageOptions),
  };
}

async function generateAuthInstance(): Promise<AuthInstance> {
  const signing = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const wrapping = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const signingPublicJwk = (await crypto.subtle.exportKey("jwk", signing.publicKey)) as JsonWebKey;
  const wrappingPublicJwk = (await crypto.subtle.exportKey("jwk", wrapping.publicKey)) as JsonWebKey;
  return {
    v: 1,
    instanceId: await deriveInstanceId(signingPublicJwk),
    signingPublicJwk,
    signingPrivateKey: signing.privateKey,
    wrappingPublicJwk,
    wrappingPrivateKey: wrapping.privateKey,
    createdAt: new Date().toISOString(),
  };
}

async function deriveInstanceId(signingPublicJwk: JsonWebKey): Promise<string> {
  const digest = await sha256Hex(stableStringify(jwkCore(signingPublicJwk)));
  return `inst_${digest.slice(0, 32)}`;
}

async function signInstanceChallenge(input: {
  instance: Pick<AuthInstance, "instanceId" | "signingPrivateKey">;
  challenge: string;
  mfid: string;
  resourceId: string;
  challengeId?: string;
  signedAt?: string;
}): Promise<InstanceProof> {
  const signedAt = normalizeIsoDateTime(input.signedAt) || new Date().toISOString();
  const payload = stableStringify({
    v: 1,
    type: "instance-proof",
    instanceId: input.instance.instanceId,
    challenge: input.challenge,
    challengeId: input.challengeId || "",
    mfid: input.mfid,
    resourceId: input.resourceId,
    signedAt,
  });
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, input.instance.signingPrivateKey, new TextEncoder().encode(payload));
  return { type: "instance.es256", instanceId: input.instance.instanceId, alg: "ES256", signedAt, signature: bytesToB64url(new Uint8Array(signature)) };
}

function buildAuthRequestFragment(request: AuthRequest): string {
  validateAuthRequestForBuild(request);
  const resource = requireResolvedAuthResource(request.resourceId);
  const clientId = String(request.clientId || (resource.kind === "service" ? resource.serviceId : resource.bucketId) || "").trim();
  const wire = {
    response_type: "code",
    client_id: clientId,
    redirect_uri: request.redirectUri,
    state: request.state,
    scope: capabilitiesToScope(request.capabilities),
    resource_id: resource.resourceId,
    ...(request.callbackVersion ? { mf_v: request.callbackVersion } : {}),
    ...(request.authMode === "alias" ? { mf_auth_mode: "alias" } : {}),
    mf_request_id: request.requestId,
    mf_instance_id: request.instanceId,
    mf_instance_signing_jwk: request.instanceSigningPublicJwk,
    mf_instance_wrapping_jwk: request.instanceWrappingPublicJwk,
    mf_issued_at: request.createdAt,
  };
  return `#authRequest=${bytesToB64url(new TextEncoder().encode(stableStringify(wire)))}`;
}

function parseEncryptedAuthAuthorizationResultFragment(fragmentOrUrl: string): EncryptedAuthAuthorizationResultEnvelope | null {
  const input = String(fragmentOrUrl || "");
  const rawFragment = input.includes("#") ? input.slice(input.indexOf("#") + 1) : input.replace(/^#/, "");
  if (!rawFragment) return null;
  const encoded = new URLSearchParams(rawFragment).get(AUTH_CALLBACK_FRAGMENT_PARAM);
  if (!encoded) return null;
  const envelope = JSON.parse(new TextDecoder().decode(b64urlToBytes(encoded))) as Partial<EncryptedAuthAuthorizationResultEnvelope> | null;
  if (
    !envelope ||
    envelope.v !== 1 ||
    envelope.typ !== "auth.authorization-result.envelope.v1" ||
    envelope.alg !== "ECDH-HKDF-SHA-256/AES-GCM-256" ||
    typeof envelope.requestId !== "string" ||
    typeof envelope.state !== "string" ||
    !resolveAuthResourceId(envelope.resourceId) ||
    !isValidInstanceId(envelope.instanceId || "") ||
    !isPublicP256EcJwk(envelope.ephemeralPublicJwk) ||
    typeof envelope.salt !== "string" ||
    typeof envelope.iv !== "string" ||
    typeof envelope.aad !== "string" ||
    typeof envelope.ciphertext !== "string"
  ) {
    throw new Error("auth callback result fragment invalid");
  }
  return envelope as EncryptedAuthAuthorizationResultEnvelope;
}

async function decryptEncryptedAuthAuthorizationResult(input: {
  envelope: EncryptedAuthAuthorizationResultEnvelope;
  instanceWrappingPrivateKey: CryptoKey;
  expectedRequestId?: string;
  expectedState?: string;
  expectedResourceId?: string;
  expectedInstanceId?: string;
}): Promise<StoredAuthAuthorizationResult> {
  const { envelope } = input;
  if (
    (input.expectedRequestId && envelope.requestId !== input.expectedRequestId) ||
    (input.expectedState && envelope.state !== input.expectedState) ||
    (input.expectedResourceId && envelope.resourceId !== input.expectedResourceId) ||
    (input.expectedInstanceId && envelope.instanceId !== input.expectedInstanceId)
  ) {
    throw new Error("auth callback result mismatch");
  }
  const ephemeralPublic = await crypto.subtle.importKey("jwk", envelope.ephemeralPublicJwk, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const wrappingKey = await deriveEcdhAesGcmKey({
    privateKey: input.instanceWrappingPrivateKey,
    publicKey: ephemeralPublic,
    salt: b64urlToBytes(envelope.salt),
    info: envelope.aad,
    usages: ["decrypt"],
  });
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64urlToBytes(envelope.iv), additionalData: new TextEncoder().encode(envelope.aad) },
    wrappingKey,
    b64urlToBytes(envelope.ciphertext)
  );
  const result = normalizeAuthAuthorizationResult(JSON.parse(new TextDecoder().decode(plaintext)), envelope.requestId);
  if (
    !result ||
    result.state !== envelope.state ||
    result.resourceId !== envelope.resourceId ||
    result.instanceId !== envelope.instanceId ||
    (input.expectedState && result.state !== input.expectedState) ||
    (input.expectedResourceId && result.resourceId !== input.expectedResourceId) ||
    (input.expectedInstanceId && result.instanceId !== input.expectedInstanceId)
  ) {
    throw new Error("auth callback result mismatch");
  }
  return result;
}

async function unwrapBucketAccess(
  access: { mfid: string; bucketId: string; instanceId: string; capabilities: AuthCapability[]; bucketAccessGrant?: BucketAccessGrant },
  instanceWrappingPrivateKey: CryptoKey,
  requiredCapabilities: AuthCapability[] = []
): Promise<BucketAccess> {
  const accessGrant = normalizeBucketAccessGrant(access.bucketAccessGrant);
  const capabilities = normalizeCapabilitiesForResource("bucket", access.capabilities);
  if (
    !accessGrant ||
    accessGrant.mfid !== access.mfid ||
    accessGrant.resourceId !== bucketResourceId(access.bucketId) ||
    accessGrant.instanceId !== access.instanceId ||
    !capabilities.every((capability) => accessGrant.capabilities.includes(capability)) ||
    !requiredCapabilities.every((capability) => capabilities.includes(capability) && accessGrant.capabilities.includes(capability))
  ) {
    throw new Error("bucket access grant does not match access");
  }
  return {
    mfid: access.mfid,
    instanceId: access.instanceId,
    bucketId: access.bucketId,
    capabilities,
    grantRecordId: accessGrant.grantRecordId,
    keyId: accessGrant.keyId,
    bucketKey: await unwrapBucketKeyFromGrant(accessGrant.envelope, instanceWrappingPrivateKey),
  };
}

async function unwrapBucketKeyFromGrant(envelope: AuthGrantBucketKeyEnvelope, instanceWrappingPrivateKey: CryptoKey): Promise<CryptoKey> {
  const ephemeralPublic = await crypto.subtle.importKey("jwk", envelope.ephemeralPublicJwk, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const wrappingKey = await deriveEcdhAesGcmKey({
    privateKey: instanceWrappingPrivateKey,
    publicKey: ephemeralPublic,
    salt: b64urlToBytes(envelope.salt),
    info: envelope.aad,
    usages: ["unwrapKey", "decrypt"],
  });
  const wrapped = b64urlToBytes(envelope.ciphertext);
  try {
    return await crypto.subtle.unwrapKey(
      "raw",
      wrapped,
      wrappingKey,
      { name: "AES-GCM", iv: b64urlToBytes(envelope.iv), additionalData: new TextEncoder().encode(envelope.aad) },
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  } catch {
    const raw = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64urlToBytes(envelope.iv), additionalData: new TextEncoder().encode(envelope.aad) },
      wrappingKey,
      wrapped
    );
    return crypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
}

function normalizeAuthAuthorizationResult(value: unknown, expectedRequestId?: string): StoredAuthAuthorizationResult | null {
  const row = value as Partial<StoredAuthAuthorizationResult> | null;
  if (
    !row ||
    row.v !== 1 ||
    row.result !== "approved" ||
    typeof row.requestId !== "string" ||
    (expectedRequestId && row.requestId !== expectedRequestId) ||
    typeof row.state !== "string" ||
    !isValidMfid(row.mfid || "") ||
    !resolveAuthResourceId(row.resourceId) ||
    !isValidInstanceId(row.instanceId || "") ||
    typeof row.createdAt !== "string"
  ) {
    return null;
  }
  if (row.expiresAt !== undefined) {
    const expiresAt = Date.parse(String(row.expiresAt));
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  }
  const resolvedResource = resolveAuthResourceId(row.resourceId);
  if (!resolvedResource) return null;
  const bucketAccessGrant = normalizeBucketAccessGrant(row.bucketAccessGrant);
  if (resolvedResource.kind !== "bucket" || !bucketAccessGrant) return null;
  if (
    bucketAccessGrant.mfid !== row.mfid ||
    bucketAccessGrant.resourceId !== resolvedResource.resourceId ||
    bucketAccessGrant.instanceId !== row.instanceId
  ) {
    return null;
  }
  return {
    v: 1,
    requestId: row.requestId,
    state: row.state,
    result: "approved",
    mfid: row.mfid!,
    resourceId: resolvedResource.resourceId,
    instanceId: row.instanceId!,
    createdAt: row.createdAt,
    ...(bucketAccessGrant ? { bucketAccessGrant } : {}),
    ...(row.expiresAt ? { expiresAt: row.expiresAt } : {}),
  };
}

function normalizeBucketAccessGrant(value: unknown): BucketAccessGrant | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Partial<BucketAccessGrant>;
  const resource = resolveAuthResourceId(row.resourceId);
  const capabilities = normalizeCapabilitiesForResource("bucket", row.capabilities);
  if (
    row.v !== 1 ||
    !/^ar_[a-f0-9]{32}$/.test(String(row.grantRecordId || "")) ||
    !isValidMfid(row.mfid) ||
    !resource ||
    resource.kind !== "bucket" ||
    !isValidInstanceId(row.instanceId) ||
    !/^bk_[a-f0-9]{32}$/.test(String(row.keyId || "")) ||
    capabilities.length < 1 ||
    !isValidAuthGrantBucketKeyEnvelope(row.envelope, resource.bucketId, row.instanceId, row.keyId)
  ) {
    return null;
  }
  return {
    v: 1,
    grantRecordId: row.grantRecordId!,
    mfid: row.mfid!,
    resourceId: resource.resourceId,
    instanceId: row.instanceId!,
    issuedAt: String(row.issuedAt || ""),
    keyId: row.keyId!,
    capabilities,
    envelope: row.envelope as AuthGrantBucketKeyEnvelope,
  };
}

function isValidAuthGrantBucketKeyEnvelope(value: unknown, bucketId?: string, instanceId?: string, keyId?: string): value is AuthGrantBucketKeyEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<AuthGrantBucketKeyEnvelope>;
  if (
    row.kind !== "bucket-key" ||
    !isValidBucketId(row.bucketId) ||
    !/^bk_[a-f0-9]{32}$/.test(String(row.keyId || "")) ||
    !isValidInstanceId(row.targetInstanceId) ||
    row.wrapAlg !== "ECDH-HKDF-SHA-256/AES-GCM-256" ||
    !isPublicP256EcJwk(row.targetWrappingPublicJwk) ||
    !isPublicP256EcJwk(row.ephemeralPublicJwk) ||
    typeof row.salt !== "string" ||
    typeof row.iv !== "string" ||
    typeof row.aad !== "string" ||
    typeof row.ciphertext !== "string"
  ) {
    return false;
  }
  if (bucketId && row.bucketId !== bucketId) return false;
  if (instanceId && row.targetInstanceId !== instanceId) return false;
  if (keyId && row.keyId !== keyId) return false;
  return true;
}

function bucketResourceId(bucketId: string): string {
  return `urn:myfield:bucket:${bucketId}`;
}

type ResolvedAuthResource =
  | { kind: "bucket"; resourceId: string; bucketId: string }
  | { kind: "service"; resourceId: string; serviceId: string };

function resolveAuthResourceId(resourceId: unknown): ResolvedAuthResource | null {
  const safe = typeof resourceId === "string" ? resourceId.trim() : "";
  const bucketPrefix = "urn:myfield:bucket:";
  const servicePrefix = "urn:myfield:service:";
  if (safe.startsWith(bucketPrefix)) {
    const bucketId = safe.slice(bucketPrefix.length);
    return isValidBucketId(bucketId) ? { kind: "bucket", resourceId: safe, bucketId } : null;
  }
  if (safe.startsWith(servicePrefix)) {
    const serviceId = safe.slice(servicePrefix.length);
    return isValidBucketId(serviceId) ? { kind: "service", resourceId: safe, serviceId } : null;
  }
  return null;
}

function requireResolvedAuthResource(resourceId: unknown): ResolvedAuthResource {
  const resolved = resolveAuthResourceId(resourceId);
  if (!resolved) throw new Error("invalid resourceId");
  return resolved;
}

function bucketIdFromResourceId(resourceId: unknown): string | null {
  const resolved = resolveAuthResourceId(resourceId);
  return resolved?.kind === "bucket" ? resolved.bucketId : null;
}

function normalizeCapabilities(input: unknown): AuthCapability[] {
  if (!Array.isArray(input)) return [];
  const allowed = new Set<AuthCapability>(["read", "write", "invoke"]);
  const result: AuthCapability[] = [];
  for (const item of input) {
    if (allowed.has(item as AuthCapability) && !result.includes(item as AuthCapability)) result.push(item as AuthCapability);
  }
  return result.sort();
}

function normalizeCapabilitiesForResource(kind: AuthResourceKind, input: unknown): AuthCapability[] {
  const requested = normalizeCapabilities(input);
  const allowed = kind === "service" ? new Set<AuthCapability>(["invoke"]) : new Set<AuthCapability>(["read", "write"]);
  return requested.filter((capability) => allowed.has(capability));
}

function capabilitiesToScope(capabilities: AuthCapability[]): string {
  return normalizeCapabilities(capabilities).join(" ");
}

function validateAuthRequestForBuild(request: AuthRequest): void {
  if (!request.requestId || !request.state) throw new Error("auth request state required");
  const parsedResource = requireResolvedAuthResource(request.resourceId);
  if (!String(request.clientId || (parsedResource.kind === "service" ? parsedResource.serviceId : parsedResource.bucketId) || "").trim()) throw new Error("client_id required");
  if (!isValidInstanceId(request.instanceId)) throw new Error("invalid instanceId");
  if (!normalizeCapabilitiesForResource(parsedResource.kind, request.capabilities).length) throw new Error("capabilities required");
  if (!isPublicP256EcJwk(request.instanceSigningPublicJwk)) throw new Error("instanceSigningPublicJwk required");
  if (!isPublicP256EcJwk(request.instanceWrappingPublicJwk)) throw new Error("instanceWrappingPublicJwk required");
  const redirect = new URL(request.redirectUri);
  const origin = new URL(request.origin);
  if (redirect.origin !== origin.origin) throw new Error("redirectUri origin mismatch");
}

function createAuthIdbStorage(options?: { dbName?: string; storeName?: string }): Promise<{ db: IDBDatabase; storeName: string }> {
  if (typeof indexedDB === "undefined") throw new Error("indexedDB unavailable");
  const dbName = options?.dbName || DEFAULT_AUTH_IDB_NAME;
  const storeName = options?.storeName || DEFAULT_INSTANCE_AUTH_IDB_STORE;
  const requiredStoreNames = Array.from(new Set([DEFAULT_INSTANCE_AUTH_IDB_STORE, storeName]));
  const open = (version?: number) =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const req = version == null ? indexedDB.open(dbName) : indexedDB.open(dbName, version);
      let blockedTimer: ReturnType<typeof setTimeout> | null = null;
      let settled = false;
      const finish = (db: IDBDatabase) => {
        if (settled) return;
        settled = true;
        if (blockedTimer) clearTimeout(blockedTimer);
        db.onversionchange = () => db.close();
        resolve(db);
      };
      req.onupgradeneeded = () => {
        for (const name of requiredStoreNames) {
          if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
        }
      };
      req.onsuccess = () => finish(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => {
        blockedTimer = setTimeout(() => reject(new Error("auth idb open blocked")), AUTH_IDB_BLOCKED_TIMEOUT_MS);
      };
    });
  return open().then(async (db) => {
    const missing = requiredStoreNames.some((name) => !db.objectStoreNames.contains(name));
    if (!missing) return { db, storeName };
    const nextVersion = db.version + 1;
    db.close();
    const upgraded = await open(nextVersion);
    return { db: upgraded, storeName };
  });
}

async function withAuthIdb<T>(options: { dbName?: string; storeName?: string } | undefined, fn: (db: IDBDatabase, storeName: string) => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < AUTH_IDB_SCHEMA_UPGRADE_MAX_ATTEMPTS; attempt += 1) {
    let db: IDBDatabase | null = null;
    try {
      const opened = await createAuthIdbStorage(options);
      db = opened.db;
      return await fn(opened.db, opened.storeName);
    } catch (error) {
      lastError = error;
    } finally {
      db?.close();
    }
  }
  throw lastError instanceof Error ? lastError : new Error("auth idb operation failed");
}

async function indexedDbGet<T>(key: string, options?: { dbName?: string; storeName?: string }): Promise<T | null> {
  return withAuthIdb(
    options,
    (db, storeName) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly");
        const req = tx.objectStore(storeName).get(key);
        let result: T | null = null;
        req.onsuccess = () => {
          result = (req.result as T) ?? null;
        };
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("auth idb get aborted"));
      })
  );
}

async function indexedDbSet(key: string, value: unknown, options?: { dbName?: string; storeName?: string }): Promise<void> {
  return withAuthIdb(
    options,
    (db, storeName) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        const req = tx.objectStore(storeName).put(value, key);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("auth idb set aborted"));
      })
  );
}

async function indexedDbDelete(key: string, options?: { dbName?: string; storeName?: string }): Promise<void> {
  return withAuthIdb(
    options,
    (db, storeName) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        const req = tx.objectStore(storeName).delete(key);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("auth idb delete aborted"));
      })
  );
}

async function deriveEcdhAesGcmKey(input: { privateKey: CryptoKey; publicKey: CryptoKey; salt: Uint8Array; info: string; usages: KeyUsage[] }): Promise<CryptoKey> {
  const sharedBits = await crypto.subtle.deriveBits({ name: "ECDH", public: input.publicKey }, input.privateKey, 256);
  const material = await crypto.subtle.importKey("raw", sharedBits, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: input.salt, info: new TextEncoder().encode(input.info) },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    input.usages
  );
}

async function postJson<T>(apiBase: string | undefined, path: string, body: unknown, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(`${apiBase || ""}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(headers || {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${path} failed: ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  return (await res.json()) as T;
}

function authHeaders(session: CloudSessionCredential | null): Record<string, string> {
  return session?.carrier === "bearer" ? { authorization: `Bearer ${session.token}` } : {};
}

function getSessionRemainingMs(session: CloudSessionCredential | null, carrier: "cookie" | "bearer"): number | null {
  if (!session || session.carrier !== carrier) return null;
  const expiresAt = Date.parse(session.expiresAt);
  return Number.isFinite(expiresAt) ? expiresAt - Date.now() : null;
}

function isSessionUsable(session: CloudSessionCredential | null, carrier: "cookie" | "bearer"): session is CloudSessionCredential {
  const remainingMs = getSessionRemainingMs(session, carrier);
  return remainingMs !== null && remainingMs > INSTANCE_SESSION_USABLE_WINDOW_MS;
}

function shouldBestEffortRefreshSession(session: CloudSessionCredential, carrier: "cookie" | "bearer"): boolean {
  const remainingMs = getSessionRemainingMs(session, carrier);
  return remainingMs !== null && remainingMs > INSTANCE_SESSION_USABLE_WINDOW_MS && remainingMs <= INSTANCE_SESSION_BEST_EFFORT_REFRESH_WINDOW_MS;
}

function isFresh(createdAt: string): boolean {
  const created = Date.parse(createdAt);
  return Number.isFinite(created) && Date.now() - created <= AUTH_REQUEST_TTL_MS;
}

function isValidBucketId(value: unknown): value is string {
  const safe = typeof value === "string" ? value.trim() : "";
  return /^[a-z0-9](?:[a-z0-9.-]{0,61}[a-z0-9])?$/.test(safe) && !safe.includes("..");
}

function isValidInstanceId(value: unknown): value is string {
  return typeof value === "string" && /^inst_[a-f0-9]{32}$/.test(value);
}

function isValidMfid(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
}

function isPublicP256EcJwk(value: unknown): value is JsonWebKey {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const jwk = value as JsonWebKey;
  return jwk.kty === "EC" && jwk.crv === "P-256" && typeof jwk.x === "string" && jwk.x.length > 0 && typeof jwk.y === "string" && jwk.y.length > 0;
}

function normalizeInstanceAppId(value: unknown): string {
  const safe = typeof value === "string" ? value.trim() : "";
  return isValidBucketId(safe) ? safe : "myfield.auth";
}

function authKeySegment(value: string): string {
  return encodeURIComponent(value);
}

function browserLocationHref(): string {
  if (typeof window === "undefined") throw new Error("browser window required");
  return window.location.href;
}

function browserLocationOrigin(): string {
  if (typeof window === "undefined") throw new Error("browser window required");
  return window.location.origin;
}

function randomId(prefix: string, byteLength = 16): string {
  return `${prefix}_${bytesToHex(crypto.getRandomValues(new Uint8Array(byteLength)))}`;
}

async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return bytesToHex(new Uint8Array(digest));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesToB64url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i] || 0);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlToBytes(value: string): Uint8Array {
  const safe = String(value || "").trim();
  const pad = "=".repeat((4 - (safe.length % 4)) % 4);
  const binary = atob((safe + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function normalizeIsoDateTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const safe = value.trim();
  if (!safe) return null;
  const date = new Date(/Z|[+-]\d{2}:\d{2}$/.test(safe) ? safe : `${safe}Z`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function jwkCore(jwk: JsonWebKey): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ["kty", "crv", "x", "y", "kid", "alg", "use"] as const) {
    const value = (jwk as Record<string, unknown>)[key];
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortJson(item)]));
}
