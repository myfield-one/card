export function isSafeUrl(value: string | undefined): boolean {
  return /^(https?:\/\/|mailto:|tel:|whatsapp:\/\/|tg:\/\/|bsky:\/\/)/i.test(value || "");
}

// A bare domain (e.g. "example.com", no "https://") is linkified only for
// Website-style values. Other free-form social values stay literal, and
// platform handles such as Bluesky's "alice.bsky.social" are resolved by
// the platform-specific branch instead of being mistaken for a website.
const BARE_DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(\/\S*)?$/i;

function canonicalPlatform(label: string | undefined): string {
  return (label || "Website").trim().toLowerCase().replace(/\s+/g, " ");
}

function isWebsitePlatform(label: string | undefined): boolean {
  return canonicalPlatform(label) === "website";
}

function socialHandle(value: string): string {
  return value.trim().replace(/^@+/, "");
}

function bareDomainHref(value: string): string | undefined {
  const trimmed = value.trim();
  return BARE_DOMAIN_RE.test(trimmed) ? `https://${trimmed}` : undefined;
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
  const platform = canonicalPlatform(label);
  const raw = value.trim();
  const handle = socialHandle(value);
  if (!handle) return undefined;
  if (handle.includes("/")) return undefined;
  if (platform !== "bluesky" && !raw.startsWith("@") && BARE_DOMAIN_RE.test(handle)) return undefined;

  switch (platform) {
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

  if (isSafeUrl(trimmed)) {
    return { display: trimmed, href: trimmed, vcardValue: trimmed };
  }

  const websiteHref = isWebsitePlatform(label) ? bareDomainHref(trimmed) : undefined;
  if (websiteHref) {
    return { display: websiteHref, href: websiteHref, vcardValue: websiteHref };
  }

  const href = platformUrl(label, trimmed);
  if (href) return { display: href, href, vcardValue: href };

  return { display: trimmed, vcardValue: trimmed };
}
