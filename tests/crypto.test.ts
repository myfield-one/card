import assert from "node:assert/strict";
import test from "node:test";

import {
  type CardData,
  decodeCardFragment,
  encodeCardFragment,
  normalizeCardData,
  normalizePhotoTransform,
} from "../src/crypto.ts";

const CARD_ID = "11111111-1111-4111-8111-111111111111";
const ASSET_ID = "22222222-2222-4222-8222-222222222222";

test("normalizeCardData keeps v2 contact data and trims optional values", () => {
  const data = normalizeCardData({
    v: 2,
    id: ` ${CARD_ID} `,
    contact: {
      fn: " ",
      title: " Founder ",
      org: " Example Inc. ",
      department: " Research ",
      note: " First computer programmer ",
      phones: [
        { type: "cell", value: "+1 555 0100" },
        { type: "mobile", value: " +1 555 0101 " },
      ],
      emails: [{ type: "work", value: " hi@example.com " }],
      urls: [{ label: " LinkedIn ", value: " https://linkedin.com/in/example " }],
    },
    profile: { theme: "custom", customColor: "#123abc" },
  });

  assert.deepEqual(data, {
    v: 2,
    id: CARD_ID,
    contact: {
      fn: "",
      title: "Founder",
      org: "Example Inc.",
      department: "Research",
      note: "First computer programmer",
      phones: [
        { value: "+1 555 0100" },
        { type: "mobile", value: "+1 555 0101" },
      ],
      emails: [{ type: "work", value: "hi@example.com" }],
      urls: [{ label: "LinkedIn", value: "https://linkedin.com/in/example" }],
    },
    profile: { theme: "custom", customColor: "#123abc" },
  });
});

test("normalizeCardData strips unsafe control characters from contact text", () => {
  const data = normalizeCardData({
    v: 2,
    id: CARD_ID,
    contact: {
      fn: "Ada\u0000 Lovelace\r\nCEO",
      org: "Example\u0007 Inc.",
      department: "R&D\r\nTeam",
      note: "Line 1\r\nLine 2",
      phones: [{ value: "+1 555\r0100" }],
    },
  });

  assert.deepEqual(data?.contact, {
    fn: "Ada Lovelace CEO",
    org: "Example Inc.",
    department: "R&D Team",
    note: "Line 1 Line 2",
    phones: [{ value: "+1 555 0100" }],
  });
});

test("normalizePhotoTransform clamps values to supported ranges", () => {
  assert.deepEqual(
    normalizePhotoTransform({ rotate: 90, scale: 5, offsetX: -3, offsetY: 4 }),
    { rotate: 90, scale: 3, offsetX: -2, offsetY: 2 },
  );
  assert.equal(normalizePhotoTransform({ rotate: 45, scale: 1, offsetX: 0, offsetY: 0 }), undefined);
});

test("normalizeCardData rejects oversized assets instead of truncating data URLs", () => {
  const data = normalizeCardData({
    v: 2,
    id: CARD_ID,
    contact: { fn: "Ada Lovelace" },
    assets: [
      {
        id: ASSET_ID,
        kind: "cardPhoto",
        mediaType: "image/png",
        dataUrl: `data:image/png;base64,${"A".repeat(20_000_000)}`,
      },
    ],
  });

  assert.deepEqual(data, {
    v: 2,
    id: CARD_ID,
    contact: { fn: "Ada Lovelace" },
  });
});

test("normalizeCardData accepts local asset source refs with preview data", () => {
  const data = normalizeCardData({
    v: 2,
    id: CARD_ID,
    contact: { fn: "Ada Lovelace" },
    assets: [
      {
        id: ASSET_ID,
        kind: "cardPhoto",
        mediaType: "image/jpeg",
        previewDataUrl: "data:image/jpeg;base64,AAAA",
        sourceRef: { store: "assets", id: ASSET_ID },
        localOnly: true,
      },
    ],
  });

  assert.deepEqual(data?.assets, [
    {
      id: ASSET_ID,
      kind: "cardPhoto",
      mediaType: "image/jpeg",
      previewDataUrl: "data:image/jpeg;base64,AAAA",
      sourceRef: { store: "assets", id: ASSET_ID },
      localOnly: true,
    },
  ]);
});

test("encodeCardFragment and decodeCardFragment round-trip portable card data", async () => {
  const data: CardData = {
    v: 2,
    id: CARD_ID,
    contact: {
      fn: "Ada Lovelace",
      phones: [{ type: "mobile", value: "+44 20 0000 0000" }],
    },
    assets: [
      {
        id: ASSET_ID,
        kind: "cardPhoto",
        mediaType: "image/png",
        dataUrl: "data:image/png;base64,AAAA",
        localOnly: true,
      },
    ],
  };

  const fragment = await encodeCardFragment(data);
  const decoded = await decodeCardFragment(fragment);

  assert.match(fragment, /^v2p\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(decoded, {
    v: 2,
    id: CARD_ID,
    contact: {
      fn: "Ada Lovelace",
      phones: [{ type: "mobile", value: "+44 20 0000 0000" }],
    },
  });
});

test("encodeCardFragment omits local asset refs and preview caches", async () => {
  const data: CardData = {
    v: 2,
    id: CARD_ID,
    contact: { fn: "Ada Lovelace" },
    assets: [
      {
        id: ASSET_ID,
        kind: "cardPhoto",
        mediaType: "image/jpeg",
        previewDataUrl: "data:image/jpeg;base64,AAAA",
        sourceRef: { store: "assets", id: ASSET_ID },
      },
    ],
  };

  const decoded = await decodeCardFragment(await encodeCardFragment(data));

  assert.deepEqual(decoded, {
    v: 2,
    id: CARD_ID,
    contact: { fn: "Ada Lovelace" },
  });
});

test("decodeCardFragment rejects unsupported prefixes", async () => {
  assert.equal(await decodeCardFragment("v1.invalid.invalid"), null);
});
