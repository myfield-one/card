import type { CardData } from "./crypto";
import { resolveSocialUrl } from "./social-url.ts";

function escapeVCardValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n?/g, "\\n")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

export function buildVCard(data: CardData): string {
  const { contact } = data;
  const contactName = contact.fn.trim();
  const displayName = contactName || contact.org?.trim() || "My Card";
  const escapedName = escapeVCardValue(displayName);
  const structuredName = contactName ? `;${escapeVCardValue(contactName)};;;` : ";;;;";
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `N:${structuredName}`, `FN:${escapedName}`];
  if (contact.title) lines.push(`TITLE:${escapeVCardValue(contact.title)}`);
  if (contact.org || contact.department) {
    lines.push(`ORG:${escapeVCardValue(contact.org || "")}${contact.department ? `;${escapeVCardValue(contact.department)}` : ""}`);
  }
  for (const phone of contact.phones || []) {
    lines.push(`TEL;TYPE=${escapeVCardValue((phone.type || "other").toUpperCase())}:${escapeVCardValue(phone.value)}`);
  }
  for (const email of contact.emails || []) {
    lines.push(`EMAIL;TYPE=${escapeVCardValue((email.type || "other").toUpperCase())}:${escapeVCardValue(email.value)}`);
  }
  for (const address of contact.addresses || []) {
    lines.push(`ADR;TYPE=${escapeVCardValue((address.type || "other").toUpperCase())}:;;${escapeVCardValue(address.value)};;;;`);
  }
  for (const url of contact.urls || []) {
    const value = resolveSocialUrl(url.label, url.value).vcardValue;
    lines.push(`URL;TYPE=${escapeVCardValue((url.label || "Website").toUpperCase())}:${escapeVCardValue(value)}`);
  }
  const note = [contact.tagline, contact.note].filter(Boolean).join("\n\n");
  if (note) lines.push(`NOTE:${escapeVCardValue(note)}`);
  lines.push("END:VCARD");
  return lines.join("\r\n");
}
