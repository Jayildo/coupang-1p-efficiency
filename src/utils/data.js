import { read, utils } from "xlsx";

export async function readSpreadsheet(file) {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = read(arrayBuffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return utils.sheet_to_json(sheet);
}

export function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/_/g, "");
}

export function findValue(row, aliases) {
  const entries = Object.entries(row || {});
  for (const [key, value] of entries) {
    if (aliases.includes(normalizeKey(key))) {
      return value;
    }
  }
  return "";
}

export function parseNumber(value) {
  if (typeof value === "number") {
    return value;
  }
  const parsed = String(value || "")
    .replace(/,/g, "")
    .trim();
  return parsed ? Number(parsed) || 0 : 0;
}

export function parseDateLabel(value) {
  if (!value) {
    return "미지정";
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
      return text.slice(2, 10).replace(/-/g, ".");
    }
    if (/^\d{8}$/.test(text)) {
      return `${text.slice(2, 4)}.${text.slice(4, 6)}.${text.slice(6, 8)}`;
    }
    return text;
  }
  if (typeof value === "number") {
    const utcDays = Math.floor(value - 25569);
    const utcValue = utcDays * 86400;
    const date = new Date(utcValue * 1000);
    const yy = String(date.getFullYear()).slice(2);
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${yy}.${mm}.${dd}`;
  }
  return String(value);
}

export function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
