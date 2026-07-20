# Plan

This file tracks follow-up work that is intentionally outside the current
static app scope.

Future plans:

- [Encrypted Sync](#encrypted-sync)
- [Card Assets](#card-assets)

## Encrypted Sync

Add optional multi-device sync using the object model in
[`sync.md`](sync.md). The first implementation should keep local IndexedDB as
the app source of truth and sync encrypted `index:cards`, card records, and
original image assets.

## Card Assets

Add first-class UI for `avatar` and `logo` assets. These already exist in the
data model, but the current app only exposes `cardPhoto` through photo-card
capture and recognition.
