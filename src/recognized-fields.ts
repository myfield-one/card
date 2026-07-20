import type { CardData, ContactValueType } from "./crypto";
import type { RecognizedField } from "./recognizer-core";

const VALUE_TYPES_BY_FIELD = {
  phone: new Set<ContactValueType>(["mobile", "work", "home", "main", "other"]),
  email: new Set<ContactValueType>(["work", "home", "other"]),
  address: new Set<ContactValueType>(["work", "home", "other"]),
};

function valueTypeFor(field: RecognizedField, kind: "phone" | "email" | "address", fallback: ContactValueType): ContactValueType {
  return field.valueType && VALUE_TYPES_BY_FIELD[kind].has(field.valueType) ? field.valueType : fallback;
}

export function fieldsToCardData(fields: RecognizedField[], id: string): CardData {
  const data: CardData = { v: 2, id, contact: { fn: "", phones: [], emails: [], addresses: [], urls: [] } };
  for (const f of fields) {
    const value = f.value.trim();
    if (!value) continue;
    switch (f.type) {
      case "name":
        data.contact.fn = value;
        break;
      case "title":
        data.contact.title = value;
        break;
      case "company":
        data.contact.org = value;
        break;
      case "phone":
        data.contact.phones!.push({ type: valueTypeFor(f, "phone", "mobile"), value });
        break;
      case "email":
        data.contact.emails!.push({ type: valueTypeFor(f, "email", "work"), value });
        break;
      case "address":
        data.contact.addresses!.push({ type: valueTypeFor(f, "address", "work"), value });
        break;
      case "social":
        data.contact.urls!.push({ label: f.label || "Website", value });
        break;
      case "other":
        data.contact.addresses!.push({ type: "other", value });
        break;
    }
  }
  return data;
}

export function cardDataToRecognizedFields(data: CardData): RecognizedField[] {
  const fields: RecognizedField[] = [];
  if (data.contact.fn) fields.push({ type: "name", value: data.contact.fn });
  if (data.contact.title) fields.push({ type: "title", value: data.contact.title });
  if (data.contact.org) fields.push({ type: "company", value: data.contact.org });
  for (const phone of data.contact.phones || []) fields.push({ type: "phone", value: phone.value, valueType: phone.type });
  for (const email of data.contact.emails || []) fields.push({ type: "email", value: email.value, valueType: email.type });
  for (const address of data.contact.addresses || []) fields.push({ type: "address", value: address.value, valueType: address.type });
  for (const url of data.contact.urls || []) fields.push({ type: "social", value: url.value, label: url.label });
  return fields;
}
