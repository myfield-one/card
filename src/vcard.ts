import type { CardData } from "./crypto";

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
  const displayName = contact.fn.trim() || contact.org?.trim() || "My Card";
  const escapedName = escapeVCardValue(displayName);
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `N:${escapedName};;;;`, `FN:${escapedName}`];
  if (contact.title) lines.push(`TITLE:${escapeVCardValue(contact.title)}`);
  if (contact.org) lines.push(`ORG:${escapeVCardValue(contact.org)}`);
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
    lines.push(`URL;TYPE=${escapeVCardValue((url.label || "Website").toUpperCase())}:${escapeVCardValue(url.value)}`);
  }
  lines.push("END:VCARD");
  return lines.join("\r\n");
}
