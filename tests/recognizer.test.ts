import assert from "node:assert/strict";
import test from "node:test";

import type { OcrLine } from "../src/ocr.ts";
import { parseContactFields } from "../src/recognizer-core.ts";

function line(text: string, y0: number): OcrLine {
  return { text, bbox: { x0: 0, y0, x1: 100, y1: y0 + 10 } };
}

test("parseContactFields does not consume a topmost title as the name", () => {
  assert.deepEqual(
    parseContactFields([
      line("Senior Engineer", 0),
      line("Example Inc.", 20),
      line("ada@example.com", 40),
    ]),
    [
      { type: "email", value: "ada@example.com" },
      { type: "title", value: "Senior Engineer" },
      { type: "company", value: "Example Inc." },
    ],
  );
});

test("parseContactFields uses the line above a detected title as the name", () => {
  assert.deepEqual(
    parseContactFields([
      line("Ada Lovelace", 0),
      line("Senior Engineer", 20),
      line("Example Inc.", 40),
    ]),
    [
      { type: "name", value: "Ada Lovelace" },
      { type: "title", value: "Senior Engineer" },
      { type: "company", value: "Example Inc." },
    ],
  );
});

test("parseContactFields splits OCR text blocks into logical fields", () => {
  assert.deepEqual(
    parseContactFields([
      line("Ada Lovelace\nSenior Engineer\nExample Inc.", 0),
      line("ada@example.com | +44 20 0000 0000", 40),
    ]),
    [
      { type: "email", value: "ada@example.com" },
      { type: "phone", value: "+44 20 0000 0000" },
      { type: "name", value: "Ada Lovelace" },
      { type: "title", value: "Senior Engineer" },
      { type: "company", value: "Example Inc." },
    ],
  );
});

test("parseContactFields extracts phone and email from the same OCR line", () => {
  assert.deepEqual(
    parseContactFields([
      line("Tel: +65 6311 1159 Email: ada@example.com", 0),
    ]),
    [
      { type: "phone", value: "+65 6311 1159" },
      { type: "email", value: "ada@example.com" },
    ],
  );
});

test("parseContactFields does not treat title words inside addresses as titles", () => {
  assert.deepEqual(
    parseContactFields([
      line("Ada Lovelace", 0),
      line("Example Inc.", 20),
      line("Leadenhall Street", 40),
    ]),
    [
      { type: "name", value: "Ada Lovelace" },
      { type: "company", value: "Example Inc." },
      { type: "address", value: "Leadenhall Street" },
    ],
  );
});

test("parseContactFields keeps multiple unknown leftovers as separate review fields", () => {
  assert.deepEqual(
    parseContactFields([
      line("Ada Lovelace", 0),
      line("Example Inc.", 20),
      line("Innovation Lab", 40),
      line("1 Example Street", 60),
      line("Level 2", 80),
    ]),
    [
      { type: "name", value: "Ada Lovelace" },
      { type: "company", value: "Example Inc." },
      { type: "other", value: "Innovation Lab" },
      { type: "other", value: "1 Example Street" },
      { type: "other", value: "Level 2" },
    ],
  );
});

test("parseContactFields keeps one unknown leftover as address", () => {
  assert.deepEqual(
    parseContactFields([
      line("Ada Lovelace", 0),
      line("Example Inc.", 20),
      line("1 Example Street", 40),
    ]),
    [
      { type: "name", value: "Ada Lovelace" },
      { type: "company", value: "Example Inc." },
      { type: "address", value: "1 Example Street" },
    ],
  );
});
