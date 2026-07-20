import assert from "node:assert/strict";
import test from "node:test";

import type { CardData } from "../src/crypto.ts";
import { cardDataToRecognizedFields, fieldsToCardData } from "../src/recognized-fields.ts";

const CARD_ID = "11111111-1111-4111-8111-111111111111";

test("recognized field editing preserves contact value type and social label", () => {
  const data: CardData = {
    v: 2,
    id: CARD_ID,
    contact: {
      fn: "Ada Lovelace",
      phones: [{ type: "home", value: "+1 555 0100" }],
      emails: [{ type: "home", value: "ada@example.com" }],
      addresses: [{ type: "other", value: "Leadenhall Street" }],
      urls: [{ label: "LinkedIn", value: "https://linkedin.com/in/ada" }],
    },
  };

  assert.deepEqual(fieldsToCardData(cardDataToRecognizedFields(data), CARD_ID), data);
});

test("recognized field editing falls back to valid defaults after type changes", () => {
  assert.deepEqual(
    fieldsToCardData([
      { type: "email", value: "ada@example.com", valueType: "mobile" },
      { type: "phone", value: "+1 555 0100", label: "LinkedIn" },
      { type: "social", value: "https://example.com", valueType: "home" },
    ], CARD_ID).contact,
    {
      fn: "",
      phones: [{ type: "mobile", value: "+1 555 0100" }],
      emails: [{ type: "work", value: "ada@example.com" }],
      addresses: [],
      urls: [{ label: "Website", value: "https://example.com" }],
    },
  );
});
