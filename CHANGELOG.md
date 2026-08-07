# Changelog

## 0.9.6 - 2026-08-07

- Improved recipient-page actions, empty-card guidance, and unreadable-link recovery.
- Improved long contact-field rendering and card text overflow handling.
- Added QR-sharing fallback messaging for cards that are too large for QR codes.
- Completed translations for new UI copy and localized Sync wording.

## 0.9.5 - 2026-08-07

- Added social handle/ID support, including Bluesky and WhatsApp.
- Added a card tagline, shown on the card face and exported to vCard NOTE.
- Refined sharing, vCard handoff, QR sizing, and card typography.

## 0.9.4 - 2026-08-06

- Improved vCard download compatibility on newer iOS releases by rendering
  single-card downloads as direct download links instead of simulated clicks.
- Updated About and Privacy product references from My Card to Card Field.

## 0.9.3 - 2026-07-16

- Added encrypted multi-device sync for My Cards, Received Cards, and original
  photo assets.
- Added data export from Settings, including vCard exports and photo-card ZIP
  export.
- Added Malay, Tamil, Thai, Vietnamese, and Indonesian UI languages and
  on-device OCR language models.
- Refined Privacy & Security copy across supported languages and added a
  translation notice for non-English privacy text.
- Improved received-card editing, photo-card preview loading, and received-card
  deletion.
- Updated release workflow: `main` is the development branch, and `release` is
  the Cloudflare Pages publishing branch.

## 0.9.2 - 2026-07-16

Initial public release baseline.

- Standalone static My Card app with no backend requirement for normal use.
- Local-first card storage using IndexedDB.
- Encrypted share links with card data and key material kept in the URL
  fragment.
- My Cards and Received Cards views for creating, sharing, receiving, and
  managing digital business cards.
- vCard export for saving cards to contacts.
- Photo-card capture with optional on-device AI recognition.
- Settings for language, privacy, AI recognition, and app information.
- Social preview metadata and production deployment configuration for
  `card.myfield.one`.
