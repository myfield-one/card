import type { CardData } from "./crypto";
import type { MineCard, ReceivedEntry } from "./storage";
import { buildVCard } from "./vcard.ts";

export interface PhotoCardExportItem {
  entry: ReceivedEntry;
  dataUrl: string;
}

const enc = new TextEncoder();

function hasContactData(data: CardData): boolean {
  const { contact } = data;
  return Boolean(
    contact.fn ||
    contact.title ||
    contact.tagline ||
    contact.department ||
    contact.org ||
    contact.note ||
    contact.phones?.length ||
    contact.emails?.length ||
    contact.addresses?.length ||
    contact.urls?.length
  );
}

export function buildCardsVCard(cards: CardData[]): string {
  return cards.filter(hasContactData).map(buildVCard).join("\r\n");
}

export function myCardsVCard(cards: MineCard[]): string {
  return buildCardsVCard(cards);
}

export function receivedCardsVCard(entries: ReceivedEntry[]): string {
  return buildCardsVCard(entries.map((entry) => entry.data));
}

function dataUrlBytes(dataUrl: string): { mediaType: string; bytes: Uint8Array } | null {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!match) return null;
  const binary = atob(match[2]!);
  const bytes = new Uint8Array(binary.length);
  for (let idx = 0; idx < binary.length; idx += 1) bytes[idx] = binary.charCodeAt(idx);
  return { mediaType: match[1]!, bytes };
}

function extensionForMediaType(mediaType: string): string {
  const normalized = mediaType.toLowerCase();
  if (normalized === "image/png") return "png";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/gif") return "gif";
  if (normalized === "image/heic") return "heic";
  if (normalized === "image/heif") return "heif";
  return "jpg";
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

function photoCardBaseName(entry: ReceivedEntry, index: number): string {
  const date = entry.receivedAt.slice(0, 10) || "photo-card";
  const identity = slug([entry.data.contact.fn, entry.data.contact.org].filter(Boolean).join("-"));
  return `${date}-${identity || `card-${String(index + 1).padStart(2, "0")}`}`;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let idx = 0; idx < 8; idx += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { date: number; time: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function u16(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

function u32(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function createZip(files: { name: string; bytes: Uint8Array; modifiedAt?: Date }[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = enc.encode(file.name);
    const { date, time } = dosDateTime(file.modifiedAt || new Date());
    const crc = crc32(file.bytes);
    const localHeader = concatBytes([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(time),
      u16(date),
      u32(crc),
      u32(file.bytes.length),
      u32(file.bytes.length),
      u16(name.length),
      u16(0),
      name,
    ]);
    localParts.push(localHeader, file.bytes);

    centralParts.push(concatBytes([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(time),
      u16(date),
      u32(crc),
      u32(file.bytes.length),
      u32(file.bytes.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]));
    offset += localHeader.length + file.bytes.length;
  }

  const centralDirectory = concatBytes(centralParts);
  const end = concatBytes([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralDirectory.length),
    u32(offset),
    u16(0),
  ]);
  return concatBytes([...localParts, centralDirectory, end]);
}

export function buildPhotoCardsZip(items: PhotoCardExportItem[]): Uint8Array {
  const manifest: Array<Record<string, string>> = [];
  const files: { name: string; bytes: Uint8Array; modifiedAt?: Date }[] = [];

  items.forEach((item, index) => {
    const parsed = dataUrlBytes(item.dataUrl);
    if (!parsed) return;
    const name = `photo-cards/${photoCardBaseName(item.entry, index)}.${extensionForMediaType(parsed.mediaType)}`;
    manifest.push({
      entryId: item.entry.id,
      receivedAt: item.entry.receivedAt,
      name: item.entry.data.contact.fn || "",
      company: item.entry.data.contact.org || "",
      file: name,
    });
    files.push({ name, bytes: parsed.bytes, modifiedAt: new Date(item.entry.receivedAt) });
  });

  files.push({
    name: "photo-cards/manifest.json",
    bytes: enc.encode(JSON.stringify(manifest, null, 2)),
  });
  return createZip(files);
}
