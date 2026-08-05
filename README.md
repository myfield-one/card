# Card Field

Privacy-first digital business card, built as a standalone static site:
fully client-side, no backend, no account required.

Website: [card.myfield.one](https://card.myfield.one)

## Features

- **My Card** — create and manage your cards.
- **Share** — generate encrypted card links.
- **Received Cards** — keep cards you receive or photograph.
- **AI recognition** — optional on-device OCR for physical cards.
- **Settings** — language, privacy, and recognition options.

## How it works

The card editor encrypts contact fields locally and puts the encrypted payload
and key material in the URL fragment, which is handled by the browser and not
sent to the server. `card.myfield.one` can serve the app, but it cannot read
shared card contents. Full format spec: [`docs/data-model.md`](docs/data-model.md).

## Docs

- [`docs/data-model.md`](docs/data-model.md) — data model, storage, and share-link format.
- [`docs/sync.md`](docs/sync.md) — encrypted multi-device sync design.
- [`docs/api.md`](docs/api.md) — URL routing.
- [`docs/dev.md`](docs/dev.md) — local development and deployment.
- [`docs/plan.md`](docs/plan.md) — future work.
- [`CHANGELOG.md`](CHANGELOG.md) — release notes.

## Development

Pull requests are welcome. See [`docs/dev.md`](docs/dev.md) for local
development, code layout, and deployment notes.

## Acknowledgments

My Card's design is inspired by [Myfield](https://myfield.one): local-first
data, user-held keys, and sharing that does not give the platform access to
private card contents.

Uses [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) for
client-side QR generation and [Tesseract.js](https://github.com/naptha/tesseract.js)
for on-device OCR. Both are vendored so sharing and recognition do not depend
on third-party runtime requests.

## License

Apache License 2.0 — see [`LICENSE`](LICENSE). Bundled third-party
components (qrcode-generator, Tesseract.js) keep their own licenses; see
[`NOTICE`](NOTICE).
