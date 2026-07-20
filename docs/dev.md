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
- `src/i18n.ts` — UI string dictionary, 9 locales.

## Deployment Notes

The `main` branch is the source for the currently deployed app.

The app deploys as static files. `public/_headers` defines cache policy:
HTML is revalidated, hashed Vite assets are immutable, and public assets use
bounded cache lifetimes. Social preview metadata points at a versioned PNG.

GitHub Actions runs typecheck, tests, and build for app changes. Cloudflare
Pages is expected to handle deployment from the connected GitHub branch.
