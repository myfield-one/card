import { ClientError, type InstanceKey } from "@myfield/sdk";

const database = "mf-auth-v1";
const store = "instance";

export async function readLegacyInstanceKey(appId: string): Promise<InstanceKey | null> {
  const opened = await new Promise<IDBDatabase | null>((resolve, reject) => {
    const request = indexedDB.open(database);
    let missing = false;
    request.onupgradeneeded = () => {
      missing = true;
      request.transaction?.abort();
    };
    request.onerror = () => missing ? resolve(null) : reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  if (!opened) return null;
  const db = opened;

  function get<T>(key: string): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      const request = db.transaction(store, "readonly").objectStore(store).get(key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  try {
    if (!db.objectStoreNames.contains(store)) return null;
    const prefix = `instance:${encodeURIComponent(appId)}:`;
    const active = await get<{ v: number; instanceId: string }>(`${prefix}active-instance:current`);
    if (active?.v !== 1 || typeof active.instanceId !== "string") return null;
    const key = await get<InstanceKey & { v: number }>(`${prefix}instance-key:${encodeURIComponent(active.instanceId)}`);
    if (key?.v !== 1 || key.instanceId !== active.instanceId) return null;
    const { instanceId, signingPublicJwk, signingPrivateKey, wrappingPublicJwk, wrappingPrivateKey, createdAt } = key;
    return { instanceId, signingPublicJwk, signingPrivateKey, wrappingPublicJwk, wrappingPrivateKey, createdAt };
  } finally {
    db.close();
  }
}

type IdentityTarget = {
  getKey(): Promise<InstanceKey | null>;
  importKey(key: InstanceKey): Promise<void>;
};

export async function importLegacyIdentity(
  instance: IdentityTarget,
  readLegacy: () => Promise<InstanceKey | null>,
): Promise<void> {
  if (await instance.getKey()) return;
  const legacy = await readLegacy();
  if (!legacy) return;
  try {
    await instance.importKey(legacy);
  } catch (error) {
    if (!(error instanceof ClientError) || error.code !== "INVALID_INSTANCE_KEY") throw error;
    console.warn("[sync] Legacy Card key could not be imported");
  }
}

export async function needsSyncReconnect(
  reconnected: boolean,
  dismissed: boolean,
  readLegacy: () => Promise<InstanceKey | null>,
): Promise<boolean> {
  if (reconnected || dismissed) return false;
  try {
    return Boolean(await readLegacy());
  } catch {
    return false;
  }
}
