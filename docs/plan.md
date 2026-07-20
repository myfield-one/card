# Plan

This file tracks follow-up work that is intentionally outside the current
static app scope.

Future plans:

- [Encrypted Sync](#encrypted-sync)
- [Card Assets](#card-assets)

## Encrypted Sync

Add optional multi-device sync without changing the privacy boundary:
plaintext and keys stay on user devices, while the platform stores and relays
ciphertext only. This needs encrypted object schemas, local change tracking,
device authorization, transport, and conflict handling.

## Card Assets

Add first-class UI for `avatar` and `logo` assets. These already exist in the
data model, but the current app only exposes `cardPhoto` through photo-card
capture and recognition.
