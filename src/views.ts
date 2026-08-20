import { decodeCardFragment, encodeCardFragment, normalizePhotoTransform, type CardData, type CardTheme, type ContactValueType, type PhotoTransform } from "./crypto";
import { buildVCard } from "./vcard";
import { esc, isHexColor, showToast, stage, formatReceivedAt } from "./dom";
import { t } from "./i18n";
import { shareBackHtml, shareActionsHtml, wireShareActions, wireShareBack } from "./share-view";
import {
  cardFaceHtml,
  contactSheetHtml,
  identitySummaryHtml,
  collectFormData,
  contactValueRowHtml,
  socialValuePlaceholder,
  roleLine,
  stackCornerLabel,
  receivedEntryFaceHtml,
  cardPhotoAsset,
  photoCardHtml,
  themePickerHtml,
  applyCardFaceTheme,
  taglineClass,
} from "./card-view";
import {
  type MineCard,
  type ReceivedEntry,
  loadMine,
  saveMine,
  loadActiveMineId,
  storeActiveMineId,
  clearActiveMineId,
  loadReceived,
  deleteMineCard,
  deleteReceivedEntry,
  findReceivedContactEntry,
  addReceived,
  addReceivedPhoto,
  loadCardAssetDataUrl,
  saveCardAssetPreview,
  saveRecognizedPhotoData,
  savePhotoTransform,
  LOCALES,
  loadLocale,
  storeLocale,
  loadReceivedLayout,
  storeReceivedLayout,
  AI_LANGUAGES,
  isAiEnabled,
  loadAiLanguages,
  storeAiLanguages,
  loadDownloadedAiLanguages,
  markAiLanguageDownloaded,
  defaultAiLanguagesForLocale,
  hasSeenOnboarding,
  markOnboardingSeen,
} from "./storage";
import { warmUpOcrLanguages, recognizeCardImage, cropToCardFrame } from "./ocr";
import { parseContactFields, type RecognizedField, type FieldType } from "./recognizer";
import { cardDataToRecognizedFields, fieldsToCardData } from "./recognized-fields";
import { buildPhotoCardsZip, myCardsVCard, receivedCardsVCard } from "./export-data";
import {
  authorizeCardSync,
  clearCardSyncAuthorization,
  connectCardSync,
  handleCardSyncAuthCallback,
} from "./sync/cloud";
import type { createCardSyncController } from "./sync/card-sync-controller";

declare const __APP_VERSION__: string;

const APP_VERSION = __APP_VERSION__;

type CurrentView =
  | { kind: "mine-stack" }
  | { kind: "mine-detail"; id: string }
  | { kind: "received-list" }
  | { kind: "received-detail"; id: string }
  | { kind: "photo-detail"; id: string }
  | { kind: "editing" }
  | { kind: "other" };

let currentView: CurrentView = { kind: "other" };

/* ============ editor ============ */

function blankCardDraft(): Omit<MineCard, "id" | "updatedAt"> {
  return {
    v: 2,
    contact: {
      fn: "",
      title: "",
      org: "",
      tagline: "",
      department: "",
      note: "",
      phones: [{ type: "mobile", value: "" }],
      emails: [{ type: "work", value: "" }],
      addresses: [{ type: "work", value: "" }],
      urls: [{ label: "Website", value: "" }],
    },
    profile: {},
  };
}

type OptionalContactField = "department" | "note";

function optionalContactFieldHtml(kind: OptionalContactField, value = ""): string {
  const input = kind === "note"
    ? `<textarea name="note" rows="3">${esc(value)}</textarea>`
    : `<input name="department" value="${esc(value)}" autocomplete="organization" />`;
  return `
    <div class="field" data-optional-contact-field="${kind}">
      <label>${esc(t(kind))}</label>
      ${input}
    </div>
  `;
}

function addFieldMenuHtml(contact: MineCard["contact"]): string {
  const hasDepartment = Boolean(contact.department);
  const hasNote = Boolean(contact.note);
  if (hasDepartment && hasNote) return "";
  return `
    <div class="add-field-block" id="optional-field-add-block">
      <button type="button" class="add-social" id="optional-field-menu-btn">${esc(t("addField"))}</button>
      <div class="add-field-menu" id="optional-field-menu" hidden>
        ${hasDepartment ? "" : `<button type="button" data-add-optional-field="department">${esc(t("department"))}</button>`}
        ${hasNote ? "" : `<button type="button" data-add-optional-field="note">${esc(t("note"))}</button>`}
      </div>
    </div>
  `;
}

function positionOptionalFieldMenu(menu: HTMLElement, anchor: HTMLElement): void {
  const viewport = window.visualViewport;
  const viewportLeft = viewport?.offsetLeft || 0;
  const viewportTop = viewport?.offsetTop || 0;
  const viewportWidth = viewport?.width || window.innerWidth;
  const viewportHeight = viewport?.height || window.innerHeight;
  const margin = 12;
  const anchorRect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const width = menuRect.width || 180;
  const height = menuRect.height || 96;
  const left = Math.min(
    viewportLeft + viewportWidth - width - margin,
    Math.max(viewportLeft + margin, viewportLeft + anchorRect.right - width),
  );
  const preferredTop = viewportTop + anchorRect.top - height - 8;
  const fallbackTop = viewportTop + anchorRect.bottom + 8;
  const maxTop = viewportTop + viewportHeight - height - margin;
  const top = preferredTop >= viewportTop + margin
    ? preferredTop
    : Math.min(maxTop, Math.max(viewportTop + margin, fallbackTop));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

export async function renderEditor(existing: MineCard | null): Promise<void> {
  currentView = { kind: "editing" };
  const isNew = !existing;
  const data = existing || blankCardDraft();
  const mineForDeleteState = await loadMine();
  const canDelete = !isNew && mineForDeleteState.length > 1;

  stage.innerHTML = `
    <div class="top-bar top-bar-split">
      <div class="top-bar-left">
        <button type="button" class="icon-btn" id="editor-back-btn" aria-label="${esc(t("back"))}">&lsaquo;</button>
      </div>
      <div class="top-bar-actions">
        <button type="button" class="top-bar-cancel-btn" id="editor-cancel-btn" hidden>${esc(t("cancel"))}</button>
        <button type="submit" form="card-form" class="top-bar-done-btn" id="editor-save-btn">${esc(t("save"))}</button>
      </div>
    </div>
    ${cardFaceHtml(data)}
    <form class="panel" id="card-form">
      <h2>${esc(t("yourDetails"))}</h2>
      <div class="field">
        <label>${esc(t("cardColor"))}</label>
        <input type="hidden" name="theme" id="theme-input" value="${data.profile?.theme || "beige"}" />
        <input type="hidden" name="customColor" id="custom-color-value-input" value="${data.profile?.customColor || ""}" />
        ${themePickerHtml(data.profile?.theme || "beige", data.profile?.customColor)}
      </div>
      <div class="field">
        <label>${esc(t("name"))}</label>
        <input name="fn" id="name-input" value="${esc(data.contact.fn)}" autocomplete="name" required />
      </div>
      <div class="field">
        <label>${esc(t("title"))}</label>
        <input name="title" value="${esc(data.contact.title)}" autocomplete="organization-title" />
      </div>
      <div class="field">
        <label>${esc(t("company"))}</label>
        <input name="org" value="${esc(data.contact.org)}" autocomplete="organization" />
      </div>
      <div class="field">
        <label>${esc(t("tagline"))}</label>
        <input name="tagline" value="${esc(data.contact.tagline)}" />
      </div>
      <div class="field">
        <label>${esc(t("phone"))}</label>
        <div id="phone-list">
          ${(data.contact.phones && data.contact.phones.length ? data.contact.phones : [{ type: "mobile" as const, value: "" }]).map((value) => contactValueRowHtml("phone", value)).join("")}
        </div>
        <button type="button" class="add-social" data-add-contact-value="phone">${esc(t("addAnother"))}</button>
      </div>
      <div class="field">
        <label>${esc(t("email"))}</label>
        <div id="email-list">
          ${(data.contact.emails && data.contact.emails.length ? data.contact.emails : [{ type: "work" as const, value: "" }]).map((value) => contactValueRowHtml("email", value)).join("")}
        </div>
        <button type="button" class="add-social" data-add-contact-value="email">${esc(t("addAnother"))}</button>
      </div>
      <div class="field">
        <label>${esc(t("address"))}</label>
        <div id="address-list">
          ${(data.contact.addresses && data.contact.addresses.length ? data.contact.addresses : [{ type: "work" as const, value: "" }]).map((value) => contactValueRowHtml("address", value)).join("")}
        </div>
        <button type="button" class="add-social" data-add-contact-value="address">${esc(t("addAnother"))}</button>
      </div>
      <div class="field">
        <label>${esc(t("socialAccounts"))}</label>
        <div id="url-list">
          ${(data.contact.urls && data.contact.urls.length ? data.contact.urls : [{ label: "Website", value: "" }]).map((value) => contactValueRowHtml("url", value)).join("")}
        </div>
        <button type="button" class="add-social" data-add-contact-value="url">${esc(t("addAnother"))}</button>
      </div>
      <div id="optional-field-list">
        ${data.contact.department ? optionalContactFieldHtml("department", data.contact.department) : ""}
        ${data.contact.note ? optionalContactFieldHtml("note", data.contact.note) : ""}
      </div>
      ${addFieldMenuHtml(data.contact)}
      ${canDelete ? `<button type="button" class="form-delete-btn" id="delete-card-btn">${esc(t("deleteThisCard"))}</button>` : ""}
    </form>
  `;

  const form = document.getElementById("card-form") as HTMLFormElement;
  const nameInput = document.getElementById("name-input") as HTMLInputElement;
  const cardNameEl = () => stage.querySelector(".card-name") as HTMLElement;
  const cardRoleEl = () => stage.querySelector(".card-role") as HTMLElement;
  const cardFaceEl = () => stage.querySelector(".card-face") as HTMLElement;
  const themeInput = document.getElementById("theme-input") as HTMLInputElement;
  const customColorInput = document.getElementById("custom-color-value-input") as HTMLInputElement;
  const customColorPicker = document.getElementById("custom-color-input") as HTMLInputElement;
  const cancelBtn = document.getElementById("editor-cancel-btn") as HTMLButtonElement;

  // Once true, stays true for this render — an exact-match "did they
  // revert it back to the original value" check isn't worth the
  // complexity here; the Cancel button just needs to appear once anything
  // has plausibly changed.
  let isDirty = false;
  const markDirty = (): void => {
    if (isDirty) return;
    isDirty = true;
    cancelBtn.hidden = false;
  };
  // Delegated on the form: covers every text/select field (including the
  // native color picker input once it's changed, since that's rendered
  // inside this form) without a listener per field.
  form.addEventListener("input", markDirty);
  form.addEventListener("change", markDirty);

  const selectTheme = (theme: CardTheme, customColor?: string): void => {
    themeInput.value = theme;
    // Only ever write a color into customColorInput here — switching to a
    // built-in theme must NOT clear it, or the custom slot's remembered
    // color is gone for good the moment you look at another theme, and
    // tapping back to it can only ever look "empty" again.
    if (theme === "custom" && customColor) customColorInput.value = customColor;
    applyCardFaceTheme(cardFaceEl(), theme, theme === "custom" ? customColorInput.value : undefined);
    document.querySelectorAll<HTMLButtonElement>("#theme-picker [data-theme-option]").forEach((btn) => {
      const isSelected = btn.getAttribute("data-theme-option") === theme;
      btn.setAttribute("data-selected", String(isSelected));
      btn.setAttribute("aria-pressed", String(isSelected));
    });
  };

  document.getElementById("theme-picker")!.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const btn = target.closest<HTMLElement>("[data-theme-option]");
    if (!btn) return;
    const theme = btn.getAttribute("data-theme-option") as CardTheme;
    if (theme === "custom") {
      const savedColor = customColorInput.value;
      if (target === customColorPicker) return;
      const isAlreadyCustom = themeInput.value === "custom";
      if (savedColor && isHexColor(savedColor) && !isAlreadyCustom) {
        // A color is already saved for this slot and some other theme is
        // currently active — just switch back to it, one tap, same as
        // the built-in swatches. Only open the picker below when there's
        // no color yet, or the user taps this slot again while it's
        // already the active theme (meaning they want to change it).
        markDirty();
        selectTheme("custom", savedColor);
        return;
      }
      customColorPicker.value = savedColor && isHexColor(savedColor) ? savedColor : "#8a8f98";
      // showPicker() is the API actually meant for this; .click() is the
      // fallback for browsers that don't have it yet. iOS opens the picker
      // through the real color input layered over the swatch, so this path is
      // mostly for keyboard/desktop activation of the label.
      if (typeof customColorPicker.showPicker === "function") customColorPicker.showPicker();
      else customColorPicker.click();
      return;
    }
    markDirty();
    selectTheme(theme);
  });

  customColorPicker.addEventListener("input", () => {
    const hex = customColorPicker.value;
    selectTheme("custom", hex);
    // The picked color also needs to show up on the swatch itself, not
    // just the live card preview — swap it from the dashed "+" empty state
    // (or its previous color) to the newly picked one.
    const customBtn = document.querySelector<HTMLButtonElement>('#theme-picker [data-theme-option="custom"]')!;
    const swatchColorEl = customBtn.querySelector<HTMLElement>(".theme-swatch-color")!;
    swatchColorEl.classList.remove("theme-swatch-color-empty");
    swatchColorEl.style.background = hex;
    swatchColorEl.textContent = "";
  });

  document.getElementById("editor-back-btn")!.addEventListener("click", () => {
    if (isNew) void renderStack();
    else renderDetail(existing!);
  });

  cancelBtn.addEventListener("click", () => {
    if (isNew) void renderStack();
    else renderDetail(existing!);
  });

  nameInput.addEventListener("input", () => {
    const el = cardNameEl();
    if (nameInput.value.trim()) {
      el.textContent = nameInput.value.trim();
      el.classList.remove("placeholder");
    } else {
      el.textContent = t("myCard");
      el.classList.add("placeholder");
    }
  });

  const updateRole = () => {
    const role = roleLine({
      title: (form.querySelector('[name="title"]') as HTMLInputElement).value.trim(),
      department: (form.querySelector('[name="department"]') as HTMLInputElement | null)?.value.trim(),
      org: (form.querySelector('[name="org"]') as HTMLInputElement).value.trim(),
    });
    cardRoleEl().textContent = role || " ";
  };
  const updateTagline = () => {
    const taglineEl = stage.querySelector(".card-tagline") as HTMLElement | null;
    const tagline = (form.querySelector('[name="tagline"]') as HTMLInputElement).value.trim();
    if (taglineEl) {
      taglineEl.textContent = tagline;
      taglineEl.className = taglineClass(tagline);
      if (!tagline) taglineEl.remove();
      return;
    }
    if (!tagline) return;
    stage.querySelector(".card-body")!.insertAdjacentHTML("afterend", `<div class="${taglineClass(tagline)}">${esc(tagline)}</div>`);
  };
  form.querySelector('[name="title"]')!.addEventListener("input", updateRole);
  form.querySelector('[name="org"]')!.addEventListener("input", updateRole);
  form.querySelector('[name="tagline"]')!.addEventListener("input", updateTagline);
  form.addEventListener("input", (e) => {
    const target = e.target as HTMLElement;
    if (target.matches('[name="department"]')) updateRole();
  });
  form.addEventListener("change", (e) => {
    const target = e.target as HTMLElement;
    if (!target.matches("[data-contact-label]")) return;
    const row = target.closest("[data-contact-row]");
    const input = row?.querySelector<HTMLInputElement>("[data-contact-value]");
    if (input) input.placeholder = socialValuePlaceholder((target as HTMLSelectElement).value);
  });

  form.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.id === "optional-field-menu-btn") {
      const menu = document.getElementById("optional-field-menu") as HTMLElement | null;
      if (!menu) return;
      menu.hidden = !menu.hidden;
      if (!menu.hidden) positionOptionalFieldMenu(menu, target);
      return;
    }
    const optionalFieldBtn = target.closest<HTMLButtonElement>("[data-add-optional-field]");
    if (optionalFieldBtn) {
      const kind = optionalFieldBtn.getAttribute("data-add-optional-field") as OptionalContactField;
      markDirty();
      form.querySelector("#optional-field-list")!.insertAdjacentHTML("beforeend", optionalContactFieldHtml(kind));
      optionalFieldBtn.remove();
      if (!form.querySelector("[data-add-optional-field]")) document.getElementById("optional-field-add-block")?.remove();
      else document.getElementById("optional-field-menu")?.setAttribute("hidden", "");
      if (kind === "department") updateRole();
      return;
    }
    if (target.hasAttribute("data-remove-contact-value")) {
      const list = target.closest(".field")!;
      const rows = list.querySelectorAll("[data-contact-row]");
      if (rows.length > 1) {
        markDirty();
        target.closest("[data-contact-row]")!.remove();
      }
      return;
    }
    const addButton = target.closest<HTMLButtonElement>("[data-add-contact-value]");
    if (addButton) {
      const kind = addButton.getAttribute("data-add-contact-value") as "phone" | "email" | "address" | "url";
      markDirty();
      form.querySelector(`#${kind}-list`)!.insertAdjacentHTML("beforeend", contactValueRowHtml(kind));
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const collected = collectFormData(form);
    if (!collected.contact.fn) return;
    const mine = await loadMine();
    const updatedAt = new Date().toISOString();
    let saved: MineCard;
    if (!isNew && existing!.id) {
      saved = { ...collected, id: existing!.id, updatedAt, ...(existing!.assets ? { assets: existing!.assets } : {}) };
      const idx = mine.findIndex((c) => c.id === saved.id);
      if (idx >= 0) mine[idx] = saved;
      else mine.push(saved);
    } else {
      saved = { ...collected, id: crypto.randomUUID(), updatedAt };
      mine.push(saved);
    }
    await saveMine(mine);
    storeActiveMineId(saved.id);
    scheduleCardSyncPush();
    renderDetail(saved);
  });

  if (canDelete) {
    document.getElementById("delete-card-btn")!.addEventListener("click", async () => {
      await deleteMineCard(existing!.id);
      clearActiveMineId();
      scheduleCardSyncPush();
      void renderStack();
    });
  }
}

/* ============ detail (a single Mine card, full view) ============ */

export function renderDetail(data: MineCard): void {
  currentView = { kind: "mine-detail", id: data.id };
  storeActiveMineId(data.id);
  stage.innerHTML = `
    <div class="top-bar top-bar-back top-bar-split">
      <div class="top-bar-left">
        <button type="button" class="icon-btn" id="detail-back-btn" aria-label="${esc(t("backToYourCards"))}">&lsaquo;</button>
      </div>
      <div class="top-bar-actions" id="detail-top-actions"></div>
    </div>
    <div class="card-flip" id="card-flip">${cardFaceHtml(data)}</div>
    <div class="btn-row" id="detail-actions">
      <button class="btn btn-secondary" id="edit-btn">${esc(t("edit"))}</button>
      <button class="btn btn-primary" id="share-btn">${esc(t("share"))}</button>
    </div>
    <div id="detail-info">${contactSheetHtml(data)}</div>
    <div class="footer-mark" id="detail-footer">${esc(t("onlyYouCanEditOrShare"))}</div>
  `;

  const flip = document.getElementById("card-flip") as HTMLElement;
  const infoEl = document.getElementById("detail-info") as HTMLElement;
  const actionsRow = document.getElementById("detail-actions") as HTMLElement;
  const topActionsEl = document.getElementById("detail-top-actions") as HTMLElement;
  const footerEl = document.getElementById("detail-footer") as HTMLElement;
  // Local to this render — sharing state doesn't need to survive a
  // re-render, and both other exits below (back, edit) leave Detail
  // entirely anyway, so there's nothing to restore it from.
  let sharing = false;
  let shareUrl: string | undefined;

  // Swap-at-90°: fade+rotate the wrapper out, swap its innerHTML at the
  // midpoint, then animate back in — see style.css's .card-flip rules.
  const flipTo = (html: string, onSwap?: () => void): void => {
    flip.classList.add("card-flip-out");
    window.setTimeout(() => {
      flip.innerHTML = html;
      onSwap?.();
      flip.classList.remove("card-flip-out");
      flip.classList.add("card-flip-in");
      window.setTimeout(() => flip.classList.remove("card-flip-in"), 260);
    }, 150);
  };

  const getShareUrl = async (): Promise<string> => {
    if (shareUrl) return shareUrl;
    const fragment = await encodeCardFragment(data);
    shareUrl = `${location.origin}${location.pathname}#${fragment}`;
    return shareUrl;
  };

  const showFront = (): void => {
    flipTo(cardFaceHtml(data));
    infoEl.innerHTML = contactSheetHtml(data);
    footerEl.textContent = t("onlyYouCanEditOrShare");
  };

  const showBack = async (): Promise<string> => {
    const url = await getShareUrl();
    flipTo(shareBackHtml(url, data.profile?.theme || "beige", data.profile?.customColor, data.contact.fn), () => wireShareBack(flip));
    return url;
  };

  const showShareDetails = (url: string): void => {
    infoEl.innerHTML = shareActionsHtml();
    wireShareActions(infoEl, url);
    footerEl.innerHTML = `${esc(t("shareServerPrivacyNote"))} <button type="button" class="privacy-info-btn" id="privacy-info-btn" aria-label="${esc(t("privacyInfoAriaLabel"))}">i</button>`;
    document.getElementById("privacy-info-btn")!.addEventListener("click", () => {
      if (sharing) history.replaceState(null, "", location.pathname);
      renderPrivacyPage();
    });
  };

  const exitShare = (): void => {
    // Always replaceState (never history.back()) — this app has no
    // general in-app back-stack, and main.ts's hashchange listener
    // re-runs initApp() on any real history navigation, which would blow
    // away the flip-back animation below and jump straight to the card
    // stack instead of just returning to this Detail view.
    history.replaceState(null, "", location.pathname);
    showFront();
    actionsRow.hidden = false;
    topActionsEl.innerHTML = "";
    sharing = false;
  };

  const enterShare = async (): Promise<void> => {
    if (sharing) return;
    const url = await showBack();
    // Visible address bar = the share link, so the browser's own native
    // share/forward affordance (offered below as a fallback) actually
    // shares the right thing. pushState, not a real navigation, so it
    // doesn't fire hashchange/reload the app.
    history.pushState({ mycardShare: true }, "", url);

    showShareDetails(url);
    actionsRow.hidden = true;
    topActionsEl.innerHTML = `<button type="button" class="top-bar-done-btn" id="share-done-btn">${esc(t("done"))}</button>`;
    document.getElementById("share-done-btn")!.addEventListener("click", exitShare);
    sharing = true;
  };

  flip.addEventListener("click", () => {
    if (sharing) {
      exitShare();
      return;
    }
    void enterShare();
  });

  document.getElementById("detail-back-btn")!.addEventListener("click", () => {
    if (sharing) history.replaceState(null, "", location.pathname);
    void renderStack();
  });
  document.getElementById("edit-btn")!.addEventListener("click", () => {
    if (sharing) history.replaceState(null, "", location.pathname);
    void renderEditor(data);
  });
  document.getElementById("share-btn")!.addEventListener("click", () => void enterShare());
}

/* ============ stack (home) — Mine cards, Wallet-style cascade ============ */

let onboardingDismissedThisPageLoad = false;
let stackRenderSeq = 0;

function stackHeaderHtml(): string {
  return `
    <div class="stack-header">
      <span class="stack-title">${esc(t("myCard"))}</span>
      <div class="stack-header-actions">
        <button type="button" class="icon-btn" id="received-entry-btn" aria-label="${esc(t("receivedCards"))}"><span class="wallet-icon" aria-hidden="true"></span></button>
        <button type="button" class="icon-btn" id="more-menu-btn" aria-label="${esc(t("more"))}">&bull;&bull;&bull;</button>
      </div>
    </div>
  `;
}

function wireStackHeader(): void {
  document.getElementById("received-entry-btn")!.addEventListener("click", () => void renderReceivedPage());
  document.getElementById("more-menu-btn")!.addEventListener("click", () => openMoreMenu());
}

function homeInstallHintKey(): "homeInstallHint" | "homeInstallHintiOS" | "homeInstallHintMacSafari" {
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isIos) return "homeInstallHintiOS";

  const isSafari = /Safari/i.test(ua) && !/Chrome|CriOS|Edg|FxiOS/i.test(ua);
  if (isSafari && /Macintosh|Mac OS X/i.test(ua)) return "homeInstallHintMacSafari";

  return "homeInstallHint";
}

// No more "redirect straight into the editor when there are no cards yet" —
// that skipped the home screen entirely on a brand-new install, left the
// first-ever editor with no way back (see canGoBack's old gating), and made
// "Make your own Card" (a plain link to the bare path) land on a blank form
// instead of the home screen it actually points at. An empty home screen
// with its own "create your card" CTA fixes all three at once.
export async function renderStack(): Promise<void> {
  const seq = ++stackRenderSeq;
  currentView = { kind: "mine-stack" };
  stage.innerHTML = `
    ${stackHeaderHtml()}
    <div class="stack-loading-placeholder" aria-hidden="true"></div>
  `;
  wireStackHeader();

  const mine = await loadMine();
  if (seq !== stackRenderSeq || currentView.kind !== "mine-stack") return;

  const homeHintHtml = mine.length
    ? `<p class="home-guidance">${esc(t(homeInstallHintKey()))}</p>`
    : `<p class="home-guidance">${esc(t("homeSyncHint"))} <button type="button" class="inline-link-btn" id="home-sync-tip-btn">${esc(t("syncSettings"))}</button></p>`;

  const bodyHtml = mine.length
    ? (() => {
        // Move the last-opened card to the end of the stack so it lands
        // fully visible at the front (Wallet convention: front card = most
        // recently used); every other card collapses to a top sliver via
        // the `.stack-item + .stack-item` cascade rule.
        const ordered = [...mine];
        const activeIdx = ordered.findIndex((c) => c.id === loadActiveMineId());
        if (activeIdx > -1) ordered.push(...ordered.splice(activeIdx, 1));

        const cardsHtml = ordered
          .map((c, idx) => {
            const isFront = idx === ordered.length - 1;
            return `
              <button type="button" class="stack-item" data-open-mine="${esc(c.id)}">
                ${cardFaceHtml(c, isFront ? {} : { cornerLabel: stackCornerLabel(c) })}
              </button>
            `;
          })
          .join("");

        return `
          <div class="stack-list">${cardsHtml}</div>
          <button type="button" class="add-card-tile" id="stack-new-card-btn" aria-label="${esc(t("newCard"))}">+</button>
        `;
      })()
    : `
        <button type="button" class="empty-card-placeholder" id="stack-new-card-placeholder">
          <span class="empty-card-plus" aria-hidden="true">+</span>
          <span>${esc(t("newCard"))}</span>
        </button>
        <button type="button" class="btn btn-primary btn-block" id="stack-new-card-btn">${esc(t("createYourCard"))}</button>
      `;

  stage.innerHTML = `
    ${stackHeaderHtml()}
    ${bodyHtml}
    ${homeHintHtml}
  `;
  stage.querySelectorAll<HTMLButtonElement>("[data-open-mine]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = mine.find((c) => c.id === btn.getAttribute("data-open-mine"));
      if (card) renderDetail(card);
    });
  });
  document.getElementById("stack-new-card-btn")!.addEventListener("click", () => void renderEditor(null));
  document.getElementById("stack-new-card-placeholder")?.addEventListener("click", () => void renderEditor(null));
  document.getElementById("home-sync-tip-btn")?.addEventListener("click", () => void renderSyncPage());
  wireStackHeader();

  if (!hasSeenOnboarding() && !onboardingDismissedThisPageLoad) showOnboarding();
}

// First-run overlay — a 1/2/3 walkthrough plus a privacy line. It shows at
// most once per page load unless the user explicitly opts out forever via
// the checkbox; dismissing without that checkbox hides it only for this
// in-memory session, so a future refresh can show it again.
function showOnboarding(): void {
  stage.insertAdjacentHTML(
    "beforeend",
    `
      <div class="onboarding-overlay" id="onboarding-overlay">
        <div class="onboarding-panel">
          <h2>${esc(t("onboardingTitle"))}</h2>
          <ol class="onboarding-steps">
            <li>${esc(t("onboardingStep1"))}</li>
            <li>${esc(t("onboardingStep2"))}</li>
            <li>${esc(t("onboardingStep3"))}</li>
          </ol>
          <p class="onboarding-privacy">${esc(t("onboardingPrivacy"))}</p>
          <label class="onboarding-dont-show">
            <input type="checkbox" id="onboarding-dont-show-checkbox" />
            ${esc(t("onboardingDontShowAgain"))}
          </label>
          <button type="button" class="btn btn-primary btn-block" id="onboarding-got-it-btn">${esc(t("onboardingGotIt"))}</button>
        </div>
      </div>
    `,
  );
  document.getElementById("onboarding-got-it-btn")!.addEventListener("click", () => {
    const dontShowAgain = (document.getElementById("onboarding-dont-show-checkbox") as HTMLInputElement).checked;
    onboardingDismissedThisPageLoad = true;
    if (dontShowAgain) markOnboardingSeen();
    document.getElementById("onboarding-overlay")?.remove();
  });
}

/* ============ recipient (a decrypted shared card) ============ */

function isInAppBrowser(ua: string): boolean {
  return /MicroMessenger|QQ\/|Weibo|DingTalk|Line\/|FBAN|FBAV|Instagram|TikTok|musical_ly|Douyin|; ?wv\)/i.test(ua || "");
}

function scrollToTop(): void {
  window.scrollTo({ top: 0, left: 0 });
}

function vcardFilename(data: CardData): string {
  const safe = (data.contact.fn || "card").trim().replace(/[^\w.-]+/g, "_") || "card";
  return `${safe}.vcf`;
}

function downloadBlob(bytes: BlobPart, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadTextFile(text: string, filename: string, type: string): void {
  downloadBlob(text, filename, type);
}

function vcardBlobUrl(data: CardData): string {
  return URL.createObjectURL(new Blob([buildVCard(data)], { type: "text/vcard;charset=utf-8" }));
}

function vcardFile(data: CardData): File {
  return new File([buildVCard(data)], vcardFilename(data), { type: "text/vcard;charset=utf-8" });
}

function canOpenVCardWithApps(data: CardData): boolean {
  if (!navigator.canShare) return false;
  try {
    return navigator.canShare({ files: [vcardFile(data)] });
  } catch {
    return false;
  }
}

async function openVCardWithApps(data: CardData): Promise<void> {
  if (!navigator.share) return;
  try {
    await navigator.share({ files: [vcardFile(data)] });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    showToast(t("openVCardFailed"));
  }
}

function vcardActionsHtml(data: CardData, prefix: string): string {
  const canOpen = canOpenVCardWithApps(data);
  const filename = vcardFilename(data);
  const openButton = canOpen
    ? `<button class="btn btn-secondary" id="${prefix}-open-vcard-btn" type="button">${esc(t("openWithApps"))}</button>`
    : "";
  return `
    <div class="vcard-actions${canOpen ? " btn-row" : ""}">
      <a class="btn btn-primary${canOpen ? "" : " btn-block"}" id="${prefix}-download-vcard-link" href="#" download="${esc(filename)}" type="text/vcard">${esc(t("downloadVCard"))}</a>
      ${openButton}
    </div>
  `;
}

function wireVCardDownloadLink(data: CardData, prefix: string): void {
  document.getElementById(`${prefix}-download-vcard-link`)?.addEventListener("click", (event) => {
    const link = event.currentTarget as HTMLAnchorElement;
    if (link.href.startsWith("blob:")) return;
    const url = vcardBlobUrl(data);
    link.href = url;
    window.setTimeout(() => {
      if (link.href === url) link.href = "#";
      URL.revokeObjectURL(url);
    }, 60_000);
  });
}

function recipientLocalNavHtml(ownCardLabel: string): string {
  return `
    <div class="btn-row recipient-local-nav">
      <button type="button" class="btn btn-secondary" id="recipient-home-btn">${esc(ownCardLabel)}</button>
      <button type="button" class="btn btn-secondary" id="recipient-received-btn">${esc(t("receivedCards"))}</button>
    </div>
  `;
}

function goToStackRoot(): void {
  history.replaceState(null, "", location.pathname);
  void renderStack();
}

function goToReceivedRoot(): void {
  history.replaceState(null, "", location.pathname);
  void renderReceivedPage();
}

export interface RecipientOpts {
  onBack?: () => void;
  entryId?: string;
}

export async function renderRecipient(data: CardData, opts: RecipientOpts = {}): Promise<void> {
  currentView = opts.entryId ? { kind: "received-detail", id: opts.entryId } : { kind: "other" };
  scrollToTop();
  const inApp = isInAppBrowser(navigator.userAgent);
  const hasOwnCard = (await loadMine()).length > 0;
  const ownCardLabel = hasOwnCard ? t("myCardAction") : t("createMyCard");
  const canOpen = canOpenVCardWithApps(data);
  const saveActionHtml = inApp
    ? `
      <div class="save-fallback">
        <p>${esc(t("inAppBrowserWarning"))}</p>
        <button class="btn btn-secondary btn-block" id="copy-link-btn" type="button">${esc(t("copyLink"))}</button>
      </div>
    `
    : vcardActionsHtml(data, "recipient");

  stage.innerHTML = `
    <div class="top-bar top-bar-back top-bar-split">
      <div class="top-bar-left">
        ${opts.onBack ? `<button type="button" class="icon-btn" id="recipient-back-btn" aria-label="${esc(t("back"))}">&lsaquo;</button>` : ""}
      </div>
      <div class="top-bar-actions">
        <button type="button" class="icon-btn" id="recipient-more-menu-btn" aria-label="${esc(t("more"))}">&bull;&bull;&bull;</button>
      </div>
    </div>
    ${cardFaceHtml(data)}
    ${contactSheetHtml(data)}
    ${saveActionHtml}
    ${opts.entryId ? `<button type="button" class="form-delete-btn" id="recipient-delete-btn">${esc(t("deleteThisCard"))}</button>` : ""}
    ${opts.onBack ? "" : recipientLocalNavHtml(ownCardLabel)}
    <div class="footer-mark">${esc(t("poweredBy"))} <a href="https://myfield.one" target="_blank" rel="noopener">MyField</a></div>
  `;

  if (opts.onBack) {
    document.getElementById("recipient-back-btn")!.addEventListener("click", opts.onBack);
  } else {
    document.getElementById("recipient-home-btn")!.addEventListener("click", goToStackRoot);
    document.getElementById("recipient-received-btn")!.addEventListener("click", goToReceivedRoot);
  }

  document.getElementById("recipient-more-menu-btn")!.addEventListener("click", () => {
    openRecipientMoreMenu(data, { canOpen, inApp, ownCardLabel });
  });

  document.getElementById("recipient-delete-btn")?.addEventListener("click", async () => {
    if (!opts.entryId) return;
    invalidateReceivedPageSnapshot();
    await deleteReceivedEntry(opts.entryId);
    scheduleCardSyncPush();
    showToast(t("deleted"));
    void renderReceivedPage();
  });

  if (inApp) {
    document.getElementById("copy-link-btn")!.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        showToast(t("linkCopiedOpenInBrowser"));
      } catch {
        showToast(t("couldNotCopyLink"));
      }
    });
    return;
  }

  wireVCardDownloadLink(data, "recipient");
  document.getElementById("recipient-open-vcard-btn")?.addEventListener("click", () => void openVCardWithApps(data));
}

export async function renderError(): Promise<void> {
  currentView = { kind: "other" };
  const hasOwnCard = (await loadMine()).length > 0;
  const hasReceivedCards = (await loadReceived()).length > 0;
  const ownCardLabel = hasOwnCard ? t("myCardAction") : t("createMyCard");
  stage.innerHTML = `
    <div class="error-panel">
      <h1>${esc(t("linkUnreadableTitle"))}</h1>
      <p>${esc(t("linkUnreadableBody"))}</p>
      <p>${esc(t("linkRecoveryHint"))}</p>
      <div class="btn-row">
        <button type="button" class="btn btn-primary" id="error-home-btn">${esc(ownCardLabel)}</button>
        ${hasReceivedCards ? `<button type="button" class="btn btn-secondary" id="error-received-btn">${esc(t("receivedCards"))}</button>` : ""}
      </div>
    </div>
    <div class="footer-mark">${esc(t("poweredBy"))} <a href="https://myfield.one" target="_blank" rel="noopener">MyField</a></div>
  `;
  document.getElementById("error-home-btn")!.addEventListener("click", goToStackRoot);
  document.getElementById("error-received-btn")?.addEventListener("click", goToReceivedRoot);
}

/* ============ "more" dropdown menu (anchored, not a sheet) ============ */

function closeMoreMenu(): void {
  const el = document.getElementById("more-dropdown");
  if (el) el.remove();
  document.removeEventListener("click", onMoreMenuOutsideClick);
  document.removeEventListener("keydown", onMoreMenuKeydown);
}

function onMoreMenuOutsideClick(e: MouseEvent): void {
  const menu = document.getElementById("more-dropdown");
  const target = e.target as HTMLElement;
  if (menu && !menu.contains(target) && target.id !== "more-menu-btn" && target.id !== "recipient-more-menu-btn") closeMoreMenu();
}

function onMoreMenuKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") closeMoreMenu();
}

function openMoreMenu(): void {
  if (document.getElementById("more-dropdown")) {
    closeMoreMenu();
    return;
  }
  const anchor = document.getElementById("more-menu-btn")!.parentElement!;
  const menu = document.createElement("div");
  menu.className = "dropdown-menu";
  menu.id = "more-dropdown";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    <button type="button" role="menuitem" id="menu-settings-btn">${esc(t("settings"))}</button>
  `;
  anchor.appendChild(menu);
  menu.querySelector("#menu-settings-btn")!.addEventListener("click", () => {
    closeMoreMenu();
    renderSettingsPage();
  });
  // deferred so the click that opened the menu doesn't immediately close it
  setTimeout(() => document.addEventListener("click", onMoreMenuOutsideClick), 0);
  document.addEventListener("keydown", onMoreMenuKeydown);
}

function openRecipientMoreMenu(data: CardData, opts: { canOpen: boolean; inApp: boolean; ownCardLabel: string }): void {
  if (document.getElementById("more-dropdown")) {
    closeMoreMenu();
    return;
  }
  const anchor = document.getElementById("recipient-more-menu-btn")!.parentElement!;
  const filename = vcardFilename(data);
  const saveItems = opts.inApp
    ? ""
    : `
      <a role="menuitem" id="recipient-menu-download-vcard-link" href="#" download="${esc(filename)}" type="text/vcard">${esc(t("downloadVCard"))}</a>
      ${opts.canOpen ? `<button type="button" role="menuitem" id="recipient-menu-open-vcard-btn">${esc(t("openWithApps"))}</button>` : ""}
    `;
  const menu = document.createElement("div");
  menu.className = "dropdown-menu";
  menu.id = "more-dropdown";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    ${saveItems}
    <button type="button" role="menuitem" id="recipient-menu-home-btn">${esc(opts.ownCardLabel)}</button>
    <button type="button" role="menuitem" id="recipient-menu-received-btn">${esc(t("receivedCards"))}</button>
  `;
  anchor.appendChild(menu);
  if (!opts.inApp) wireVCardDownloadLink(data, "recipient-menu");
  menu.querySelector("#recipient-menu-open-vcard-btn")?.addEventListener("click", () => {
    closeMoreMenu();
    void openVCardWithApps(data);
  });
  menu.querySelector("#recipient-menu-home-btn")!.addEventListener("click", () => {
    closeMoreMenu();
    goToStackRoot();
  });
  menu.querySelector("#recipient-menu-received-btn")!.addEventListener("click", () => {
    closeMoreMenu();
    goToReceivedRoot();
  });
  setTimeout(() => document.addEventListener("click", onMoreMenuOutsideClick), 0);
  document.addEventListener("keydown", onMoreMenuKeydown);
}

/* ============ photo cards: stored as a "photo" kind received entry, no
   recognition/parsing attempted ============
   What's saved is the original capture, untouched — no resizing, cropping,
   or recompression. Fitting it into the card frame (contain, no crop) is
   purely a display-time concern (see .photo-card-face img's object-fit),
   not something baked into the stored bytes. A separate, faster-loading
   preview/thumbnail for the stack view is a distinct optimization to
   consider later if original-resolution photos turn out to be slow to
   render there — it would sit alongside the original, not replace it. */

function readOriginalPhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error || new Error("could not read photo"));
    reader.readAsDataURL(file);
  });
}

function createPhotoThumbnail(imageDataUrl: string, maxWidth = 720): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.naturalWidth);
      const width = Math.max(1, Math.round(img.naturalWidth * scale));
      const height = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Could not create thumbnail"));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.78));
    };
    img.onerror = () => reject(new Error("Could not decode thumbnail source"));
    img.src = imageDataUrl;
  });
}

let receivedPageSnapshot: { nodes: Node[]; scrollY: number; received: ReceivedEntry[] } | null = null;

function captureReceivedPageSnapshot(received: ReceivedEntry[]): void {
  if (!document.getElementById("layout-toggle-btn")) return;
  receivedPageSnapshot = {
    nodes: Array.from(stage.childNodes),
    scrollY: window.scrollY,
    received,
  };
}

function invalidateReceivedPageSnapshot(): void {
  receivedPageSnapshot = null;
}

function restoreReceivedPageSnapshot(): boolean {
  if (!receivedPageSnapshot) return false;
  const snapshot = receivedPageSnapshot;
  receivedPageSnapshot = null;
  window.scrollTo({ top: snapshot.scrollY, left: 0 });
  stage.replaceChildren(...snapshot.nodes);
  window.scrollTo({ top: snapshot.scrollY, left: 0 });
  void hydrateReceivedPhotoFaces(snapshot.received);
  return true;
}

function restoreOrRenderReceivedPage(): void {
  if (!restoreReceivedPageSnapshot()) void renderReceivedPage();
}

/* ============ Received Cards page (full page, same visual language as
   the Mine stack). Two layouts: the default cascade (most-recently-received
   card in front) or a flat 2-column grid — a plain device-local display
   preference. ============ */

export async function renderReceivedPage(): Promise<void> {
  currentView = { kind: "received-list" };
  invalidateReceivedPageSnapshot();
  const received = (await loadReceived()).slice().sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt));
  const layout = loadReceivedLayout();
  const listClass = layout === "grid" ? "stack-list grid-layout" : "stack-list";
  const body = received.length
    ? `<div class="${listClass}">${received
        .map((r, idx) => {
          const isFront = layout === "grid" || idx === received.length - 1;
          return `
            <button type="button" class="stack-item" data-open-received="${esc(r.id)}">
              ${receivedEntryInitialFaceHtml(r, isFront)}
            </button>
          `;
        })
        .join("")}</div>`
    : `<p class="list-empty">${esc(t("noCardsReceivedYet"))}</p>`;

  stage.innerHTML = `
    <div class="top-bar top-bar-back top-bar-split">
      <div class="top-bar-left">
        <button type="button" class="icon-btn" id="received-back-btn" aria-label="${esc(t("back"))}">&lsaquo;</button>
        <span class="top-bar-title">${esc(t("receivedCards"))}</span>
      </div>
      <div class="top-bar-actions">
        <button type="button" class="icon-btn" id="add-photo-card-btn" aria-label="${esc(t("addPhotoCard"))}"><span class="camera-icon" aria-hidden="true"></span></button>
        <button type="button" class="icon-btn" id="layout-toggle-btn" aria-label="${esc(t("toggleLayout"))}"><span class="grid-icon" aria-hidden="true"><span></span><span></span><span></span><span></span></span></button>
      </div>
    </div>
    <input type="file" accept="image/*" capture="environment" id="photo-input" hidden />
    ${body}
  `;
  document.getElementById("received-back-btn")!.addEventListener("click", () => void renderStack());
  document.getElementById("add-photo-card-btn")!.addEventListener("click", () => {
    document.getElementById("photo-input")!.click();
  });
  document.getElementById("photo-input")!.addEventListener("change", async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readOriginalPhoto(file);
      const previewDataUrl = await createPhotoThumbnail(dataUrl).catch(() => undefined);
      const id = await addReceivedPhoto(dataUrl, previewDataUrl);
      scheduleCardSyncPush();
      showToast(t("photoSaved"));
      const entry = (await loadReceived()).find((item) => item.id === id);
      if (entry) void renderPhotoEdit(entry);
    } catch {
      showToast(t("couldNotReadPhoto"));
    }
  });
  document.getElementById("layout-toggle-btn")!.addEventListener("click", () => {
    const listEl = stage.querySelector<HTMLElement>(".stack-list");
    const nextLayout = listEl?.classList.contains("grid-layout") ? "stack" : "grid";
    storeReceivedLayout(nextLayout);
    listEl?.classList.toggle("grid-layout", nextLayout === "grid");
  });
  stage.querySelectorAll<HTMLButtonElement>("[data-open-received]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const entry = received.find((r) => r.id === btn.getAttribute("data-open-received"));
      if (!entry) return;
      captureReceivedPageSnapshot(received);
      if (cardPhotoAsset(entry.data)) void renderPhotoDetail(entry);
      else void renderRecipient(entry.data, { onBack: restoreOrRenderReceivedPage, entryId: entry.id });
    });
  });
  void hydrateReceivedPhotoFaces(received);
  void ensureReceivedPhotoPreviews(received);
}

function receivedEntryInitialFaceHtml(entry: ReceivedEntry, isFront: boolean): string {
  if (cardPhotoAsset(entry.data)) {
    return cardFaceHtml(entry.data, isFront ? {} : { cornerLabel: stackCornerLabel(entry.data) });
  }
  return receivedEntryFaceHtml(entry, isFront);
}

async function hydrateReceivedPhotoFaces(received: ReceivedEntry[]): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  for (let idx = 0; idx < received.length; idx += 1) {
    const entry = received[idx]!;
    const cardPhoto = cardPhotoAsset(entry.data);
    const imageDataUrl = cardPhoto?.previewDataUrl || cardPhoto?.dataUrl;
    if (!cardPhoto || !imageDataUrl) continue;
    const button = stage.querySelector<HTMLButtonElement>(`[data-open-received="${CSS.escape(entry.id)}"]`);
    if (!button) return;
    if (button.querySelector(".photo-card-face img")) continue;
    button.innerHTML = photoCardHtml(imageDataUrl, cardPhoto.transform);
  }
}

async function ensureReceivedPhotoPreviews(received: ReceivedEntry[]): Promise<void> {
  let changed = false;
  for (const entry of received) {
    const cardPhoto = cardPhotoAsset(entry.data);
    if (!cardPhoto || cardPhoto.previewDataUrl || cardPhoto.dataUrl || !cardPhoto.sourceRef) continue;
    const original = await loadCardAssetDataUrl(cardPhoto);
    if (!original) continue;
    const preview = await createPhotoThumbnail(original).catch(() => undefined);
    if (!preview) continue;
    changed = (await saveCardAssetPreview(entry.id, cardPhoto.id, preview)) || changed;
  }
  if (changed) invalidateReceivedPageSnapshot();
  if (changed && document.getElementById("layout-toggle-btn")) void renderReceivedPage();
}

const FIELD_TYPES: FieldType[] = ["name", "title", "department", "company", "phone", "email", "address", "social", "note", "other"];
const CONTACT_VALUE_TYPES = new Set<ContactValueType>(["work", "home", "mobile", "main", "other"]);
const CARD_SYNC_PUSH_DEBOUNCE_MS = 1000;
const CARD_SYNC_PUSH_MAX_WAIT_MS = 5000;
const CARD_SYNC_RECOVERY_COOLDOWN_MS = 15_000;
let cardSyncController: ReturnType<typeof createCardSyncController> | null = null;
let cardSyncHintsStarted = false;
let cardSyncPushDebounceTimer: number | null = null;
let cardSyncPushMaxWaitTimer: number | null = null;
let cardSyncPushing = false;
let cardSyncPushPending = false;
let cardSyncPushRequested = false;
let cardSyncBootstrapPromise: Promise<void> | null = null;
let cardSyncRecoveryListenersStarted = false;
let lastCardSyncRecoveryAt = 0;

async function refreshCurrentViewAfterSync(): Promise<void> {
  invalidateReceivedPageSnapshot();
  const view = currentView;
  if (view.kind === "mine-stack") {
    await renderStack();
    return;
  }
  if (view.kind === "mine-detail") {
    const card = (await loadMine()).find((item) => item.id === view.id);
    if (card) renderDetail(card);
    else await renderStack();
    return;
  }
  if (view.kind === "received-list") {
    await renderReceivedPage();
    return;
  }
  if (view.kind === "received-detail" || view.kind === "photo-detail") {
    const entry = (await loadReceived()).find((item) => item.id === view.id);
    if (!entry) {
      await renderReceivedPage();
      return;
    }
    if (cardPhotoAsset(entry.data)) await renderPhotoDetail(entry);
    else await renderRecipient(entry.data, { onBack: restoreOrRenderReceivedPage, entryId: entry.id });
  }
}

function clearCardSyncPushTimers(): void {
  if (cardSyncPushDebounceTimer != null) {
    window.clearTimeout(cardSyncPushDebounceTimer);
    cardSyncPushDebounceTimer = null;
  }
  if (cardSyncPushMaxWaitTimer != null) {
    window.clearTimeout(cardSyncPushMaxWaitTimer);
    cardSyncPushMaxWaitTimer = null;
  }
}

function startCardSyncHints(): void {
  if (!cardSyncController || cardSyncHintsStarted) return;
  cardSyncHintsStarted = true;
  cardSyncController.startRemoteHints(() => {
    void runCardSyncNow();
  }, (error) => {
    console.warn("[sync] feed stream error", error);
    cardSyncHintsStarted = false;
  });
}

async function resetCardSyncAuthorization(): Promise<void> {
  clearCardSyncPushTimers();
  cardSyncPushPending = false;
  cardSyncController?.dispose();
  cardSyncController = null;
  cardSyncHintsStarted = false;
  await clearCardSyncAuthorization();
}

async function bootstrapCardSync(): Promise<void> {
  if (cardSyncController) {
    startCardSyncHints();
    return;
  }
  if (!cardSyncBootstrapPromise) {
    cardSyncBootstrapPromise = (async () => {
      try {
        cardSyncController = await connectCardSync();
        startCardSyncHints();
      } catch (error) {
        // Existing sync context can expire or be cleared server-side. Startup
        // should stay local-first and let the Sync settings page re-authorize.
        console.warn("[sync] could not connect from existing context", error);
        cardSyncController = null;
        cardSyncHintsStarted = false;
      } finally {
        cardSyncBootstrapPromise = null;
      }
    })();
  }
  await cardSyncBootstrapPromise;
}

function scheduleCardSyncPush(): void {
  cardSyncPushRequested = true;
  if (!cardSyncController) {
    startBackgroundCardSync();
    return;
  }
  if (cardSyncPushDebounceTimer != null) window.clearTimeout(cardSyncPushDebounceTimer);
  cardSyncPushDebounceTimer = window.setTimeout(() => {
    void runCardSyncNow();
  }, CARD_SYNC_PUSH_DEBOUNCE_MS);
  if (cardSyncPushMaxWaitTimer == null) {
    cardSyncPushMaxWaitTimer = window.setTimeout(() => {
      void runCardSyncNow();
    }, CARD_SYNC_PUSH_MAX_WAIT_MS);
  }
}

async function runCardSyncNow(): Promise<void> {
  clearCardSyncPushTimers();
  if (cardSyncPushing) {
    cardSyncPushPending = true;
    return;
  }
  if (!cardSyncController) {
    startBackgroundCardSync();
    return;
  }
  cardSyncPushing = true;
  cardSyncPushRequested = false;
  try {
    const result = await cardSyncController.syncNow();
    if (result.status.lastError) console.warn("[sync] sync failed", result.status.lastError);
    if (result.changed) await refreshCurrentViewAfterSync();
  } catch (error) {
    console.error("[sync] unexpected sync failure", error);
  } finally {
    cardSyncPushing = false;
    if (cardSyncPushPending || cardSyncPushRequested) {
      cardSyncPushPending = false;
      scheduleCardSyncPush();
    }
  }
}

function startBackgroundCardSync(): void {
  void (async () => {
    await bootstrapCardSync();
    if (cardSyncController) await runCardSyncNow();
  })();
}

function startCardSyncRecovery(): void {
  const now = Date.now();
  if (now - lastCardSyncRecoveryAt < CARD_SYNC_RECOVERY_COOLDOWN_MS) return;
  lastCardSyncRecoveryAt = now;
  startBackgroundCardSync();
}

function startCardSyncRecoveryListeners(): void {
  if (cardSyncRecoveryListenersStarted) return;
  cardSyncRecoveryListenersStarted = true;
  window.addEventListener("online", startCardSyncRecovery);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") startCardSyncRecovery();
  });
}

function fieldTypeLabel(type: FieldType): string {
  if (type === "other") return t("other");
  return t(type);
}

function fieldMetadata(row: HTMLElement, type: FieldType): Pick<RecognizedField, "valueType" | "label"> {
  const rawValueType = (row.querySelector("[data-field-value-type]") as HTMLInputElement | null)?.value.trim();
  const valueType = CONTACT_VALUE_TYPES.has(rawValueType as ContactValueType) ? rawValueType as ContactValueType : undefined;
  const label = (row.querySelector("[data-field-label]") as HTMLInputElement | null)?.value.trim();
  return {
    ...((type === "phone" || type === "email" || type === "address") && valueType ? { valueType } : {}),
    ...(type === "social" && label ? { label } : {}),
  };
}

function fieldRowHtml(field: RecognizedField): string {
  const options = FIELD_TYPES.map((ft) => `<option value="${ft}"${ft === field.type ? " selected" : ""}>${esc(fieldTypeLabel(ft))}</option>`).join("");
  return `
    <div class="social-row scan-field-row" data-field-row>
      <select data-field-type>${options}</select>
      <input type="hidden" data-field-value-type value="${esc(field.valueType || "")}" />
      <input type="hidden" data-field-label value="${esc(field.label || "")}" />
      <input data-field-value value="${esc(field.value)}" />
      <button type="button" class="remove-social" data-remove-field aria-label="${esc(t("remove"))}">&times;</button>
    </div>
  `;
}

function recognizedFieldsEditorHtml(fields: RecognizedField[]): string {
  return `
    <div class="panel" id="scan-review-panel">
      <div id="scan-field-list">${fields.map(fieldRowHtml).join("")}</div>
      <button type="button" class="add-social" id="scan-add-field">${esc(t("addField"))}</button>
    </div>
  `;
}

async function receivedEditPreviewHtml(entry: ReceivedEntry): Promise<string> {
  const cardPhoto = cardPhotoAsset(entry.data);
  if (!cardPhoto) return cardFaceHtml(entry.data);
  const photoDataUrl = await loadCardAssetDataUrl(cardPhoto);
  return photoDataUrl ? photoCardHtml(photoDataUrl, cardPhoto.transform) : cardFaceHtml(entry.data);
}

async function renderRecognizedFieldsEdit(entry: ReceivedEntry, fields: RecognizedField[]): Promise<void> {
  currentView = { kind: "editing" };
  scrollToTop();
  const previewHtml = await receivedEditPreviewHtml(entry);
  stage.innerHTML = `
    <div class="top-bar top-bar-split">
      <div class="top-bar-left">
        <span class="top-bar-title">${esc(t("reviewFields"))}</span>
      </div>
      <div class="top-bar-actions">
        <button type="button" class="top-bar-cancel-btn" id="scan-cancel-btn">${esc(t("cancel"))}</button>
        <button type="button" class="top-bar-done-btn" id="scan-save-btn">${esc(t("save"))}</button>
      </div>
    </div>
    ${previewHtml}
    ${recognizedFieldsEditorHtml(fields)}
  `;
  wireFieldEditor(stage, entry, () => void renderPhotoDetail(entry));
}

// Shown immediately after capture/upload — the entry is already saved (see
// the photo-input change handler), so cancelling out of here just leaves it
// at the identity transform rather than losing the photo. Rotate steps in
// fixed 90° increments (simpler than free-angle: no need to resample/clip
// against the ID-1 frame); scale/position come from drag-to-pan and
// pinch-to-zoom, tracked over the same pointer stream.
async function renderPhotoEdit(entry: ReceivedEntry): Promise<void> {
  currentView = { kind: "editing" };
  scrollToTop();
  const cardPhoto = cardPhotoAsset(entry.data);
  if (!cardPhoto) return;
  const photoDataUrl = await loadCardAssetDataUrl(cardPhoto);
  if (!photoDataUrl) return;
  const state: PhotoTransform = { ...(cardPhoto.transform || { rotate: 0, scale: 1, offsetX: 0, offsetY: 0 }) };

  stage.innerHTML = `
    <div class="top-bar top-bar-back top-bar-split">
      <div class="top-bar-left">
        <button type="button" class="icon-btn" id="photo-edit-cancel-btn" aria-label="${esc(t("cancel"))}">&lsaquo;</button>
      </div>
      <div class="top-bar-actions">
        <button type="button" class="btn btn-primary" id="photo-edit-save-btn">${esc(t("save"))}</button>
      </div>
    </div>
    <div class="photo-edit-stage" id="photo-edit-stage">
      <img id="photo-edit-img" src="${esc(photoDataUrl)}" alt="" />
    </div>
    <div class="photo-edit-controls">
      <button type="button" class="icon-btn" id="photo-edit-rotate-btn" aria-label="${esc(t("rotatePhoto"))}">&#8635;</button>
      <input type="range" id="photo-edit-scale" min="0.5" max="3" step="0.01" value="${state.scale}" />
    </div>
  `;

  const stageEl = document.getElementById("photo-edit-stage") as HTMLElement;
  const img = document.getElementById("photo-edit-img") as HTMLImageElement;
  const scaleInput = document.getElementById("photo-edit-scale") as HTMLInputElement;

  const applyTransform = (): void => {
    // Percent, not px — see PhotoTransform's doc comment in storage.ts for
    // why offsetX/offsetY are stored as fractions of the stage's own box.
    img.style.transform = `translate(${state.offsetX * 100}%, ${state.offsetY * 100}%) rotate(${state.rotate}deg) scale(${state.scale})`;
    scaleInput.value = String(state.scale);
  };
  applyTransform();

  document.getElementById("photo-edit-cancel-btn")!.addEventListener("click", () => void renderPhotoDetail(entry));

  document.getElementById("photo-edit-rotate-btn")!.addEventListener("click", () => {
    state.rotate = ((state.rotate + 90) % 360) as PhotoTransform["rotate"];
    applyTransform();
  });

  scaleInput.addEventListener("input", () => {
    state.scale = Number(scaleInput.value);
    applyTransform();
  });

  // Pans while exactly one pointer is down; pinch-zooms once a second one
  // joins. Both gestures read/write the same `state`, so switching between
  // them mid-gesture (e.g. lifting one of two fingers) just re-anchors
  // whichever gesture is now active instead of jumping.
  const pointers = new Map<number, { x: number; y: number }>();
  let dragStart: { x: number; y: number; offsetX: number; offsetY: number } | null = null;
  let pinchStart: { distance: number; scale: number; x: number; y: number; offsetX: number; offsetY: number } | null = null;

  const pinchDistance = (): number => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const pinchCenter = (): { x: number; y: number } => {
    const [a, b] = [...pointers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  stageEl.addEventListener("pointerdown", (e) => {
    stageEl.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      dragStart = { x: e.clientX, y: e.clientY, offsetX: state.offsetX, offsetY: state.offsetY };
      pinchStart = null;
    } else if (pointers.size === 2) {
      dragStart = null;
      const center = pinchCenter();
      pinchStart = { distance: pinchDistance(), scale: state.scale, x: center.x, y: center.y, offsetX: state.offsetX, offsetY: state.offsetY };
    }
  });

  stageEl.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1 && dragStart) {
      // Drag distance divided by the stage's own current box size, so the
      // stored offset is a resolution-independent fraction (see
      // PhotoTransform's doc comment in storage.ts) instead of a pixel
      // count tied to however big the stage happened to render here.
      const rect = stageEl.getBoundingClientRect();
      state.offsetX = dragStart.offsetX + (e.clientX - dragStart.x) / rect.width;
      state.offsetY = dragStart.offsetY + (e.clientY - dragStart.y) / rect.height;
      Object.assign(state, normalizePhotoTransform(state));
      applyTransform();
    } else if (pointers.size === 2 && pinchStart) {
      const distance = pinchDistance();
      const ratio = pinchStart.distance > 0 ? distance / pinchStart.distance : 1;
      const rect = stageEl.getBoundingClientRect();
      const center = pinchCenter();
      state.scale = pinchStart.scale * ratio;
      state.offsetX = pinchStart.offsetX + (center.x - pinchStart.x) / rect.width;
      state.offsetY = pinchStart.offsetY + (center.y - pinchStart.y) / rect.height;
      Object.assign(state, normalizePhotoTransform(state));
      applyTransform();
    }
  });

  const endPointer = (e: PointerEvent): void => {
    pointers.delete(e.pointerId);
    dragStart = null;
    pinchStart = null;
    if (pointers.size === 1) {
      const p = [...pointers.values()][0];
      dragStart = { x: p.x, y: p.y, offsetX: state.offsetX, offsetY: state.offsetY };
    }
  };
  stageEl.addEventListener("pointerup", endPointer);
  stageEl.addEventListener("pointercancel", endPointer);

  document.getElementById("photo-edit-save-btn")!.addEventListener("click", async () => {
    const safeTransform = normalizePhotoTransform(state);
    if (!safeTransform) {
      showToast(t("scanFailed"));
      return;
    }
    const saved = await savePhotoTransform(entry.id, cardPhoto.id, safeTransform);
    if (!saved) {
      showToast(t("scanFailed"));
      return;
    }
    invalidateReceivedPageSnapshot();
    scheduleCardSyncPush();
    cardPhoto.transform = safeTransform;
    void renderPhotoDetail(entry, true);
  });
}

// autoScan: true right after the capture -> edit-transform flow, where
// confirming the crop/rotation already signals "this is a card I want
// recognized" — skips the extra manual tap on scanCard (and, same as a
// manual tap, surfaces the inline enable prompt below instead of running OCR
// silently if no language is checked yet). Skipped when the card already has
// recognized contact fields, or when a scan just failed and
// renderPhotoDetail re-renders as its own fallback (see runScan's catch
// below), since re-running unattended each time would loop forever.
async function renderPhotoDetail(entry: ReceivedEntry, autoScan = false): Promise<void> {
  currentView = { kind: "photo-detail", id: entry.id };
  scrollToTop();
  const cardPhoto = cardPhotoAsset(entry.data);
  if (!cardPhoto) return;
  const photoDataUrl = await loadCardAssetDataUrl(cardPhoto);
  if (!photoDataUrl) return;
  const hasRecognizedContact = Boolean(entry.data.contact.fn || entry.data.contact.title || entry.data.contact.department || entry.data.contact.org || entry.data.contact.note || entry.data.contact.phones?.length || entry.data.contact.emails?.length || entry.data.contact.addresses?.length || entry.data.contact.urls?.length);
  const scanActionHtml = hasRecognizedContact
    ? `
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" id="photo-rescan-btn">${esc(t("rescan"))}</button>
        <button type="button" class="btn btn-secondary" id="photo-edit-fields-btn">${esc(t("editFields"))}</button>
      </div>
    `
    : `<button type="button" class="btn btn-primary btn-block" id="photo-scan-btn">${esc(t("scanCard"))}</button>`;

  stage.innerHTML = `
    <div class="top-bar top-bar-back">
      <button type="button" class="icon-btn" id="photo-back-btn" aria-label="${esc(t("back"))}">&lsaquo;</button>
    </div>
    ${photoCardHtml(photoDataUrl, cardPhoto.transform)}
    ${hasRecognizedContact ? identitySummaryHtml(entry.data.contact) : ""}
    ${hasRecognizedContact ? contactSheetHtml(entry.data) : ""}
    <div id="scan-action-area">${scanActionHtml}</div>
    ${hasRecognizedContact ? vcardActionsHtml(entry.data, "photo") : ""}
    <button type="button" class="form-delete-btn" id="photo-delete-btn">${esc(t("deleteThisCard"))}</button>
  `;

  document.getElementById("photo-back-btn")!.addEventListener("click", restoreOrRenderReceivedPage);
  document.getElementById("photo-delete-btn")!.addEventListener("click", async () => {
    invalidateReceivedPageSnapshot();
    await deleteReceivedEntry(entry.id);
    scheduleCardSyncPush();
    showToast(t("deleted"));
    void renderReceivedPage();
  });

  if (hasRecognizedContact) {
    wireVCardDownloadLink(entry.data, "photo");
    document.getElementById("photo-open-vcard-btn")?.addEventListener("click", () => void openVCardWithApps(entry.data));
  }

  const actionArea = document.getElementById("scan-action-area") as HTMLElement;
  let scanInFlight = false;

  const runScan = async (): Promise<void> => {
    if (scanInFlight) return;
    scanInFlight = true;
    actionArea.innerHTML = `<p class="list-empty">${esc(t("scanning"))}</p>`;
    try {
      const langs = loadAiLanguages();
      // Crop to just the card region the user framed in the edit step
      // (falls back to the full photo, contain-fit into the ID-1 frame, if
      // this entry predates that step and has no transform) — see
      // cropToCardFrame's doc comment in ocr.ts for why this matters far
      // more than it might look like it should.
      const cardImage = await cropToCardFrame(photoDataUrl, cardPhoto.transform);
      // No percentage shown here — Tesseract's progress goes through
      // several stages (loading traineddata, initializing, recognizing),
      // each restarting its own 0-100 count, so a single percentage number
      // visibly jumps backward between stages instead of climbing steadily.
      // A static "Recognizing…" avoids that confusing readout.
      const lines = await recognizeCardImage(cardImage, langs);
      // Recognizing successfully means Tesseract's own cache now has these
      // languages' traineddata — record that here too (not just from the
      // Settings page's explicit download button), so Settings' "Ready
      // offline" status stays accurate regardless of which path a language
      // was first used from.
      langs.forEach(markAiLanguageDownloaded);
      const fields = parseContactFields(lines);
      await renderRecognizedFieldsEdit(entry, fields);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[scan] recognition threw:", err);
      actionArea.innerHTML = `<p class="list-empty">${esc(t("scanFailed"))}</p>`;
      showToast(t("scanFailed"));
      window.setTimeout(() => void renderPhotoDetail(entry), 1500);
    } finally {
      scanInFlight = false;
    }
  };

  // Shown in place of running OCR straight away when no language is checked
  // yet — this is "enabling AI Recognition" (see isAiEnabled in storage.ts:
  // it's derived from having at least one language checked, not a separate
  // flag), just asked for at the moment it's actually needed instead of
  // requiring a detour through Settings first.
  const showEnablePrompt = (): void => {
    actionArea.innerHTML = `
      <div class="panel">
        <p class="settings-description">${esc(t("aiEnablePromptDescription"))}</p>
        <div class="btn-row">
          <button type="button" class="btn btn-secondary" id="ai-enable-cancel-btn">${esc(t("cancel"))}</button>
          <button type="button" class="btn btn-primary" id="ai-enable-confirm-btn">${esc(t("enableAndRecognize"))}</button>
        </div>
      </div>
    `;
    document.getElementById("ai-enable-cancel-btn")!.addEventListener("click", () => void renderPhotoDetail(entry));
    document.getElementById("ai-enable-confirm-btn")!.addEventListener("click", () => {
      if (scanInFlight) return;
      storeAiLanguages(defaultAiLanguagesForLocale(loadLocale()));
      void runScan();
    });
  };

  const attemptScan = (): void => {
    if (isAiEnabled()) void runScan();
    else showEnablePrompt();
  };

  document.getElementById("photo-scan-btn")?.addEventListener("click", attemptScan);
  document.getElementById("photo-rescan-btn")?.addEventListener("click", () => void runScan());
  document.getElementById("photo-edit-fields-btn")?.addEventListener("click", () => {
    void renderRecognizedFieldsEdit(entry, cardDataToRecognizedFields(entry.data));
  });

  if (autoScan && !hasRecognizedContact) attemptScan();
}

function wireFieldEditor(container: HTMLElement, entry: ReceivedEntry, onDone: () => void): void {
  const listEl = container.querySelector("#scan-field-list") as HTMLElement;

  container.querySelector("#scan-add-field")!.addEventListener("click", () => {
    listEl.insertAdjacentHTML("beforeend", fieldRowHtml({ type: "other", value: "" }));
  });

  listEl.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.hasAttribute("data-remove-field")) target.closest("[data-field-row]")!.remove();
  });

  container.querySelector("#scan-cancel-btn")!.addEventListener("click", onDone);

  container.querySelector("#scan-save-btn")!.addEventListener("click", async () => {
    const rows = listEl.querySelectorAll<HTMLElement>("[data-field-row]");
    const fields: RecognizedField[] = [];
    rows.forEach((row) => {
      const type = (row.querySelector("[data-field-type]") as HTMLSelectElement).value as FieldType;
      const value = (row.querySelector("[data-field-value]") as HTMLInputElement).value.trim();
      if (value) fields.push({ type, value, ...fieldMetadata(row, type) });
    });
    const data = fieldsToCardData(fields, entry.id);
    const saved = await saveRecognizedPhotoData(entry.id, data);
    if (!saved) {
      showToast(t("scanFailed"));
      return;
    }
    invalidateReceivedPageSnapshot();
    scheduleCardSyncPush();
    // Mutate the in-memory entry too — onDone() re-renders from this same
    // object, and storage alone updating wouldn't be reflected in it.
    entry.data = { ...data, assets: entry.data.assets };
    showToast(t("saved"));
    onDone();
  });
}

/* ============ Settings / Language pages ============ */

export function renderSettingsPage(): void {
  currentView = { kind: "other" };
  const currentName = LOCALES.find((l) => l.code === loadLocale())?.name || "English";
  const aiLabel = isAiEnabled() ? t("on") : t("off");
  const syncStatus = cardSyncController?.status();
  const syncLabel = syncStatus?.connected
    ? t(syncStatus.running ? "syncSyncing" : "syncConnected")
    : cardSyncBootstrapPromise
      ? t("syncSyncing")
      : t("syncLocalOnly");
  stage.innerHTML = `
    <div class="top-bar top-bar-back">
      <button type="button" class="icon-btn" id="settings-back-btn" aria-label="${esc(t("back"))}">&lsaquo;</button>
      <span class="top-bar-title">${esc(t("settings"))}</span>
    </div>
    <div class="panel">
      <button type="button" class="settings-row" id="language-entry-btn">
        <span>${esc(t("language"))}</span>
        <span>${esc(currentName)} &rsaquo;</span>
      </button>
      <button type="button" class="settings-row" id="ai-entry-btn">
        <span>${esc(t("aiSettings"))}</span>
        <span>${esc(aiLabel)} &rsaquo;</span>
      </button>
      <button type="button" class="settings-row" id="sync-entry-btn">
        <span>${esc(t("syncSettings"))}</span>
        <span>${esc(syncLabel)} &rsaquo;</span>
      </button>
      <button type="button" class="settings-row" id="export-entry-btn">
        <span>${esc(t("exportData"))}</span>
        <span>&rsaquo;</span>
      </button>
      <button type="button" class="settings-row" id="privacy-entry-btn">
        <span>${esc(t("privacySettings"))}</span>
        <span>&rsaquo;</span>
      </button>
      <button type="button" class="settings-row" id="about-entry-btn">
        <span>${esc(t("about"))}</span>
        <span>&rsaquo;</span>
      </button>
    </div>
  `;
  document.getElementById("settings-back-btn")!.addEventListener("click", () => void renderStack());
  document.getElementById("language-entry-btn")!.addEventListener("click", () => renderLanguagePage());
  document.getElementById("ai-entry-btn")!.addEventListener("click", () => renderAiSettingsPage());
  document.getElementById("sync-entry-btn")!.addEventListener("click", () => void renderSyncPage());
  document.getElementById("export-entry-btn")!.addEventListener("click", () => renderExportDataPage());
  document.getElementById("privacy-entry-btn")!.addEventListener("click", () => renderPrivacyPage());
  document.getElementById("about-entry-btn")!.addEventListener("click", () => renderAboutPage());
}

async function ensureCardSyncController(): Promise<boolean> {
  if (cardSyncController) {
    startCardSyncHints();
    return true;
  }
  await bootstrapCardSync();
  return Boolean(cardSyncController);
}

async function renderSyncPage(): Promise<void> {
  currentView = { kind: "other" };
  await ensureCardSyncController();
  const status = cardSyncController?.status();
  const statusText = status?.running
    ? t("syncSyncing")
    : status?.lastError
      ? t("syncNeedsAttention")
      : status?.connected
        ? t("syncConnected")
        : t("syncLocalOnly");
  stage.innerHTML = `
    <div class="top-bar top-bar-back">
      <button type="button" class="icon-btn" id="sync-back-btn" aria-label="${esc(t("back"))}">&lsaquo;</button>
      <span class="top-bar-title">${esc(t("syncSettings"))}</span>
    </div>
    <div class="panel">
      <p class="settings-description">${esc(t("syncDescription"))}</p>
      <div class="settings-row settings-row-static">
        <span>${esc(t("syncStatus"))}</span>
        <span>${esc(statusText)}</span>
      </div>
      ${status?.lastSyncedAt ? `<div class="settings-row settings-row-static"><span>${esc(t("syncLastSynced"))}</span><span>${esc(new Date(status.lastSyncedAt).toLocaleString())}</span></div>` : ""}
      ${status?.lastError ? `<p class="settings-description sync-error">${esc(status.lastError)}</p>` : ""}
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" id="sync-disconnect-btn"${status?.connected ? "" : " disabled"}>${esc(t("syncDisconnect"))}</button>
        <button type="button" class="btn btn-primary" id="sync-action-btn">${esc(status?.connected && !status.lastError ? t("syncNow") : t("syncConnect"))}</button>
      </div>
    </div>
  `;
  document.getElementById("sync-back-btn")!.addEventListener("click", () => renderSettingsPage());
  document.getElementById("sync-action-btn")!.addEventListener("click", async () => {
    if (status?.lastError) {
      await resetCardSyncAuthorization();
      await authorizeCardSync();
      return;
    }
    const connected = await ensureCardSyncController();
    if (!connected) {
      await authorizeCardSync();
      return;
    }
    showToast(t("syncSyncing"));
    await runCardSyncNow();
    const result = cardSyncController!.status();
    showToast(result.lastError ? t("syncNeedsAttention") : t("syncConnected"));
    void renderSyncPage();
  });
  document.getElementById("sync-disconnect-btn")?.addEventListener("click", async () => {
    await resetCardSyncAuthorization();
    showToast(t("syncLocalOnly"));
    void renderSyncPage();
  });
}

function renderExportDataPage(): void {
  currentView = { kind: "other" };
  stage.innerHTML = `
    <div class="top-bar top-bar-back">
      <button type="button" class="icon-btn" id="export-back-btn" aria-label="${esc(t("back"))}">&lsaquo;</button>
      <span class="top-bar-title">${esc(t("exportData"))}</span>
    </div>
    <div class="panel">
      <button type="button" class="settings-row" id="export-my-cards-btn">
        <span>${esc(t("exportMyCardsVCard"))}</span>
        <span>&rsaquo;</span>
      </button>
      <button type="button" class="settings-row" id="export-received-cards-btn">
        <span>${esc(t("exportReceivedCardsVCard"))}</span>
        <span>&rsaquo;</span>
      </button>
      <button type="button" class="settings-row" id="export-photo-cards-btn">
        <span>${esc(t("exportPhotoCards"))}</span>
        <span>&rsaquo;</span>
      </button>
    </div>
  `;
  document.getElementById("export-back-btn")!.addEventListener("click", () => renderSettingsPage());
  document.getElementById("export-my-cards-btn")!.addEventListener("click", async () => {
    try {
      const payload = myCardsVCard(await loadMine());
      if (!payload) {
        showToast(t("nothingToExport"));
        return;
      }
      downloadTextFile(payload, "my-cards.vcf", "text/vcard;charset=utf-8");
    } catch {
      showToast(t("exportFailed"));
    }
  });
  document.getElementById("export-received-cards-btn")!.addEventListener("click", async () => {
    try {
      const payload = receivedCardsVCard(await loadReceived());
      if (!payload) {
        showToast(t("nothingToExport"));
        return;
      }
      downloadTextFile(payload, "received-cards.vcf", "text/vcard;charset=utf-8");
    } catch {
      showToast(t("exportFailed"));
    }
  });
  document.getElementById("export-photo-cards-btn")!.addEventListener("click", async () => {
    try {
      const entries = (await loadReceived()).filter((entry) => cardPhotoAsset(entry.data));
      const items = [];
      for (const entry of entries) {
        const photo = cardPhotoAsset(entry.data);
        if (!photo) continue;
        const dataUrl = await loadCardAssetDataUrl(photo);
        if (dataUrl) items.push({ entry, dataUrl });
      }
      if (!items.length) {
        showToast(t("nothingToExport"));
        return;
      }
      downloadBlob(buildPhotoCardsZip(items), "photo-cards.zip", "application/zip");
    } catch {
      showToast(t("exportFailed"));
    }
  });
}

function renderAboutPage(): void {
  currentView = { kind: "other" };
  stage.innerHTML = `
    <div class="top-bar top-bar-back">
      <button type="button" class="icon-btn" id="about-back-btn" aria-label="${esc(t("back"))}">&lsaquo;</button>
      <span class="top-bar-title">${esc(t("about"))}</span>
    </div>
    <div class="panel about-panel">
      <div class="about-app-name">Card Field <span class="about-app-brand">by MyField</span></div>
      <div class="about-version">Version ${esc(APP_VERSION)}</div>
      <div class="about-links">
        <a class="about-link" href="https://myfield.one" target="_blank" rel="noopener">myfield.one</a>
        <a class="about-link" href="https://github.com/myfield-one/card" target="_blank" rel="noopener">GitHub</a>
      </div>
      <p class="about-copyright">&copy; 2026 OPENTECH AI PTE. LTD.</p>
      <div class="about-section">
        <h2 class="about-section-title">${esc(t("acknowledgments"))}</h2>
        <p class="about-credits">Uses <a href="https://github.com/kazuhikoarase/qrcode-generator" target="_blank" rel="noopener">qrcode-generator</a> by Kazuhiko Arase, MIT License.</p>
        <p class="about-credits">Uses <a href="https://github.com/naptha/tesseract.js" target="_blank" rel="noopener">Tesseract.js</a>, Apache License 2.0.</p>
      </div>
    </div>
  `;
  document.getElementById("about-back-btn")!.addEventListener("click", () => renderSettingsPage());
}

// A single authoritative writeup of this app's privacy model (local-first
// storage, the share link's key-in-the-fragment mechanism, and recommended
// sharing channels) — the Detail view's share-mode info button
// (see renderDetail) links here rather than showing its own separate
// popover, so there's one copy of this text to keep accurate, not two.
function renderPrivacyPage(): void {
  currentView = { kind: "other" };
  const showTranslationNotice = loadLocale() !== "en";
  stage.innerHTML = `
    <div class="top-bar top-bar-back">
      <button type="button" class="icon-btn" id="privacy-back-btn" aria-label="${esc(t("back"))}">&lsaquo;</button>
      <span class="top-bar-title">${esc(t("privacySettings"))}</span>
    </div>
    <div class="panel privacy-panel">
      ${showTranslationNotice ? `<p class="privacy-translation-notice">${esc(t("privacyTranslationNotice"))}</p>` : ""}
      <p>${esc(t("privacyPoint1"))}</p>
      <p>${esc(t("privacyPoint2"))}</p>
      <p>${esc(t("privacyPointSync"))}</p>
      <p>${esc(t("privacyPoint3"))}</p>
      <p class="privacy-tagline">${esc(t("privacyTagline"))}</p>
    </div>
  `;
  document.getElementById("privacy-back-btn")!.addEventListener("click", () => renderSettingsPage());
}

// Approximate compressed sizes of the vendored .traineddata.gz files (see
// public/tesseract/lang-data) — shown so the download-size disclosure the
// feature draft calls for is a real number, not a vague "some data".
const AI_LANGUAGE_SIZE: Record<string, string> = {
  eng: "~2 MB",
  chi_sim: "~1.7 MB",
  chi_tra: "~1.6 MB",
  spa: "~1.1 MB",
  fra: "~0.6 MB",
  deu: "~0.9 MB",
  jpn: "~1.5 MB",
  kor: "~1.1 MB",
  por: "~1 MB",
  msa: "~1.1 MB",
  tam: "~1.3 MB",
  tha: "~0.9 MB",
  vie: "~0.4 MB",
  ind: "~0.6 MB",
};

// No separate Enable/Disable control — checking a language here (or via the
// inline enable prompt in renderPhotoDetail) *is* turning the feature on;
// see isAiEnabled in storage.ts.
function renderAiSettingsPage(): void {
  currentView = { kind: "other" };
  const selectedLangs = loadAiLanguages();
  const downloadedLangs = loadDownloadedAiLanguages();

  const langRows = AI_LANGUAGES.map((l) => {
    const isSelected = selectedLangs.includes(l.code);
    const isDownloaded = downloadedLangs.includes(l.code);
    let statusHtml = "";
    if (isSelected) {
      statusHtml = isDownloaded ? `<span class="locale-check">&check;</span> ${esc(t("aiReadyOffline"))}` : esc(t("aiNotDownloaded"));
    }
    return `
      <button type="button" class="settings-row" data-ai-lang="${esc(l.code)}" data-selected="${isSelected}">
        <span>${esc(l.name)} <span class="ai-lang-size">${esc(AI_LANGUAGE_SIZE[l.code] || "")}</span></span>
        <span>${statusHtml}</span>
      </button>
    `;
  }).join("");

  stage.innerHTML = `
    <div class="top-bar top-bar-back">
      <button type="button" class="icon-btn" id="ai-back-btn" aria-label="${esc(t("back"))}">&lsaquo;</button>
      <span class="top-bar-title">${esc(t("aiSettings"))}</span>
    </div>
    <p class="settings-description">${esc(t("aiSettingsDescription"))}</p>
    <div class="panel">
      <h2>${esc(t("aiLanguagesTitle"))}</h2>
      <p class="settings-description">${esc(t("aiLanguagesHint"))}</p>
      ${langRows}
    </div>
    <p class="list-empty" id="ai-progress" hidden></p>
  `;

  document.getElementById("ai-back-btn")!.addEventListener("click", () => renderSettingsPage());

  const progressEl = document.getElementById("ai-progress") as HTMLElement;

  const showProgress = (label: string): void => {
    progressEl.hidden = false;
    progressEl.textContent = label;
  };
  const hideProgress = (): void => {
    progressEl.hidden = true;
    progressEl.textContent = "";
  };
  const languageName = (code: string): string => AI_LANGUAGES.find((o) => o.code === code)?.name || code;

  // Downloads languages one at a time (simpler progress UI, and avoids
  // spinning up multiple Tesseract workers at once) — updates the same
  // still-mounted progressEl throughout, deliberately not re-rendering the
  // whole page mid-sequence, which would detach it from anything a
  // still-running download's callback is writing to.
  const downloadLanguages = async (langs: string[]): Promise<void> => {
    for (const lang of langs) {
      try {
        showProgress(`${t("aiDownloading")} ${languageName(lang)}…`);
        await warmUpOcrLanguages([lang], (p) => {
          showProgress(`${languageName(lang)}: ${Math.round(p.progress * 100)}%`);
        });
        markAiLanguageDownloaded(lang);
      } catch {
        showToast(t("aiDownloadFailed"));
      }
    }
    hideProgress();
    renderAiSettingsPage();
  };

  document.querySelectorAll<HTMLButtonElement>("[data-ai-lang]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const lang = btn.getAttribute("data-ai-lang")!;
      const current = loadAiLanguages();
      const wasSelected = current.includes(lang);
      const next = wasSelected ? current.filter((c) => c !== lang) : [...current, lang];
      storeAiLanguages(next);
      // Newly checked and not cached yet — download just this one;
      // otherwise (unchecking, or already cached) just persist the
      // preference and re-render, no download needed.
      if (!wasSelected && !loadDownloadedAiLanguages().includes(lang)) {
        void downloadLanguages([lang]);
      } else {
        renderAiSettingsPage();
      }
    });
  });
}

function renderLanguagePage(): void {
  currentView = { kind: "other" };
  const current = loadLocale();
  const languageRows = LOCALES.map(
    (l) => `
    <button type="button" class="settings-row" data-locale="${esc(l.code)}">
      <span>${esc(l.name)}</span>
      ${l.code === current ? `<span class="locale-check">&check;</span>` : ""}
    </button>
  `,
  ).join("");
  stage.innerHTML = `
    <div class="top-bar top-bar-back">
      <button type="button" class="icon-btn" id="language-back-btn" aria-label="${esc(t("back"))}">&lsaquo;</button>
      <span class="top-bar-title">${esc(t("language"))}</span>
    </div>
    <div class="panel">${languageRows}</div>
  `;
  document.getElementById("language-back-btn")!.addEventListener("click", () => renderSettingsPage());
  stage.querySelectorAll<HTMLButtonElement>("[data-locale]").forEach((btn) => {
    btn.addEventListener("click", () => {
      storeLocale(btn.getAttribute("data-locale")!);
      showToast(t("languageUpdated"));
      renderSettingsPage();
    });
  });
}

/* ============ entry ============ */

export async function initApp(): Promise<void> {
  startCardSyncRecoveryListeners();
  const syncCallback = await handleCardSyncAuthCallback();
  if (syncCallback === "approved") {
    await renderStack();
    startBackgroundCardSync();
    return;
  }
  if (syncCallback === "handled") {
    await renderStack();
    return;
  }
  const fragment = location.hash.slice(1);
  if (fragment) {
    try {
      const data = await decodeCardFragment(fragment);
      if (!data) throw new Error("bad format");
      // A share link's hash ends up back in the address bar this same
      // device could see again (enterShareView's history.pushState, or a
      // forward-navigation after it) — decoding it just yields our own
      // card back. Route that to our own Detail view instead of the
      // generic "you received a contact" flow, so we don't self-file into
      // Received Cards.
      const ownCard = (await loadMine()).find((c) => c.id === data.id);
      if (ownCard) {
        history.replaceState(null, "", location.pathname);
        renderDetail(ownCard);
        return;
      }
      // Auto-saved on open (no separate "Save" tap — one save action,
      // "Save to Contacts" below, is enough). Duplicates are handled by
      // addReceived's id-keyed upsert, not by asking the user to opt in:
      // re-opening the same link (or a re-share after an edit) updates the
      // existing Received Cards entry instead of piling up a new one.
      await addReceived(data);
      invalidateReceivedPageSnapshot();
      await renderRecipient(data);
      scheduleCardSyncPush();
    } catch {
      await renderError();
    }
    return;
  }
  await renderStack();
  startBackgroundCardSync();
}
