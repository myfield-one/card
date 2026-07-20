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
      phones: [
        { type: "mobile", value: "+44 20 0000 0000" },
        { type: "work", value: "+44 20 0000 0001" },
      ],
      emails: [{ type: "work", value: "ada@example.com" }],
      addresses: [{ type: "home", value: "1 Example Street" }],
      urls: [
        { label: "LinkedIn", value: "https://linkedin.com/in/ada" },
        { value: "https://example.com" },
      ],
    },
  };

  assert.equal(
    buildVCard(card),
    [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "N:Ada Lovelace;;;;",
      "FN:Ada Lovelace",
      "TITLE:Founder",
      "ORG:Analytical Engines",
      "TEL;TYPE=MOBILE:+44 20 0000 0000",
      "TEL;TYPE=WORK:+44 20 0000 0001",
      "EMAIL;TYPE=WORK:ada@example.com",
      "ADR;TYPE=HOME:;;1 Example Street;;;;",
      "URL;TYPE=LINKEDIN:https://linkedin.com/in/ada",
      "URL;TYPE=WEBSITE:https://example.com",
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
      addresses: [{ value: "Line 1\nLine 2" }],
    },
  };

  assert.equal(
    buildVCard(card),
    [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "N:Ada\\, Lovelace;;;;",
      "FN:Ada\\, Lovelace",
      "ORG:A\\;B\\\\C",
      "ADR;TYPE=OTHER:;;Line 1\\nLine 2;;;;",
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
    },
  };

  assert.equal(
    buildVCard(card),
    [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "N:Ada\\nURL:https://evil.example;;;;",
      "FN:Ada\\nURL:https://evil.example",
      "ORG:Example\\nTITLE:Injected",
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
      "N:Example Inc.;;;;",
      "FN:Example Inc.",
      "ORG:Example Inc.",
      "URL;TYPE=WEBSITE:https://example.com",
      "END:VCARD",
    ].join("\r\n"),
  );
});
