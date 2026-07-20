export const stage = document.querySelector<HTMLDivElement>("#stage")!;
const toastEl = document.querySelector<HTMLDivElement>("#toast")!;

export { isHexColor } from "./validators.ts";

export function esc(value: unknown): string {
  const div = document.createElement("div");
  div.textContent = value == null ? "" : String(value);
  // innerHTML only escapes &, <, > for a text node — it does not escape
  // quotes, since those aren't special outside an attribute-value context.
  // Every call site here interpolates this into a double-quoted HTML
  // attribute as well as element content, so escape quotes too or a value
  // containing `"` could break out of the attribute.
  return div.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function isSafeUrl(value: string | undefined): boolean {
  return /^https?:\/\//i.test(value || "");
}

// A bare domain (e.g. "linkedin.com/in/jane", no "https://") is the common
// case for a hand-typed or recognized social/website value, and shouldn't
// silently render as unclickable plain text. Anchored start-to-end against
// dot-separated alphanumeric labels plus an optional path, so it can't
// match anything containing a space or a colon (rules out "javascript:",
// "mailto:", plain prose, phone numbers, etc.) without needing a separate
// scheme blocklist.
const BARE_DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(\/\S*)?$/i;

export function isLinkableSocialValue(value: string | undefined): boolean {
  return isSafeUrl(value) || BARE_DOMAIN_RE.test((value || "").trim());
}

// Only call once isLinkableSocialValue(value) is true — an already-"https?://"
// value passes through untouched, a bare domain gets "https://" prepended
// for the href while the visible text (see card-view.ts) stays exactly as
// entered.
export function toSocialHref(value: string): string {
  return isSafeUrl(value) ? value : `https://${value.trim()}`;
}

let toastTimer: ReturnType<typeof setTimeout>;
export function showToast(message: string): void {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
}

export function formatReceivedAt(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
