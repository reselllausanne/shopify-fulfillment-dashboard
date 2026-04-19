/** Digit-only GTIN / EAN for comparisons. */
export function digitsOnlyGtin(s: string): string {
  return String(s ?? "").replace(/\D/g, "");
}

/** True when two GTIN strings refer to the same article (EAN-13 vs GTIN-14 / leading zeros). */
export function sameGtinKey(a: string, b: string): boolean {
  const da = digitsOnlyGtin(a);
  const db = digitsOnlyGtin(b);
  if (!da || !db) return false;
  if (da === db) return true;
  const na = da.padStart(14, "0").slice(-14);
  const nb = db.padStart(14, "0").slice(-14);
  return na === nb;
}
