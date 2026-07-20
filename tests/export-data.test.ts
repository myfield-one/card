import assert from "node:assert/strict";
import test from "node:test";

import type { MineCard, ReceivedEntry } from "../src/storage.ts";
import { buildPhotoCardsZip, myCardsVCard, receivedCardsVCard } from "../src/export-data.ts";

const CARD_ID = "11111111-1111-4111-8111-111111111111";
const RECEIVED_ID = "22222222-2222-4222-8222-222222222222";
const PHOTO_ID = "33333333-3333-4333-8333-333333333333";

test("myCardsVCard exports authored cards as a multi-contact vCard file", () => {
  const cards: MineCard[] = [
    { v: 2, id: CARD_ID, updatedAt: "2026-07-16T00:00:00.000Z", contact: { fn: "Ada Lovelace", org: "Analytical Engines" } },
    { v: 2, id: "44444444-4444-4444-8444-444444444444", updatedAt: "2026-07-16T00:00:00.000Z", contact: { fn: "Grace Hopper" } },
  ];

  const out = myCardsVCard(cards);

  assert.equal(out.match(/BEGIN:VCARD/g)?.length, 2);
  assert.match(out, /FN:Ada Lovelace/);
  assert.match(out, /FN:Grace Hopper/);
});

test("receivedCardsVCard includes recognized photo cards and skips empty photo cards", () => {
  const entries: ReceivedEntry[] = [
    {
      id: RECEIVED_ID,
      receivedAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
      data: { v: 2, id: RECEIVED_ID, contact: { fn: "Received Contact" } },
    },
    {
      id: PHOTO_ID,
      receivedAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
      data: {
        v: 2,
        id: PHOTO_ID,
        contact: { fn: "Photo Contact" },
        assets: [{ id: PHOTO_ID, kind: "cardPhoto", mediaType: "image/jpeg", sourceRef: { store: "assets", id: PHOTO_ID } }],
      },
    },
    {
      id: "55555555-5555-4555-8555-555555555555",
      receivedAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
      data: {
        v: 2,
        id: "55555555-5555-4555-8555-555555555555",
        contact: { fn: "" },
        assets: [{ id: "55555555-5555-4555-8555-555555555555", kind: "cardPhoto", mediaType: "image/jpeg", sourceRef: { store: "assets", id: "55555555-5555-4555-8555-555555555555" } }],
      },
    },
  ];

  const out = receivedCardsVCard(entries);

  assert.match(out, /FN:Received Contact/);
  assert.match(out, /FN:Photo Contact/);
  assert.equal(out.match(/BEGIN:VCARD/g)?.length, 2);
});

test("buildPhotoCardsZip writes photo files and a manifest", () => {
  const zip = buildPhotoCardsZip([{
    dataUrl: "data:image/jpeg;base64,QUJD",
    entry: {
      id: PHOTO_ID,
      receivedAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
      data: { v: 2, id: PHOTO_ID, contact: { fn: "Ada Lovelace", org: "Analytical Engines" } },
    },
  }]);
  const text = new TextDecoder().decode(zip);

  assert.deepEqual([...zip.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.match(text, /photo-cards\/2026-07-16-ada-lovelace-analytical-engines\.jpg/);
  assert.match(text, /photo-cards\/manifest\.json/);
  assert.match(text, /"entryId": "33333333-3333-4333-8333-333333333333"/);
});
