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

// Only call once isLinkableSocialValue(value) is true: an already-"https?://"
// value passes through untouched, a bare domain gets "https://" prepended.
export function toSocialHref(value: string): string {
  return isSafeUrl(value) ? value : `https://${value.trim()}`;
}

function canonicalPlatform(label: string | undefined): string {
  return (label || "Website").trim().toLowerCase().replace(/\s+/g, " ");
}

function socialHandle(value: string): string {
  return value.trim().replace(/^@+/, "");
}

function prefixedHandle(value: string): string {
  const handle = socialHandle(value);
  return handle ? `@${handle}` : "";
}

function whatsappNumberUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.startsWith("@")) return undefined;
  if (!/^\+?[\d\s().-]+$/.test(trimmed)) return undefined;

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7) return undefined;
  return `https://wa.me/${digits}`;
}

function platformUrl(label: string | undefined, value: string): string | undefined {
  const handle = socialHandle(value);
  if (!handle) return undefined;

  switch (canonicalPlatform(label)) {
    case "linkedin":
      return `https://www.linkedin.com/in/${handle}`;
    case "x":
    case "x (twitter)":
    case "twitter":
      return `https://x.com/${handle}`;
    case "instagram":
      return `https://www.instagram.com/${handle}`;
    case "github":
      return `https://github.com/${handle}`;
    case "facebook":
      return `https://www.facebook.com/${handle}`;
    case "whatsapp":
      return whatsappNumberUrl(value);
    case "youtube":
      return `https://www.youtube.com/${prefixedHandle(value)}`;
    case "tiktok":
      return `https://www.tiktok.com/${prefixedHandle(value)}`;
    case "bluesky":
      return `https://bsky.app/profile/${handle}`;
    default:
      return undefined;
  }
}

export interface ResolvedSocialUrl {
  display: string;
  href?: string;
  vcardValue: string;
}

export function resolveSocialUrl(label: string | undefined, value: string): ResolvedSocialUrl {
  const trimmed = value.trim();
  if (!trimmed) return { display: "", vcardValue: "" };

  if (isLinkableSocialValue(trimmed)) {
    const href = toSocialHref(trimmed);
    const display = canonicalPlatform(label) === "other" ? trimmed : href;
    return { display, href, vcardValue: href };
  }

  const href = platformUrl(label, trimmed);
  if (href) return { display: href, href, vcardValue: href };

  return { display: trimmed, vcardValue: trimmed };
}
