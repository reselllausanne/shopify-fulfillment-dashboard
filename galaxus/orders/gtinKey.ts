/** Digit-only GTIN / EAN for comparisons. */
export function digitsOnlyGtin(s: string): string {
  return String(s ?? "").replace(/\D/g, "");
}

/** Galaxus ORDR INTERNATIONAL_PID: GTIN-14 with leading zeros. */
export function toGtin14(raw: string | null | undefined): string | null {
  const digits = digitsOnlyGtin(raw ?? "");
  if (!digits) return null;
  return digits.padStart(14, "0").slice(-14);
}

/** True when two GTIN strings refer to the same article (EAN-13 vs GTIN-14 / leading zeros). */
export function sameGtinKey(a: string, b: string): boolean {
  const da = digitsOnlyGtin(a);
  const db = digitsOnlyGtin(b);
  if (!da || !db) return false;
  if (da === db) return true;
  const na = toGtin14(da);
  const nb = toGtin14(db);
  return Boolean(na && nb && na === nb);
}
