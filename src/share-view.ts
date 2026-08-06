import qrcode from "./vendor/qrcode.mjs";
import type { CardTheme } from "./crypto";
import { esc, isHexColor, showToast } from "./dom";
import { t } from "./i18n";
import { customThemeVars } from "./card-view";

// The share link's fragment carries the AES key in plaintext (see
// crypto.ts) — it must never leave the device except via the user's own
// explicit share/copy action, so the QR is generated fully client-side by
// this vendored, dependency-free encoder (apps/card/src/vendor/qrcode.mjs)
// rather than any remote "generate a QR for this URL" service.
function qrSvg(url: string): string {
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  // Fixed black-on-white output (see the vendored encoder) regardless of
  // the card's own theme — wrapped in its own white tile below so it stays
  // scannable even on the Black/Deep Teal card themes.
  return qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
}

// Rendered into the same `.card-flip` slot as the front `.card-face` (see
// views.ts's renderDetail) — reuses the `card-face` class so it keeps the
// same ID-1 card size/border/shadow and that theme's colors, with
// `card-back` only overriding internal layout to center the QR (see
// style.css). No close button or link text on the card itself — those
// live below the card now (see shareActionsHtml).
export function shareBackHtml(url: string, theme: CardTheme = "beige", customColor?: string, name?: string): string {
  let themeAttrs = ` data-theme="${esc(theme === "custom" ? "beige" : theme)}"`;
  let styleAttr = "";
  const displayName = name?.trim();
  if (theme === "custom" && customColor && isHexColor(customColor)) {
    const v = customThemeVars(customColor);
    themeAttrs = ` data-theme="custom"${v.dark ? ' data-card-dark="true"' : ""}`;
    styleAttr = ` style="--card:${v.card};--card-ink:${v.ink};--card-accent:${v.accent};--card-accent-bright:${v.accentBright}"`;
  }
  return `
    <div class="card-face card-back${displayName ? " card-back-with-name" : ""}"${themeAttrs}${styleAttr}>
      ${displayName ? `<div class="card-back-name">${esc(displayName)}</div>` : ""}
      <button type="button" class="card-back-qr" id="card-back-qr-btn" aria-label="${esc(t("zoomQrCode"))}">${qrSvg(url)}</button>
    </div>
  `;
}

// Tapping the QR toggles `.is-zoomed` on the enclosing `.card-back` —
// content large enough to need this (a long share URL raises the QR's
// module count) benefits from a bigger scan target than the default size
// leaves room for on a card kept at the front face's ID-1 proportions.
// Bound once here rather than re-queried per flip, since views.ts's
// enterShareView calls this fresh after each innerHTML swap anyway.
export function wireShareBack(container: ParentNode): void {
  const cardBack = container.querySelector<HTMLElement>(".card-back");
  const qrBtn = container.querySelector<HTMLButtonElement>("#card-back-qr-btn");
  if (!cardBack || !qrBtn) return;
  qrBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    cardBack.classList.toggle("is-zoomed");
  });
}

// Replaces the contact-details section (views.ts's #detail-info) while
// sharing is active: actions instead of the usual read-only fields, plus a
// hint pointing at the browser's own share affordance — which is a real
// option now because the address bar shows this exact URL (see
// renderDetail's history.pushState). The system-share button only renders
// when the Web Share API actually exists — there's no clipboard fallback
// for it anymore (that's what the separate Copy link button is for), so a
// rendered-but-inert button on a device without navigator.share would just
// be dead weight.
export function shareActionsHtml(): string {
  const systemShareBtn = "share" in navigator
    ? `<button type="button" class="btn btn-primary" id="share-system-btn">${esc(t("shareTo"))}</button>`
    : "";
  return `
    <div class="share-actions">
      <div class="btn-row">
        ${systemShareBtn}
        <button type="button" class="btn btn-secondary" id="share-copy-btn">${esc(t("copyLink"))}</button>
      </div>
      <p class="share-hint">${esc(t("shareBrowserHint"))}</p>
    </div>
  `;
}

export function wireShareActions(container: ParentNode, url: string): void {
  container.querySelector("#share-copy-btn")!.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(url);
      showToast(t("linkCopied"));
    } catch {
      showToast(t("couldNotCopyLink"));
    }
  });

  container.querySelector("#share-system-btn")?.addEventListener("click", async () => {
    try {
      // Deliberately not the card owner's name — the OS share sheet and
      // whatever target app handles this (email, SMS, third-party apps)
      // sees this title as plain text outside the link's own encryption,
      // so it must not carry anything identifying.
      await navigator.share({ title: t("myCard"), url });
    } catch {
      /* user cancelled or the share sheet failed — no fallback, no toast */
    }
  });
}
