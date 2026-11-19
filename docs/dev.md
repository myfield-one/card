# Development

## Local Development

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

## Code Layout

- `src/crypto.ts` — `CardData` type, fragment encode/decode.
- `src/vcard.ts` — vCard (`.vcf`) export for "Save to Contacts".
- `src/storage.ts` — IndexedDB data stores and small `localStorage` preferences.
- `src/ocr.ts` / `src/recognizer.ts` — on-device OCR and field parsing.
- `src/dom.ts` — shared DOM refs, escaping, and toast helper.
- `src/card-view.ts` — card face/contact-sheet rendering shared across views.
- `src/views.ts` — screen rendering, menus, photo capture, and `initApp`.
- `src/main.ts` — calls `initApp` and re-runs it on `hashchange`.
- `src/i18n.ts` — UI string dictionary, 14 locales.

## Deployment Notes

The `release` branch is the publishing branch connected to Cloudflare Pages
automatic deployment. The `main` branch is the primary development branch;
after an iteration is stable, merge or promote it to `release` to publish, then
tag the published commit as `vVERSION`.

The build serves the current app at `/` and versions listed in `releases.json`
at `/vVERSION/`, starting with 0.9.7; add an entry with its full commit only
after verifying the matching `vVERSION` tag. Versions share origin storage, and
the service worker caches only the root shell, so version paths need a network
connection.

For a local integration preview, run `npm run dev` with `VITE_MYFIELD_AUTH_URL`
(or `VITE_WEB_BASE`) pointing at the test Auth. The SDK takes the API address
and bucket from the grant; existing sync users reconnect once per device.

The app deploys as static files. `public/_headers` defines cache policy:
HTML is revalidated, hashed Vite assets are immutable, and public assets use
bounded cache lifetimes. Social preview metadata points at a versioned PNG.

GitHub Actions runs typecheck, tests, and build for app changes. Cloudflare
Pages deploys from the connected `release` branch.
