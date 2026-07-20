# Encrypted Sync

My Card sync is an optional, local-first feature. Local IndexedDB remains the
app source of truth; cloud sync is an encrypted transport layer for moving the
same objects across the user's devices.

The implementation follows the standalone notepad demo pattern: a local
persistent sync index with a saved remote head, an encrypted remote list object,
per-object CAS push/pull, and `feed/stream` as a change hint. It does not use
the worker snapshot API.

## Objects

All remote payloads are encrypted. The platform may route object ids and bucket
protocol metadata, but must not receive card plaintext, photo plaintext, or
portable share-link keys.

| Object | Purpose |
| --- | --- |
| `index:cards` | Encrypted list of local card objects. |
| `mine:<cardId>` | One authored card. |
| `received:<entryId>` | One received card. |
| `asset:<assetId>` | One original image asset. |

`index:cards` is the encrypted remote list and publication manifest. Locally,
the app keeps a persistent sync index record with the last known index head
version. The local index can be repaired from `mine`, `received`,
`deletedCards`, and `assets` stores, but sync does not rely on a fresh
projection alone.

```ts
interface CardSyncIndex {
  v: 1;
  updatedAt: string;
  entries: CardSyncIndexEntry[];
}

interface CardSyncIndexEntry {
  id: string;
  kind: "mine" | "received";
  objectId: `mine:${string}` | `received:${string}`;
  updatedAt: string;
  receivedAt?: string;
  assetIds?: string[];
  deleted?: true;
}
```

The index should not contain contact summaries unless that decision is reviewed
again. Keeping it encrypted and metadata-light preserves the current privacy
boundary.

## Payloads

`mine:<cardId>` stores `MineCard`.

`received:<entryId>` stores `ReceivedEntry`.

`asset:<assetId>` stores the original image asset:

```ts
interface CardSyncAsset {
  v: 1;
  id: string;
  mediaType: string;
  contentHash: string;
  dataUrl: string;
  createdAt: string;
}
```

`previewDataUrl` is a local thumbnail cache and is not synced. New devices
generate previews on demand from the original asset. `cardPhoto.transform` is
synced because it is a user edit, not a cache.

## Merge

On CAS conflict, the client pulls the remote head, decrypts it, merges according
to object type, then pushes the merged payload with the remote head as the
parent/expected head.

| Object | Merge policy |
| --- | --- |
| `index:cards` | Union by entry id, entry-level LWW by `updatedAt`. |
| `mine:<cardId>` | Whole-object LWW by `updatedAt`. |
| `received:<entryId>` | Whole-object LWW by `updatedAt`. |
| `asset:<assetId>` | Immutable. If remote exists, compare `contentHash`; same hash means synced, different hash is treated as an abnormal conflict, keeps the local copy, and records a warning. |

Card field-level LWW is intentionally out of scope. `CardData` does not gain
per-field timestamps or stable item ids in this sync version.

Payload envelopes use a per-version data encryption key wrapped by the bucket
key. AAD binds `bucketId`, `objectId`, and `versionId`; `contentHash` is derived
from the encrypted version payload, not plaintext.

Deletes are represented in `index:cards` as `deleted: true` entries backed by a
local tombstone store, so index merges do not resurrect older remote records.
Remote object garbage collection is a later concern.

## Transport

The sync client should use:

- per-object `current`/`payload` reads;
- CAS `commit` writes;
- `feed/stream` for remote-change hints;
- no worker snapshot enumeration.

Feed events are hints only. The client still fetches the current head before
applying changes.

## Local Behavior

All user actions write local IndexedDB first. Sync runs after the local write and
must not block normal editing, receiving, scanning, or photo capture.
User-visible card changes schedule a debounced sync push with a bounded max
wait; local thumbnail cache updates do not trigger sync.

On a local change, the client compares the current IndexedDB projection against
the last saved local sync index and pushes only changed card/asset payloads
first. It publishes `index:cards` only after those payloads are available
remotely, so a remote device that receives the index hint can immediately pull
the referenced object content.

On a remote index change, the client compares the remote index against the
current local projection and pulls only entries whose index record changed. If
the remote head already contains the merged index or object payload, the client
updates local head metadata and does not create a new version. This prevents
feed hints from causing self-triggered push loops.

Settings should expose sync state: local only, connecting, syncing, connected,
needs attention, and last sync time. Failed asset sync must not block text card
sync.

## Implementation Order

Implemented:

- pure sync object model and index merge tests;
- local IndexedDB projection into `index:cards`;
- encrypted bucket payload helpers;
- per-object bucket sync client;
- sync controller and Settings UI;
- Myfield instance auth and bucket access wiring.

Still requires live release verification with a real Myfield account and
deployed bucket API before treating cloud sync as production-proven.
