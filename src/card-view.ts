import { CARD_THEMES, CARD_THEME_VALUES, type CardAsset, type CardData, type CardTheme, type ContactInfo, type ContactValue, type PhotoTransform } from "./crypto";
import { normalizePhotoTransform } from "./crypto";
import type { ReceivedEntry } from "./storage";
import { esc, isHexColor } from "./dom";
import { t } from "./i18n";
import { resolveSocialUrl } from "./social-url.ts";

export function cardThemes(): { value: CardTheme; label: string }[] {
  const labels: Partial<Record<CardTheme, string>> = { beige: t("themeBeige"), teal: t("themeDeepTeal"), ink: t("themeBlack") };
  return CARD_THEME_VALUES
    .filter((value) => value !== "custom")
    .map((value) => ({ value, label: labels[value] || value }));
}

export function roleLine(data: { title?: string; org?: string; department?: string }): string {
  return [data.title, data.department, data.org].filter(Boolean).join(" · ");
}

function cardFaceRoleLine(data: { title?: string; org?: string }): string {
  return [data.title, data.org].filter(Boolean).join(" · ");
}

export function taglineClass(value: string): string {
  return value.trim().length > 34 ? "card-tagline is-long" : "card-tagline";
}

export interface CardFaceOpts {
  cornerLabel?: string;
}

// A structural subset of CardData, not CardData itself: the editor renders
// a card face for an unsaved draft that has no `id` yet (only assigned on
// first save), and this only ever reads contact identity plus card profile.
export interface CardFaceData {
  contact: {
    fn: string;
    title?: string;
    org?: string;
    tagline?: string;
    department?: string;
  };
  profile?: {
    theme?: CardTheme;
    customColor?: string;
  };
}

// WCAG relative luminance, used only to pick a readable ink/accent pair for
// an arbitrary user-chosen custom color — not for contrast-ratio compliance
// math, so the 0.35 cutoff below is a judgment call, not a spec threshold.
function relativeLuminance(hex: string): number {
  const n = hex.replace("#", "");
  const r = parseInt(n.slice(0, 2), 16) / 255;
  const g = parseInt(n.slice(2, 4), 16) / 255;
  const b = parseInt(n.slice(4, 6), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export interface CustomThemeVars {
  card: string;
  ink: string;
  accent: string;
  accentBright: string;
  dark: boolean;
}

export function customThemeVars(hex: string): CustomThemeVars {
  const dark = relativeLuminance(hex) < 0.35;
  return {
    card: hex,
    ink: dark ? "#f1efe8" : "#22201a",
    accent: dark ? "#d7ab5c" : "#146c67",
    accentBright: dark ? "#eac488" : "#1e8f88",
    dark,
  };
}

export function cardFaceHtml(data: CardFaceData | undefined, opts: CardFaceOpts = {}): string {
  const name = data && data.contact.fn ? data.contact.fn : "";
  const nameHtml = name ? esc(name) : esc(t("myCard"));
  const nameClass = name ? "card-name" : "card-name placeholder";
  const role = cardFaceRoleLine(data?.contact || {});
  const tagline = data?.contact.tagline?.trim() || "";
  const theme = (data && data.profile?.theme) || "beige";
  // No corner mark by default — the centered name already identifies the
  // card. A corner label is only worth showing where it's doing real work:
  // disambiguating a collapsed sliver card in a stack (see stackCornerLabel).
  const cornerLabel = opts.cornerLabel || "";

  let themeAttrs = ` data-theme="${esc(theme === "custom" ? "beige" : theme)}"`;
  let styleAttr = "";
  if (theme === "custom" && data?.profile?.customColor && isHexColor(data.profile.customColor)) {
    const v = customThemeVars(data.profile.customColor);
    themeAttrs = ` data-theme="custom"${v.dark ? ' data-card-dark="true"' : ""}`;
    // v.card came straight from isHexColor's strict #rrggbb check above, so
    // it's safe to splice into a style attribute unescaped — anything that
    // regex doesn't match falls through to the beige branch instead.
    styleAttr = ` style="--card:${v.card};--card-ink:${v.ink};--card-accent:${v.accent};--card-accent-bright:${v.accentBright}"`;
  }

  return `
    <div class="card-face"${themeAttrs}${styleAttr}>
      ${cornerLabel ? `<div class="card-mark">${esc(cornerLabel)}</div>` : ""}
      <div class="card-body">
        <div class="${nameClass}">${nameHtml}</div>
        <div class="card-role">${role ? esc(role) : "&nbsp;"}</div>
      </div>
      ${tagline ? `<div class="${taglineClass(tagline)}">${esc(tagline)}</div>` : ""}
      <div class="foil-rule"></div>
    </div>
  `;
}

// Mirrors cardFaceHtml's theme resolution for the editor's live preview,
// where the card face already exists as a DOM node and just needs its
// attributes/vars updated in place rather than re-rendered from scratch.
export function applyCardFaceTheme(el: HTMLElement, theme: CardTheme, customColor?: string): void {
  if (theme === "custom" && customColor && isHexColor(customColor)) {
    const v = customThemeVars(customColor);
    el.setAttribute("data-theme", "custom");
    if (v.dark) el.setAttribute("data-card-dark", "true");
    else el.removeAttribute("data-card-dark");
    el.style.setProperty("--card", v.card);
    el.style.setProperty("--card-ink", v.ink);
    el.style.setProperty("--card-accent", v.accent);
    el.style.setProperty("--card-accent-bright", v.accentBright);
    return;
  }
  el.removeAttribute("data-card-dark");
  el.style.cssText = "";
  el.setAttribute("data-theme", theme === "custom" ? "beige" : theme);
}

// The 4th swatch is a single user-editable custom color slot — dashed
// (matching this app's existing "tap to add" convention, see
// .add-card-tile) when this card has no custom color set yet, filled with
// the picked color once it does.
export function themePickerHtml(selected: CardTheme = "beige", customColor?: string): string {
  const builtinSwatches = cardThemes()
    .map(
      (opt) => `
      <button type="button" class="theme-swatch" data-theme-option="${opt.value}" data-selected="${opt.value === selected}" aria-label="${esc(opt.label)}" aria-pressed="${opt.value === selected}">
        <span class="theme-swatch-color" data-theme="${opt.value}"></span>
      </button>
    `,
    )
    .join("");

  const hasCustom = customColor && isHexColor(customColor);
  const colorInputValue = hasCustom ? customColor : "#8a8f98";
  const customSwatch = `
    <label class="theme-swatch" data-theme-option="custom" data-selected="${selected === "custom"}" aria-label="${esc(t("customColor"))}">
      <span class="theme-swatch-color${hasCustom ? "" : " theme-swatch-color-empty"}"${hasCustom ? ` style="background:${customColor}"` : ""}>${hasCustom ? "" : "+"}</span>
      <input type="color" id="custom-color-input" class="custom-color-input" value="${esc(colorInputValue)}" />
    </label>
  `;

  return `
    <div class="theme-picker" id="theme-picker">
      ${builtinSwatches}${customSwatch}
    </div>
  `;
}

// CSS transform, applied on top of the untouched original image — see
// PhotoTransform's doc comment in storage.ts for why this stays a
// display-time overlay instead of a re-encode.
export function photoTransformStyle(transform: PhotoTransform | undefined): string {
  const safeTransform = normalizePhotoTransform(transform);
  if (!safeTransform) return "";
  const { rotate, scale, offsetX, offsetY } = safeTransform;
  // Percent, not px — resolves against the <img>'s own box (which always
  // matches the ID-1 frame it's in), so the same stored offset reads the
  // same whether this renders full-width, half-width in the grid, or in the
  // edit stage. See PhotoTransform's doc comment in storage.ts.
  return ` style="transform: translate(${offsetX * 100}%, ${offsetY * 100}%) rotate(${rotate}deg) scale(${scale})"`;
}

export function photoCardHtml(imageDataUrl: string, transform?: PhotoTransform): string {
  return `
    <div class="card-face photo-card-face">
      <img src="${esc(imageDataUrl)}" alt=""${photoTransformStyle(transform)} />
    </div>
  `;
}

export function cardPhotoAsset(data: CardData): CardAsset | undefined {
  return data.assets?.find((asset) => asset.kind === "cardPhoto");
}

// Cards in a stack (Mine or Received) collapse to a top sliver, so the
// generic "My Card" corner mark isn't enough to tell them apart while
// scanning — swap it for "Name - Company" wherever cards are stacked. The
// full Detail/Editor views keep the plain "My Card" brand mark.
export function stackCornerLabel(data: CardData): string {
  const name = data.contact.fn || "Untitled";
  return data.contact.org ? `${name} - ${data.contact.org}` : name;
}

export function receivedEntryFaceHtml(entry: ReceivedEntry, isFront: boolean): string {
  const cardPhoto = cardPhotoAsset(entry.data);
  const preview = cardPhoto?.previewDataUrl || cardPhoto?.dataUrl;
  if (preview) return photoCardHtml(preview, cardPhoto?.transform);
  return cardFaceHtml(entry.data, isFront ? {} : { cornerLabel: stackCornerLabel(entry.data) });
}

// A regular Mine/Recipient card already shows name/title/org on its
// card face (cardFaceHtml) — contactSheetHtml deliberately doesn't repeat
// them below it. A photo card has no such face (the face *is* the photo),
// so recognized identity fields would otherwise not be shown anywhere
// at all. Only renderPhotoDetail (views.ts) needs this.
export function identitySummaryHtml(data: ContactInfo): string {
  const role = cardFaceRoleLine(data);
  if (!data.fn && !role) return "";
  return `
    <div class="sheet-identity panel">
      ${data.fn ? `<div class="sheet-identity-name">${esc(data.fn)}</div>` : ""}
      ${role ? `<div class="sheet-identity-role">${esc(role)}</div>` : ""}
    </div>
  `;
}

export function contactSheetHtml(data: CardData): string {
  const rows: string[] = [];
  if (data.contact.department) {
    rows.push(`<div class="sheet-row"><dt>${esc(t("department"))}</dt><dd class="sheet-value-clip" title="${esc(data.contact.department)}">${esc(data.contact.department)}</dd></div>`);
  }
  for (const phone of data.contact.phones || []) {
    rows.push(`<div class="sheet-row"><dt>${esc(t("phone"))}</dt><dd class="sheet-value-clip"><a class="sheet-url-link" href="tel:${esc(phone.value)}" title="${esc(phone.value)}">${esc(phone.value)}</a></dd></div>`);
  }
  for (const email of data.contact.emails || []) {
    rows.push(`<div class="sheet-row"><dt>${esc(t("email"))}</dt><dd class="sheet-value-clip"><a class="sheet-url-link" href="mailto:${esc(email.value)}" title="${esc(email.value)}">${esc(email.value)}</a></dd></div>`);
  }
  for (const address of data.contact.addresses || []) {
    rows.push(`<div class="sheet-row"><dt>${esc(t("address"))}</dt><dd class="sheet-value-wrap">${esc(address.value)}</dd></div>`);
  }
  for (const url of data.contact.urls || []) {
    const resolved = resolveSocialUrl(url.label, url.value);
    const shown = resolved.href
      ? `<a class="sheet-url-link" href="${esc(resolved.href)}" title="${esc(resolved.href)}" target="_blank" rel="noopener">${esc(resolved.display)}</a>`
      : esc(resolved.display);
    rows.push(`<div class="sheet-row"><dt>${esc(url.label || "Website")}</dt><dd class="sheet-value-clip" title="${esc(resolved.display)}">${shown}</dd></div>`);
  }
  if (data.contact.note) {
    rows.push(`<div class="sheet-row"><dt>${esc(t("note"))}</dt><dd class="sheet-value-wrap">${esc(data.contact.note)}</dd></div>`);
  }
  if (!rows.length) return "";
  return `<dl class="sheet panel">${rows.join("")}</dl>`;
}

const CONTACT_VALUE_TYPES_BY_KIND = {
  phone: ["mobile", "work", "home", "main", "other"],
  email: ["work", "home", "other"],
  address: ["work", "home", "other"],
} as const;
const SOCIAL_PLATFORMS = ["Website", "LinkedIn", "GitHub", "Instagram", "Facebook", "YouTube", "TikTok", "Bluesky", "WhatsApp", "X (Twitter)", "Other"];

function contactValueTypeOptions(kind: "phone" | "email" | "address", selected = "work"): string {
  const options = CONTACT_VALUE_TYPES_BY_KIND[kind];
  const safeSelected = options.includes(selected as never) ? selected : options[0]!;
  return options.map(
    (type) => `<option value="${esc(type)}"${type === safeSelected ? " selected" : ""}>${esc(type)}</option>`,
  ).join("");
}

function socialPlatformOptions(selected = "Website"): string {
  return SOCIAL_PLATFORMS.map(
    (platform) => `<option value="${esc(platform)}"${platform === selected ? " selected" : ""}>${esc(platform)}</option>`,
  ).join("");
}

export function socialValuePlaceholder(label: string | undefined): string {
  if ((label || "").trim().toLowerCase() === "whatsapp") return t("phoneNumberOrLinkPlaceholder");
  return t("handleOrLinkPlaceholder");
}

export function contactValueRowHtml(kind: "phone" | "email" | "address" | "url", value?: ContactValue): string {
  const item = value || (kind === "url" ? { label: "Website", value: "" } : { type: kind === "phone" ? "mobile" : "work", value: "" });
  const selector = kind === "url"
    ? `<select data-contact-label>${socialPlatformOptions(item.label || "Website")}</select>`
    : `<select data-contact-type>${contactValueTypeOptions(kind, item.type)}</select>`;
  const placeholder = kind === "url" ? socialValuePlaceholder(item.label || "Website") : "";
  return `
    <div class="social-row" data-contact-row="${esc(kind)}">
      ${selector}
      <input data-contact-value placeholder="${esc(placeholder)}" value="${esc(item.value)}" />
      <button type="button" class="remove-social" data-remove-contact-value aria-label="${esc(t("remove"))}">&times;</button>
    </div>
  `;
}

export function collectFormData(form: HTMLFormElement): Omit<CardData, "id"> {
  const fd = new FormData(form);
  const collectValues = (kind: string): ContactValue[] => Array.from(form.querySelectorAll<HTMLElement>(`[data-contact-row="${kind}"]`))
    .map((row): ContactValue | null => {
      const type = (row.querySelector("[data-contact-type]") as HTMLSelectElement | null)?.value.trim() as ContactValue["type"] | undefined;
      const label = (row.querySelector("[data-contact-label]") as HTMLSelectElement | null)?.value.trim();
      const value = (row.querySelector("[data-contact-value]") as HTMLInputElement).value.trim();
      return value ? { ...(type ? { type } : {}), ...(label ? { label } : {}), value } : null;
    })
    .filter((item): item is ContactValue => item !== null);
  const themeValue = String(fd.get("theme") || "beige");
  const theme = CARD_THEMES.has(themeValue as CardTheme) ? themeValue as CardTheme : "beige";
  const customColorValue = String(fd.get("customColor") || "");
  const customColor = theme === "custom" && isHexColor(customColorValue) ? customColorValue : undefined;
  const phones = collectValues("phone");
  const emails = collectValues("email");
  const addresses = collectValues("address");
  const urls = collectValues("url");
  return {
    v: 2,
    contact: {
      fn: String(fd.get("fn") || "").trim(),
      title: String(fd.get("title") || "").trim(),
      org: String(fd.get("org") || "").trim(),
      tagline: String(fd.get("tagline") || "").trim(),
      department: String(fd.get("department") || "").trim(),
      note: String(fd.get("note") || "").trim(),
      phones,
      emails,
      addresses,
      urls,
    },
    profile: {
      theme,
      customColor,
    },
  };
}
