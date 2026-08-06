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
