/** Public returns: `#` then digits only, e.g. `#6141`. Client-safe (no Node imports). */
export const PUBLIC_ORDER_NUMBER_RE = /^#\d{1,10}$/;

export function parseStrictPublicOrderNumber(raw: string): string | null {
  const trimmed = String(raw ?? "").trim();
  if (!PUBLIC_ORDER_NUMBER_RE.test(trimmed)) return null;
  return trimmed;
}

export function digitsFromPublicOrderInput(raw: string): string {
  return String(raw ?? "").replace(/\D/g, "").slice(0, 10);
}

export function formatPublicOrderNumberFromDigits(digits: string): string {
  const clean = digitsFromPublicOrderInput(digits);
  return clean ? `#${clean}` : "";
}
