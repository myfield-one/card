import { isHexColor, isImageDataUrl, isUuid } from "./validators.ts";

export type ContactValueType = "work" | "home" | "mobile" | "main" | "other";

export interface ContactValue {
  type?: ContactValueType;
  label?: string;
  value: string;
}

export type CardTheme = "beige" | "teal" | "ink" | "custom";
export const CARD_THEME_VALUES = ["beige", "teal", "ink", "custom"] as const satisfies readonly CardTheme[];

export interface ContactInfo {
  fn: string;
  title?: string;
  org?: string;
  department?: string;
  note?: string;
  phones?: ContactValue[];
  emails?: ContactValue[];
  addresses?: ContactValue[];
  urls?: ContactValue[];
}

export interface CardProfile {
  theme?: CardTheme;
  customColor?: string;
}

export interface PhotoTransform {
  rotate: 0 | 90 | 180 | 270;
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface CardAsset {
  id: string;
  kind: "cardPhoto" | "avatar" | "logo";
  mediaType: string;
  dataUrl?: string;
  previewDataUrl?: string;
  sourceRef?: {
    store: "assets";
    id: string;
  };
  transform?: PhotoTransform;
  localOnly?: boolean;
}

// `id` is the owner's own Mine-record id, carried inside the encrypted
// payload so a recipient can tell "the same card, re-shared" apart from
// "a different card that happens to share a name" — see
// storage.ts's findReceivedContactEntry. It's just a random UUID with no
// semantic meaning beyond that.
export interface CardData {
  v: 2;
  id: string;
  contact: ContactInfo;
  profile?: CardProfile;
  assets?: CardAsset[];
}

const FRAGMENT_PREFIX = "v2p";
export const CARD_THEMES = new Set<CardTheme>(CARD_THEME_VALUES);
const CONTACT_VALUE_TYPES = new Set<ContactValueType>(["work", "home", "mobile", "main", "other"]);
const TEXT_MAX = 2048;
const CONTACT_VALUES_MAX = 24;
const ASSETS_MAX = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown, max = TEXT_MAX): string | undefined {
  if (typeof value !== "string") return undefined;
  return value
    .replace(/\r\n?|\n/g, " ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .slice(0, max);
}

function normalizeContactValues(value: unknown): ContactValue[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value
    .slice(0, CONTACT_VALUES_MAX)
    .map((item) => {
      if (!isRecord(item)) return null;
      const itemValue = cleanString(item.value)?.trim() || "";
      if (!itemValue) return null;
      const rawType = cleanString(item.type, 32)?.trim().toLowerCase();
      const type = rawType && CONTACT_VALUE_TYPES.has(rawType as ContactValueType) ? (rawType as ContactValueType) : undefined;
      const label = cleanString(item.label, 80)?.trim();
      return { ...(type ? { type } : {}), ...(label ? { label } : {}), value: itemValue };
    })
    .filter((item): item is ContactValue => item !== null);
  return values.length ? values : undefined;
}

function normalizeContactInfo(value: unknown): ContactInfo | null {
  if (!isRecord(value)) return null;
  const fn = cleanString(value.fn)?.trim() || "";

  const contact: ContactInfo = { fn };
  const title = cleanString(value.title)?.trim();
  const org = cleanString(value.org)?.trim();
  const department = cleanString(value.department)?.trim();
  const note = cleanString(value.note)?.trim();
  const phones = normalizeContactValues(value.phones);
  const emails = normalizeContactValues(value.emails);
  const addresses = normalizeContactValues(value.addresses);
  const urls = normalizeContactValues(value.urls);

  if (title) contact.title = title;
  if (org) contact.org = org;
  if (department) contact.department = department;
  if (note) contact.note = note;
  if (phones) contact.phones = phones;
  if (emails) contact.emails = emails;
  if (addresses) contact.addresses = addresses;
  if (urls) contact.urls = urls;
  return contact;
}

export function normalizePhotoTransform(value: unknown): PhotoTransform | undefined {
  if (!isRecord(value)) return undefined;
  const rotate = value.rotate;
  if (rotate !== 0 && rotate !== 90 && rotate !== 180 && rotate !== 270) return undefined;
  const scale = typeof value.scale === "number" && Number.isFinite(value.scale) ? value.scale : 1;
  const offsetX = typeof value.offsetX === "number" && Number.isFinite(value.offsetX) ? value.offsetX : 0;
  const offsetY = typeof value.offsetY === "number" && Number.isFinite(value.offsetY) ? value.offsetY : 0;
  return {
    rotate,
    scale: Math.min(3, Math.max(0.5, scale)),
    offsetX: Math.min(2, Math.max(-2, offsetX)),
    offsetY: Math.min(2, Math.max(-2, offsetY)),
  };
}

function normalizeAssets(value: unknown): CardAsset[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const assets = value
    .slice(0, ASSETS_MAX)
    .map((item) => {
      if (!isRecord(item)) return null;
      const id = cleanString(item.id, 128)?.trim();
      const kind = item.kind;
      const rawDataUrl = typeof item.dataUrl === "string" ? item.dataUrl.trim() : undefined;
      const dataUrl = rawDataUrl && rawDataUrl.length <= 20_000_000 ? rawDataUrl : undefined;
      const rawPreviewDataUrl = typeof item.previewDataUrl === "string" ? item.previewDataUrl.trim() : undefined;
      const previewDataUrl = rawPreviewDataUrl && rawPreviewDataUrl.length <= 1_000_000 ? rawPreviewDataUrl : undefined;
      const sourceRef = isRecord(item.sourceRef)
        && item.sourceRef.store === "assets"
        && typeof item.sourceRef.id === "string"
        && isUuid(item.sourceRef.id)
        ? { store: "assets" as const, id: item.sourceRef.id }
        : undefined;
      if (!id || !isUuid(id) || (kind !== "cardPhoto" && kind !== "avatar" && kind !== "logo")) return null;
      if (!isImageDataUrl(dataUrl) && !isImageDataUrl(previewDataUrl) && !sourceRef) return null;
      const mediaType = cleanString(item.mediaType, 80)?.trim()
        || dataUrl?.match(/^data:([^;]+);base64,/i)?.[1]
        || previewDataUrl?.match(/^data:([^;]+);base64,/i)?.[1]
        || "image/*";
      const asset: CardAsset = { id, kind, mediaType };
      if (dataUrl) asset.dataUrl = dataUrl;
      if (previewDataUrl) asset.previewDataUrl = previewDataUrl;
      if (sourceRef) asset.sourceRef = sourceRef;
      const transform = normalizePhotoTransform(item.transform);
      if (transform) asset.transform = transform;
      if (item.localOnly === true) asset.localOnly = true;
      return asset;
    })
    .filter((item): item is CardAsset => item !== null);
  return assets.length ? assets : undefined;
}

function normalizeCardProfile(value: unknown): CardProfile | undefined {
  if (!isRecord(value)) return undefined;
  const themeValue = cleanString(value.theme, 32)?.trim();
  const theme = themeValue && CARD_THEMES.has(themeValue as CardTheme) ? (themeValue as CardTheme) : undefined;
  const customColor = theme === "custom" && isHexColor(value.customColor) ? value.customColor : undefined;
  if (!theme && !customColor) return undefined;
  return customColor ? { theme, customColor } : { theme };
}

export function normalizeCardData(value: unknown): CardData | null {
  if (!isRecord(value)) return null;
  if (value.v !== 2) return null;

  const id = cleanString(value.id, 128)?.trim();
  const contact = normalizeContactInfo(value.contact);
  if (!id || !isUuid(id) || !contact) return null;

  const data: CardData = { v: 2, id, contact };
  const profile = normalizeCardProfile(value.profile);
  const assets = normalizeAssets(value.assets);
  if (profile) data.profile = profile;
  if (assets) data.assets = assets;
  return data;
}

function portableCardData(data: CardData): CardData {
  const assets = data.assets
    ?.filter((asset) => !asset.localOnly && asset.dataUrl)
    .map(({ previewDataUrl: _previewDataUrl, sourceRef: _sourceRef, ...asset }) => asset);
  return assets?.length ? { ...data, assets } : { ...data, assets: undefined };
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const withPadding = padded + "=".repeat((4 - (padded.length % 4)) % 4);
  const binary = atob(withPadding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function encodeCardFragment(data: CardData): Promise<string> {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(portableCardData(data)));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext),
  );

  const payload = new Uint8Array(iv.length + ciphertext.length);
  payload.set(iv, 0);
  payload.set(ciphertext, iv.length);

  const rawKey = new Uint8Array(await crypto.subtle.exportKey("raw", key));

  return `${FRAGMENT_PREFIX}.${toBase64Url(payload)}.${toBase64Url(rawKey)}`;
}

export async function decodeCardFragment(fragment: string): Promise<CardData | null> {
  const [prefix, payloadPart, keyPart] = fragment.split(".");
  if (prefix !== FRAGMENT_PREFIX || !payloadPart || !keyPart) return null;

  const payload = fromBase64Url(payloadPart);
  const iv = payload.slice(0, 12);
  const ciphertext = payload.slice(12);
  const rawKey = fromBase64Url(keyPart);

  const key = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return normalizeCardData(JSON.parse(new TextDecoder().decode(plaintext)));
}
