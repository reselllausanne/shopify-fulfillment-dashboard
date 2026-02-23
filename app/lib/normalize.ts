export function normalizeSize(value?: string | null): string | null {
  if (!value) return null;
  return value
    .toString()
    .replace(/\u00A0/g, " ")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase()
    .replace(",", ".");
}

export function normalizeSku(value?: string | null): string | null {
  if (!value) return null;
  const cleaned = value
    .toString()
    .replace(/\u00A0/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return cleaned.length ? cleaned : null;
}

export function parsePriceSafe(value?: string | null): number | null {
  if (!value) return null;
  const raw = value.toString().replace(/\u00A0/g, " ").trim();
  if (!raw) return null;
  let cleaned = raw.replace(/[^\d,.\-]/g, "");
  if (!cleaned) return null;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      cleaned = cleaned.replace(/\./g, "");
      cleaned = cleaned.replace(/,/g, ".");
    } else {
      cleaned = cleaned.replace(/,/g, "");
    }
  } else {
    cleaned = cleaned.replace(/,/g, ".");
  }

  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100) / 100;
}

export function validateGtin(value?: string | null): boolean {
  if (!value) return false;
  const cleaned = value.toString().trim();
  if (!/^\d+$/.test(cleaned)) return false;
  return [8, 12, 13, 14].includes(cleaned.length);
}
