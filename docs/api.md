# URL API

My Card has no HTTP backend — the URL itself is the only "API." Routing
entry point: `initApp` in `src/views.ts`.

## Bare URL

```
https://card.myfield.one/
```

Renders the local "My Cards" stack (`renderStack`) — the home screen, and the
target of the in-app "Make your own Card" link.

## Share link

```
https://card.myfield.one/#<fragment>
```

`<fragment>` is a Portable Card payload (`v2p.<...>.<...>` — see
`docs/data-model.md`). `initApp` decodes it and branches:

- **One of this device's own cards** (matched by `CardData.id`) — strips the
  hash and opens that card's own Detail view (`renderDetail`) instead of the
  recipient flow, so opening your own share link never files it into your
  own Received Cards.
- **Anyone else's card** — upserts it into Received Cards by `CardData.id`
  (`addReceived`, so re-opening the same link or a re-share after an edit
  updates the entry instead of duplicating it) and opens the recipient view
  (`renderRecipient`). Opening the link is the save; there's no separate
  "Save" step.
- **Fails to decode** (wrong/missing key, corrupted payload, unrecognized
  prefix) — opens an error view (`renderError`), never a silent fallback to
  the home screen or a partial save.

## Fragment-only navigation

A link that changes only the fragment (e.g. "Make your own Card," which
points at the bare path) is a same-document navigation per spec: the browser
fires `hashchange` without reloading. `src/main.ts` re-runs `initApp` on
`hashchange` for exactly this reason — a one-time call at load would never
see a fragment that arrives this way.
