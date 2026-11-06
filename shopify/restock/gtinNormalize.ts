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

/**
 * GTIN match candidates tolerant to UPC-A/EAN-13/GTIN-14 zero-padding.
 *
 * Conversion rules (GS1 spec):
 *   - UPC-A (12-digit)        → also try EAN-13 (0-padded) and GTIN-14.
 *   - EAN-13 starting with 0  → also try UPC-A (strip leading zero). These are
 *                               mathematically equivalent: the EAN-13 is just a
 *                               zero-padded UPC-A.
 *   - EAN-13 starting with 1-9 → keep as 13-digit; NEVER strip a non-zero leading
 *                               digit to produce a fake 12-digit value. Adidas/
 *                               European barcodes (prefix 4xx) fall here. Stripping
 *                               the leading digit would yield an unrelated 12-digit
 *                               number that has nothing to do with the scanned GTIN
 *                               and would break STX/SupplierVariant lookups.
 *   - GTIN-14                 → also try stripped forms.
 *
 * DB queries that need to match across padding variants should use
 * `{ gtin: { in: gtinCandidates(scannedGtin) } }` rather than exact equality.
 */
export function gtinCandidates(rawGtin: string): string[] {
  const clean = cleanGtin(rawGtin);
  if (!clean) return [];
  // Strip ALL leading zeros only (not other digits).
  // For EAN-13 starting with '0' this yields the UPC-A (e.g. 0196… → 196…).
  // For EAN-13 starting with '4' there are no leading zeros — stripped === clean.
  const stripped = clean.replace(/^0+/, "");
  const set = new Set<string>([clean, stripped]);
  for (const base of [clean, stripped]) {
    if (!base) continue;
    for (const len of [12, 13, 14]) {
      // Only zero-pad UP to the target length, never truncate.
      if (base.length <= len) set.add(base.padStart(len, "0"));
    }
  }
  return [...set].filter(Boolean);
}

/**
 * Normalise a scanned GTIN for a single canonical DB key lookup.
 *
 *   - UPC-A (12-digit)            → kept as-is.
 *   - EAN-13 starting with '0'    → strip leading zero → UPC-A (12-digit).
 *     These are the same product; most STX/KickDB rows store the UPC form.
 *   - EAN-13 starting with '1'-'9' (European, e.g. Adidas '4xx' barcodes)
 *     → kept as-is (13 digits). Do NOT strip the leading digit — that produces
 *     an arbitrary 12-digit number unrelated to the scanned barcode.
 *   - GTIN-14 with a leading zero → strip the leading zero → 13-digit EAN-13.
 *   - Any other length             → returned unchanged.
 *
 * For exhaustive padding-tolerant lookups prefer `gtinCandidates` instead.
 */
export function normalizeGtinForLookup(rawGtin: string): string {
  const clean = cleanGtin(rawGtin);
  if (!clean) return clean;
  // EAN-13 starting with '0' → UPC-A
  if (clean.length === 13 && clean.startsWith("0")) return clean.slice(1);
  // GTIN-14 starting with '0' → EAN-13
  if (clean.length === 14 && clean.startsWith("0")) return clean.slice(1);
  return clean;
}
