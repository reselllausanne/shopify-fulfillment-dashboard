/** Normalize scanner input to digits-only GTIN. */
export function cleanGtin(value: string): string {
  return String(value ?? "").replace(/\D/g, "").trim();
}

/** GTIN digit-comparison tolerant to leading zeros (UPC-A vs EAN-13). */
export function gtinEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  const ca = cleanGtin(String(a ?? "")).replace(/^0+/, "");
  const cb = cleanGtin(String(b ?? "")).replace(/^0+/, "");
  return Boolean(ca) && ca === cb;
}

/** GTIN match candidates tolerant to UPC-A/EAN-13/GTIN-14 zero-padding. */
export function gtinCandidates(rawGtin: string): string[] {
  const clean = cleanGtin(rawGtin);
  if (!clean) return [];
  const stripped = clean.replace(/^0+/, "");
  const set = new Set<string>([clean, stripped]);
  for (const base of [clean, stripped]) {
    if (!base) continue;
    for (const len of [12, 13, 14]) {
      if (base.length <= len) set.add(base.padStart(len, "0"));
    }
  }
  return [...set].filter(Boolean);
}
