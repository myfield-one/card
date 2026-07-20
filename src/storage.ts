import { normalizeCardData, normalizePhotoTransform, type CardAsset, type CardData, type PhotoTransform } from "./crypto";
import { isUuid } from "./validators.ts";

// Local-only storage. Authored Mine cards and Received Cards both live in
// IndexedDB so they share one quota/error/migration model. Small device-local
// preferences (locale, layout, onboarding, AI language state) remain in
// localStorage.

export interface MineCard extends CardData {
  updatedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown, max = 2048): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.slice(0, max);
}

function cleanIsoDate(value: unknown): string | null {
  const iso = cleanString(value, 80);
  if (!iso) return null;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

function isImageDataUrl(value: unknown): value is string {
  return typeof value === "string" && /^data:image\/[-+.\w]+;base64,/i.test(value);
}

function normalizeMineCard(value: unknown): MineCard | null {
  if (!isRecord(value)) return null;
  const data = normalizeCardData(value);
  const updatedAt = cleanIsoDate(value.updatedAt);
  if (!data || !updatedAt) return null;
  return { ...data, updatedAt };
}

function normalizeReceivedEntry(value: unknown): ReceivedEntry | null {
  if (!isRecord(value)) return null;
  const id = cleanString(value.id, 128)?.trim();
  const receivedAt = cleanIsoDate(value.receivedAt);
  if (!id || !isUuid(id) || !receivedAt) return null;

  const data = normalizeCardData(value.data);
  return data ? { id, receivedAt, data } : null;
}

export interface ReceivedEntry {
  id: string;
  receivedAt: string;
  data: CardData;
}

const ACTIVE_MINE_KEY = "mycard.activeMineId";
const LOCALE_KEY = "mycard.locale";
const RECEIVED_LAYOUT_KEY = "mycard.receivedLayout";
const AI_LANGUAGES_KEY = "mycard.aiLanguages";
const AI_DOWNLOADED_LANGUAGES_KEY = "mycard.aiDownloadedLanguages";
const ONBOARDING_SEEN_KEY = "mycard.onboardingSeen";

const CARD_DB_NAME = "mycard";
const CARD_DB_VERSION = 3;
const MINE_STORE = "mine";
const RECEIVED_STORE = "received";
const ASSET_STORE = "assets";

interface LocalAssetRecord {
  id: string;
  mediaType: string;
  dataUrl: string;
}

function openCardDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CARD_DB_NAME, CARD_DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(MINE_STORE)) {
        req.result.createObjectStore(MINE_STORE, { keyPath: "id" });
      }
      if (!req.result.objectStoreNames.contains(RECEIVED_STORE)) {
        req.result.createObjectStore(RECEIVED_STORE, { keyPath: "id" });
      }
      if (!req.result.objectStoreNames.contains(ASSET_STORE)) {
        req.result.createObjectStore(ASSET_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadMine(): Promise<MineCard[]> {
  const db = await openCardDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(MINE_STORE, "readonly").objectStore(MINE_STORE).getAll();
    req.onsuccess = () => {
      const rows = Array.isArray(req.result) ? req.result : [];
      resolve(rows.map(normalizeMineCard).filter((card): card is MineCard => card !== null));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveMine(list: MineCard[]): Promise<void> {
  const normalized = list.map(normalizeMineCard).filter((card): card is MineCard => card !== null);
  const db = await openCardDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MINE_STORE, "readwrite");
    const store = tx.objectStore(MINE_STORE);
    store.clear();
    for (const card of normalized) store.put(card);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function loadActiveMineId(): string {
  return localStorage.getItem(ACTIVE_MINE_KEY) || "";
}

export function storeActiveMineId(id: string): void {
  localStorage.setItem(ACTIVE_MINE_KEY, id);
}

export function clearActiveMineId(): void {
  localStorage.removeItem(ACTIVE_MINE_KEY);
}

export async function loadReceived(): Promise<ReceivedEntry[]> {
  const db = await openCardDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(RECEIVED_STORE, "readonly").objectStore(RECEIVED_STORE).getAll();
    req.onsuccess = () => {
      const rows = Array.isArray(req.result) ? req.result : [];
      resolve(rows.map(normalizeReceivedEntry).filter((entry): entry is ReceivedEntry => entry !== null));
    };
    req.onerror = () => reject(req.error);
  });
}

async function putReceivedEntry(entry: ReceivedEntry): Promise<void> {
  const normalized = normalizeReceivedEntry(entry);
  if (!normalized) return;
  const db = await openCardDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RECEIVED_STORE, "readwrite");
    tx.objectStore(RECEIVED_STORE).put(normalized);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteReceivedEntry(id: string): Promise<void> {
  const entry = (await loadReceived()).find((item) => item.id === id);
  const assetIds = entry?.data.assets?.map((asset) => asset.sourceRef?.id).filter((assetId): assetId is string => Boolean(assetId)) || [];
  const db = await openCardDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([RECEIVED_STORE, ASSET_STORE], "readwrite");
    tx.objectStore(RECEIVED_STORE).delete(id);
    const assetStore = tx.objectStore(ASSET_STORE);
    for (const assetId of assetIds) assetStore.delete(assetId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Keyed by the sender's own card id (carried inside the encrypted payload —
// see crypto.ts's CardData.id), not by content, so re-opening the same
// link (or a re-share after the sender edited a field) updates the
// existing entry in place instead of piling up duplicates. Two different
// people who happen to share the same name/phone would still get separate
// entries, since each has its own id.
export async function findReceivedContactEntry(cardId: string | undefined): Promise<ReceivedEntry | null> {
  if (!cardId) return null;
  const list = await loadReceived();
  return list.find((entry) => entry.data.id === cardId) || null;
}

export async function addReceived(data: CardData): Promise<void> {
  const normalized = normalizeCardData(data);
  if (!normalized) return;
  const existing = await findReceivedContactEntry(normalized.id);
  const id = existing ? existing.id : crypto.randomUUID();
  await putReceivedEntry({ id, receivedAt: new Date().toISOString(), data: normalized });
}

// Returns the new entry's id so the caller can route straight into the
// rotate/scale/position edit step (see renderPhotoEdit in views.ts) without
// a second round-trip through storage.
export async function addReceivedPhoto(imageDataUrl: string, previewDataUrl?: string): Promise<string> {
  if (!isImageDataUrl(imageDataUrl)) throw new Error("Unsupported image data URL");
  const id = crypto.randomUUID();
  const mediaType = imageDataUrl.match(/^data:([^;]+);base64,/i)?.[1] || "image/*";
  const asset: CardAsset = {
    id,
    kind: "cardPhoto",
    mediaType,
    sourceRef: { store: "assets", id },
    ...(isImageDataUrl(previewDataUrl) ? { previewDataUrl } : {}),
    localOnly: true,
  };
  const entry: ReceivedEntry = {
    id,
    receivedAt: new Date().toISOString(),
    data: {
      v: 2,
      id,
      contact: { fn: "" },
      assets: [asset],
    },
  };
  const normalized = normalizeReceivedEntry(entry);
  if (!normalized) throw new Error("Could not save photo card");
  const db = await openCardDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([RECEIVED_STORE, ASSET_STORE], "readwrite");
    tx.objectStore(ASSET_STORE).put({ id, mediaType, dataUrl: imageDataUrl } satisfies LocalAssetRecord);
    tx.objectStore(RECEIVED_STORE).put(normalized);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return id;
}

export async function loadCardAssetDataUrl(asset: CardAsset): Promise<string | undefined> {
  if (asset.dataUrl) return asset.dataUrl;
  if (!asset.sourceRef) return asset.previewDataUrl;
  const db = await openCardDb();
  return new Promise<string | undefined>((resolve, reject) => {
    const req = db.transaction(ASSET_STORE, "readonly").objectStore(ASSET_STORE).get(asset.sourceRef!.id);
    req.onsuccess = () => {
      const result = req.result;
      if (isRecord(result) && typeof result.dataUrl === "string" && isImageDataUrl(result.dataUrl)) resolve(result.dataUrl);
      else resolve(asset.previewDataUrl);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveCardAssetPreview(entryId: string, assetId: string, previewDataUrl: string): Promise<boolean> {
  if (!isImageDataUrl(previewDataUrl)) return false;
  const entry = await loadReceivedEntry(entryId);
  if (!entry) return false;
  const assets = (entry.data.assets || []).map((asset) => (
    asset.id === assetId ? { ...asset, previewDataUrl } : asset
  ));
  const normalized = normalizeCardData({ ...entry.data, assets });
  if (!normalized) return false;
  await putReceivedEntry({ ...entry, data: normalized });
  return true;
}

async function loadReceivedEntry(id: string): Promise<ReceivedEntry | undefined> {
  const db = await openCardDb();
  return new Promise<ReceivedEntry | undefined>((resolve, reject) => {
    const req = db.transaction(RECEIVED_STORE, "readonly").objectStore(RECEIVED_STORE).get(id);
    req.onsuccess = () => resolve(normalizeReceivedEntry(req.result) || undefined);
    req.onerror = () => reject(req.error);
  });
}

// Updates the same CardData that carries the cardPhoto asset. The original
// photo remains in assets; OCR only replaces the contact/profile fields.
export async function saveRecognizedPhotoData(id: string, data: CardData | undefined): Promise<boolean> {
  const entry = await loadReceivedEntry(id);
  if (!entry || !data) return false;
  const normalized = normalizeCardData({ ...data, id, assets: entry.data.assets });
  if (!normalized) return false;
  await putReceivedEntry({ ...entry, data: normalized });
  return true;
}

export async function savePhotoTransform(id: string, assetId: string, transform: PhotoTransform): Promise<boolean> {
  const entry = await loadReceivedEntry(id);
  if (!entry) return false;
  const safeTransform = normalizePhotoTransform(transform);
  if (!safeTransform) return false;
  const assets = (entry.data.assets || []).map((asset) => (
    asset.kind === "cardPhoto" && asset.id === assetId ? { ...asset, transform: safeTransform } : asset
  ));
  if (!assets.some((asset) => asset.kind === "cardPhoto" && asset.id === assetId)) return false;
  const normalized = normalizeCardData({ ...entry.data, assets });
  if (!normalized) return false;
  await putReceivedEntry({ ...entry, data: normalized });
  return true;
}

// This only wires selection + persistence, not full retranslation of the
// UI strings.
export interface LocaleOption {
  code: string;
  name: string;
}

export const LOCALES: LocaleOption[] = [
  { code: "en", name: "English" },
  { code: "zh-Hans", name: "简体中文" },
  { code: "zh-Hant", name: "繁體中文" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "ja", name: "日本語" },
  { code: "ko", name: "한국어" },
  { code: "pt", name: "Português" },
];

function detectLocale(): string {
  for (const lang of navigator.languages || [navigator.language || "en"]) {
    const lower = String(lang || "").toLowerCase();
    if (lower.startsWith("zh")) {
      return /hant|-tw|-hk|-mo/.test(lower) ? "zh-Hant" : "zh-Hans";
    }
    const match = LOCALES.find((l) => l.code !== "zh-Hans" && l.code !== "zh-Hant" && lower.startsWith(l.code));
    if (match) return match.code;
  }
  return "en";
}

export function loadLocale(): string {
  return localStorage.getItem(LOCALE_KEY) || detectLocale();
}

export function storeLocale(code: string): void {
  localStorage.setItem(LOCALE_KEY, code);
}

export function loadReceivedLayout(): "stack" | "grid" {
  return localStorage.getItem(RECEIVED_LAYOUT_KEY) === "grid" ? "grid" : "stack";
}

export function storeReceivedLayout(mode: "stack" | "grid"): void {
  localStorage.setItem(RECEIVED_LAYOUT_KEY, mode);
}

// Gates the first-run onboarding overlay (renderStack in views.ts) — only
// set once the user explicitly checks "don't show this again"; leaving it
// unchecked means the overlay keeps appearing, by design.
export function hasSeenOnboarding(): boolean {
  return localStorage.getItem(ONBOARDING_SEEN_KEY) === "1";
}

export function markOnboardingSeen(): void {
  localStorage.setItem(ONBOARDING_SEEN_KEY, "1");
}

// Local business-card recognition (see recognizer.ts/ocr.ts) — off by
// default, and checking a language is what turns it on (see isAiEnabled
// below) and triggers that language's model download. This list is
// independent of the app's own display locale (LOCALES above), since a
// photographed card's language has nothing to do with which language the UI
// itself is shown in.
export interface AiLanguageOption {
  code: string;
  name: string;
}

// Matches LOCALES' language coverage above, one Tesseract "_fast" traineddata
// per UI locale (see public/tesseract/lang-data and README.md's
// Acknowledgments) — not the same list for the same reason noted above, they
// just happen to cover the same set of languages today.
export const AI_LANGUAGES: AiLanguageOption[] = [
  { code: "eng", name: "English" },
  { code: "chi_sim", name: "简体中文" },
  { code: "chi_tra", name: "繁體中文" },
  { code: "spa", name: "Español" },
  { code: "fra", name: "Français" },
  { code: "deu", name: "Deutsch" },
  { code: "jpn", name: "日本語" },
  { code: "kor", name: "한국어" },
  { code: "por", name: "Português" },
];

function loadCodeList(key: string, fallback: string[]): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) return parsed;
  } catch {
    /* fall through to fallback */
  }
  return fallback;
}

// No languages checked = off; there's no separate on/off flag. Empty by
// default (not pre-checked) — the feature stays off until the user checks a
// language, either from Settings or the inline enable prompt in
// renderPhotoDetail (views.ts).
export function loadAiLanguages(): string[] {
  return loadCodeList(AI_LANGUAGES_KEY, []);
}

export function storeAiLanguages(langs: string[]): void {
  localStorage.setItem(AI_LANGUAGES_KEY, JSON.stringify(langs));
}

export function isAiEnabled(): boolean {
  return loadAiLanguages().length > 0;
}

// One Tesseract language code per UI locale — used to pick a sensible
// starting point the first time a user opts in from the scan flow (see the
// inline enable prompt in renderPhotoDetail, views.ts), not to imply a
// card's language is tied to the UI's. English is always included alongside
// it since card content mixed with English (titles, company names) is
// common regardless of the card's primary language. Just a starting point:
// the user can check more languages from Settings afterward.
const LOCALE_AI_LANGUAGE: Record<string, string> = {
  en: "eng",
  "zh-Hans": "chi_sim",
  "zh-Hant": "chi_tra",
  es: "spa",
  fr: "fra",
  de: "deu",
  ja: "jpn",
  ko: "kor",
  pt: "por",
};

export function defaultAiLanguagesForLocale(locale: string): string[] {
  const mapped = LOCALE_AI_LANGUAGE[locale] || "eng";
  return mapped === "eng" ? ["eng"] : [mapped, "eng"];
}

// Tracked separately from the *selected* languages above — selecting a
// language is a preference, but only an actual completed worker
// initialization means its .traineddata is really downloaded and cached
// for offline use, which is what the Settings page's "ready offline" status
// should reflect.
export function loadDownloadedAiLanguages(): string[] {
  return loadCodeList(AI_DOWNLOADED_LANGUAGES_KEY, []);
}

export function markAiLanguageDownloaded(lang: string): void {
  const current = loadDownloadedAiLanguages();
  if (current.includes(lang)) return;
  localStorage.setItem(AI_DOWNLOADED_LANGUAGES_KEY, JSON.stringify([...current, lang]));
}
