import assert from "node:assert/strict";
import test from "node:test";

import type { CardData } from "../src/crypto.ts";
import { buildVCard } from "../src/vcard.ts";

test("buildVCard exports repeated contact values and URL labels", () => {
  const card: CardData = {
    v: 2,
    id: "11111111-1111-4111-8111-111111111111",
    contact: {
      fn: "Ada Lovelace",
      title: "Founder",
      org: "Analytical Engines",
      department: "Research",
      tagline: "Privacy-first cards",
      note: "Published in 1843",
      phones: [
        { type: "mobile", value: "+44 20 0000 0000" },
        { type: "work", value: "+44 20 0000 0001" },
      ],
      emails: [{ type: "work", value: "ada@example.com" }],
      addresses: [{ type: "home", value: "1 Example Street" }],
      urls: [
        { label: "LinkedIn", value: "https://www.linkedin.com/in/ada" },
        { value: "https://example.com" },
      ],
    },
  };

  assert.equal(
    buildVCard(card),
    [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "N:;Ada Lovelace;;;",
      "FN:Ada Lovelace",
      "TITLE:Founder",
      "ORG:Analytical Engines;Research",
      "TEL;TYPE=MOBILE:+44 20 0000 0000",
      "TEL;TYPE=WORK:+44 20 0000 0001",
      "EMAIL;TYPE=WORK:ada@example.com",
      "ADR;TYPE=HOME:;;1 Example Street;;;;",
      "URL;TYPE=LINKEDIN:https://www.linkedin.com/in/ada",
      "URL;TYPE=WEBSITE:https://example.com",
      "NOTE:Privacy-first cards\\n\\nPublished in 1843",
      "END:VCARD",
    ].join("\r\n"),
  );
});

test("buildVCard exports tagline alone as NOTE", () => {
  const card: CardData = {
    v: 2,
    id: "11111111-1111-4111-8111-111111111111",
    contact: {
      fn: "Ada Lovelace",
      tagline: "Privacy-first cards",
    },
  };

  assert.equal(
    buildVCard(card),
    [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "N:;Ada Lovelace;;;",
      "FN:Ada Lovelace",
      "NOTE:Privacy-first cards",
      "END:VCARD",
    ].join("\r\n"),
  );
});

test("buildVCard exports known social handles as full URLs", () => {
  const card: CardData = {
    v: 2,
    id: "11111111-1111-4111-8111-111111111111",
    contact: {
      fn: "Ada Lovelace",
      urls: [
        { label: "LinkedIn", value: "ada-lovelace" },
        { label: "Bluesky", value: "@ada.bsky.social" },
        { label: "Other", value: "hello" },
      ],
    },
  };

  assert.equal(
    buildVCard(card),
    [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "N:;Ada Lovelace;;;",
      "FN:Ada Lovelace",
      "URL;TYPE=LINKEDIN:https://www.linkedin.com/in/ada-lovelace",
      "URL;TYPE=BLUESKY:https://bsky.app/profile/ada.bsky.social",
      "URL;TYPE=OTHER:hello",
      "END:VCARD",
    ].join("\r\n"),
  );
});

test("buildVCard escapes reserved vCard characters", () => {
  const card: CardData = {
    v: 2,
    id: "11111111-1111-4111-8111-111111111111",
    contact: {
      fn: "Ada, Lovelace",
      org: "A;B\\C",
      department: "R&D;Lab",
      note: "Line 1\nLine 2",
      addresses: [{ value: "Line 1\nLine 2" }],
    },
  };

  assert.equal(
    buildVCard(card),
    [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "N:;Ada\\, Lovelace;;;",
      "FN:Ada\\, Lovelace",
      "ORG:A\\;B\\\\C;R&D\\;Lab",
      "ADR;TYPE=OTHER:;;Line 1\\nLine 2;;;;",
      "NOTE:Line 1\\nLine 2",
      "END:VCARD",
    ].join("\r\n"),
  );
});

test("buildVCard escapes bare carriage returns to prevent line injection", () => {
  const card: CardData = {
    v: 2,
    id: "11111111-1111-4111-8111-111111111111",
    contact: {
      fn: "Ada\rURL:https://evil.example",
      org: "Example\r\nTITLE:Injected",
      department: "Research\r\nTEL:Injected",
      note: "Note\r\nURL:Injected",
    },
  };

  assert.equal(
    buildVCard(card),
    [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "N:;Ada\\nURL:https://evil.example;;;",
      "FN:Ada\\nURL:https://evil.example",
      "ORG:Example\\nTITLE:Injected;Research\\nTEL:Injected",
      "NOTE:Note\\nURL:Injected",
      "END:VCARD",
    ].join("\r\n"),
  );
});

test("buildVCard uses organization as display name when fn is empty", () => {
  const card: CardData = {
    v: 2,
    id: "11111111-1111-4111-8111-111111111111",
    contact: {
      fn: "",
      org: "Example Inc.",
      urls: [{ value: "https://example.com" }],
    },
  };

  assert.equal(
    buildVCard(card),
    [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "N:;;;;",
      "FN:Example Inc.",
      "ORG:Example Inc.",
      "URL;TYPE=WEBSITE:https://example.com",
      "END:VCARD",
    ].join("\r\n"),
  );
});
