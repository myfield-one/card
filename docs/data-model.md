# Data Model

My Card is local-first. Contact data stays on this device unless the user
explicitly creates a share link. The server never receives contact plaintext
or the share-link decryption key.

Runtime source of truth: `src/crypto.ts` and `src/storage.ts`.
Schemas: [`schemas/card-data.schema.json`](schemas/card-data.schema.json),
[`schemas/mine-card.schema.json`](schemas/mine-card.schema.json), and
[`schemas/received-entry.schema.json`](schemas/received-entry.schema.json).

## CardData

`CardData` is the single card payload used for authored cards, received
cards, photographed cards, share links, and vCard export.

```ts
interface CardData {
  v: 2;
  id: string;
  contact: ContactInfo;
  profile?: CardProfile;
  assets?: CardAsset[];
}
```

`contact` is vCard-aligned:

| Field | vCard | Notes |
| --- | --- | --- |
| `fn` | `FN` | May be empty before a photo card is recognized. |
| `title` | `TITLE` | Optional. |
| `org` | `ORG` | Optional organization name. |
| `tagline` | `NOTE` | Optional short public line shown on the card face; exported before `note` in `NOTE`. |
| `department` | `ORG` | Optional organization unit; exported as `ORG:Company;Department`. |
| `note` | `NOTE` | Optional free-form note. |
| `phones[]` | `TEL` | Multiple values supported. |
| `emails[]` | `EMAIL` | Multiple values supported. |
| `addresses[]` | `ADR` | Multiple free-text values supported. |
| `urls[]` | `URL` | Websites and social accounts. |

Each contact value has `{ value, type?, label? }`. `type` is a small
vCard-style hint (`work`, `home`, `mobile`, `main`, `other`). `label` is a
human-facing label, mainly for URL/social platforms such as Website,
LinkedIn, GitHub, or Bluesky. Known social labels may store a handle or ID in
`value`; rendering and vCard export resolve those into full profile URLs.

`profile` stores My Card display preferences only, currently `theme` and
`customColor`.

`assets` stores attached images:

| Kind | Meaning | vCard |
| --- | --- | --- |
| `cardPhoto` | Original photographed business card. | My Card extension; not exported today. |
| `avatar` | Person photo. | Maps to `PHOTO`. |
| `logo` | Organization logo. | Maps to `LOGO`. |

Assets contain `{ id, kind, mediaType, dataUrl?, previewDataUrl?, sourceRef?,
transform?, localOnly? }`. `transform` describes rotate/scale/position for
that image. `previewDataUrl` is a local thumbnail cache and may be omitted,
regenerated, or discarded. `sourceRef` points to a local original image object
when the original is stored outside the card row. `localOnly: true` assets are
omitted from portable share links.

## Portable Link

The URL fragment is the portable payload:

```text
v2p.<base64url(iv || ciphertext)>.<base64url(rawKey)>
```

The ciphertext is AES-256-GCM over `JSON.stringify(CardData)`. The raw AES
key is also in the fragment. URL fragments are handled locally by the browser
and are not sent in HTTP requests, so the server cannot read the card.

Only `v2p` is accepted. The pre-launch v1 draft shape is intentionally not
supported.

## Storage

Card records live in IndexedDB:

| Store | Shape |
| --- | --- |
| `mycard/mine` | `MineCard = CardData & { updatedAt: string }` |
| `mycard/received` | `ReceivedEntry = { id, receivedAt, updatedAt, data: CardData }` |
| `mycard/assets` | Local original image assets referenced by `sourceRef` |
| `mycard/deletedCards` | Local sync tombstones for deleted mine/received entries |

Small device-local preferences remain in `localStorage`, including active
card id, locale, layout, onboarding state, and AI language state.

For share links, `ReceivedEntry.id` is deduped against `CardData.id`. For
photo cards, `ReceivedEntry.id` and `CardData.id` are the same local UUID.
OCR updates `data.contact` on the same entry while preserving the original
`cardPhoto` asset.

`receivedAt` is creation time. `updatedAt` changes when the received card's
user-visible data changes and is used for sync conflict resolution.

All storage reads normalize local data before use.

## Compatibility

- `CardData.v` is required and must be `2`.
- Old pre-launch top-level fields such as `name`, `phone`, `email`,
  `address`, `socials`, `theme`, and `customColor` are not accepted.
- Future breaking portable-link formats should mint a new prefix rather than
  changing `v2p`.
