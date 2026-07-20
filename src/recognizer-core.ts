import type { OcrLine } from "./ocr";
import type { ContactValueType } from "./crypto";

export type FieldType = "name" | "title" | "company" | "phone" | "email" | "address" | "social" | "other";

export interface RecognizedField {
  type: FieldType;
  value: string;
  valueType?: ContactValueType;
  label?: string;
}

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/;
const URL_RE = /(https?:\/\/[^\s,]+|www\.[^\s,]+|\b[a-z0-9-]+\.(?:com|net|org|io|co|cn)\b\S*)/i;
// Leading "(\("? / trailing "\)"? are just so a number written "(65) 6311
// 2340" keeps its opening paren — \d still anchors the match, they're not
// required.
const PHONE_RE = /(\(?\+?\d[\d\s\-().]{6,}\d\)?)/;

// Deliberately just common English/Chinese job-title words, not an
// exhaustive list — this only needs to catch the common cases; anything it
// misses still shows up as a plain field the user can retag in the
// confirm/edit step, never silently dropped.
const TITLE_WORDS = [
  "ceo",
  "cto",
  "cfo",
  "coo",
  "president",
  "founder",
  "co-founder",
  "director",
  "manager",
  "engineer",
  "designer",
  "developer",
  "consultant",
  "specialist",
  "lead",
  "head of",
  "vp",
  "vice president",
  "chairman",
  "partner",
  "sales",
  "marketing",
  "executive",
  "officer",
  "architect",
  "analyst",
  "总监",
  "经理",
  "总裁",
  "创始人",
  "联合创始人",
  "工程师",
  "设计师",
  "顾问",
  "主管",
  "总经理",
  "首席",
  "副总裁",
  "董事",
  "合伙人",
  "销售",
  "市场",
];

function isLikelyTitle(text: string): boolean {
  const lower = text.toLowerCase();
  return TITLE_WORDS.some((w) => {
    if (/^[\x00-\x7F]+$/.test(w)) {
      const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
      return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(lower);
    }
    return lower.includes(w);
  });
}

// Text left over on a line after pulling out a matched email/phone/url —
// e.g. OCR merging a two-column footer ("585 North Bridge Road" beside
// "Fax: (65) 6311 1159") onto one line means the match doesn't span the
// whole line. Discarding the rest of the line along with the match would
// silently drop that address/company text instead of just the phone
// number; keeping it (as its own line, same position) lets it still become
// part of the address/company below rather than vanishing.
function leftoverText(text: string, matched: string): string {
  return text
    .replace(matched, "")
    .replace(/\b(?:tel|phone|mobile|email|e-mail|mail|url|web|website|fax)\b\s*:?\s*/gi, " ")
    .replace(/^[\s:,\-–—]+|[\s:,\-–—]+$/g, "")
    .trim();
}

function extractContactMatches(line: OcrLine, fields: RecognizedField[]): OcrLine | null {
  let text = line.text;
  let matchedAny = false;
  while (true) {
    const emailMatch = text.match(EMAIL_RE);
    const urlMatch = text.match(URL_RE);
    const phoneMatch = text.match(PHONE_RE);
    const validPhoneMatch = phoneMatch && phoneMatch[0].replace(/\D/g, "").length >= 7 ? phoneMatch : null;
    const matches = [
      emailMatch ? { type: "email" as const, match: emailMatch } : null,
      urlMatch ? { type: "social" as const, match: urlMatch } : null,
      validPhoneMatch ? { type: "phone" as const, match: validPhoneMatch } : null,
    ].filter((item): item is { type: "email" | "social" | "phone"; match: RegExpMatchArray } => item !== null)
      .sort((a, b) => (a.match.index || 0) - (b.match.index || 0));

    const next = matches[0];
    if (!next) break;
    fields.push({ type: next.type, value: next.match[0].trim() });
    const leftover = leftoverText(text, next.match[0]);
    if (leftover === text) break;
    text = leftover;
    matchedAny = true;
  }
  return matchedAny && text.length > 2 ? { ...line, text } : matchedAny ? null : line;
}

function logicalLines(lines: OcrLine[]): OcrLine[] {
  return lines.flatMap((line) => line.text
    .split(/\r\n?|\n|[|•]+|(?:\s+[·]\s+)/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((text) => ({ ...line, text })));
}

// Pure function of OCR output, not tied to any specific engine — reusable
// against any {text, bbox} line source (a different OCR engine, or a
// vision-language model's line output), and independently testable.
export function parseContactFields(lines: OcrLine[]): RecognizedField[] {
  const sorted = logicalLines(lines).sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const fields: RecognizedField[] = [];
  const remaining: OcrLine[] = [];

  for (const line of sorted) {
    const leftover = extractContactMatches(line, fields);
    if (leftover) remaining.push(leftover);
  }

  // Title: first remaining line matching the job-title wordlist, wherever
  // it falls in reading order.
  const titleIdx = remaining.findIndex((l) => isLikelyTitle(l.text));

  // Name: conventionally the line immediately above the detected title
  // (e.g. "Dr Chris Foo" / "Senior Partner") — not just "the topmost
  // remaining line," which breaks as soon as anything (a hospital/company
  // letterhead, a handwritten annotation) sits above the person's own name.
  // Falls back to the topmost line only when no title was found at all. If the
  // title itself is the topmost line, leave it in place so it is not consumed
  // as the name.
  const nameLine = titleIdx > 0 ? remaining.splice(titleIdx - 1, 1)[0] : titleIdx === -1 ? remaining.shift() : undefined;
  if (nameLine) fields.push({ type: "name", value: nameLine.text });

  const titleIdx2 = remaining.findIndex((l) => isLikelyTitle(l.text));
  if (titleIdx2 >= 0) {
    fields.push({ type: "title", value: remaining[titleIdx2]!.text });
    remaining.splice(titleIdx2, 1);
  }

  // Company: next remaining line — heuristically the next most prominent
  // one once name/title are accounted for.
  const companyLine = remaining.shift();
  if (companyLine) fields.push({ type: "company", value: companyLine.text });

  // A single unknown line is most often an address. Multiple leftovers are
  // safer as separate review rows: users can retag/delete them, while a merged
  // field forces manual copy/splitting.
  if (remaining.length === 1) {
    fields.push({ type: "address", value: remaining[0]!.text });
  } else {
    for (const line of remaining) fields.push({ type: "other", value: line.text });
  }

  return fields;
}
