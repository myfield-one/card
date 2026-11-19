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
after an iteration is stable, merge or promote it to `release` to publish.

The build serves the working release at `/` and selected historical versions
at `/vVERSION/`. Add a version and its full commit to `releases.json` after
verifying the matching `vVERSION` tag. Each historical build uses its own
lockfile. Versions share origin storage. The service worker caches the root
app shell only, so history paths are available online after the worker updates.
The first SDK rollout leaves the history list empty and serves the current app
at `/`.

For a local integration preview, set `VITE_MYFIELD_AUTH_URL` to the test Auth
page (or `VITE_WEB_BASE` to its origin) and run `npm run dev`. The SDK uses the
API address and bucket from the grant. Existing sync users are prompted to
reconnect once per device to access their current bucket.

The app deploys as static files. `public/_headers` defines cache policy:
HTML is revalidated, hashed Vite assets are immutable, and public assets use
bounded cache lifetimes. Social preview metadata points at a versioned PNG.

GitHub Actions runs typecheck, tests, and build for app changes. Cloudflare
Pages deploys from the connected `release` branch.
