/**
 * /scan input classification — scanners vs human typing.
 * Autos (fulfill / Swiss Post / packing) must only run for scanner-like input.
 */

export function looksLikeManualQuery(value: string): boolean {
  const v = String(value ?? "").trim();
  if (v.length < 2) return false;
  const upper = v.toUpperCase();
  if (upper.startsWith("1Z") && upper.length >= 10) return false;
  if (upper.startsWith("JJD") && upper.length >= 10) return false;
  if (upper.startsWith("JD") && upper.length >= 10) return false;
  if (/^\d{8,}$/.test(v)) return false;
  if (v.length < 8) return true;
  if (/[a-z]/i.test(v)) return true;
  if (/(.)\1/.test(v)) return true;
  return false;
}

/** GTIN / AWB / tracking-like — safe to auto-act after a real scan. */
export function isBarcodeOrAwbLike(value: string): boolean {
  const v = String(value ?? "").trim();
  if (!v) return false;
  if (/^\d{8,14}$/.test(v)) return true;
  const upper = v.toUpperCase();
  if (upper.startsWith("1Z") && upper.length >= 10) return true;
  if (upper.startsWith("JJD") && upper.length >= 10) return true;
  if ((upper.startsWith("JD") || upper.startsWith("99")) && upper.length >= 10) return true;
  // Swiss Post / long numeric tracking
  if (/^\d{16,}$/.test(v)) return true;
  return false;
}

/**
 * True when this submit may auto-fulfill / auto-print / auto-pack.
 * Suggestion picks and free-text search must never auto.
 */
export function shouldAllowScanAutoActions(params: {
  code: string;
  fromScannerBurst?: boolean;
  fromSuggestion?: boolean;
}): boolean {
  if (params.fromSuggestion) return false;
  if (params.fromScannerBurst) return true;
  const code = String(params.code ?? "").trim();
  if (!code) return false;
  if (looksLikeManualQuery(code)) return false;
  return isBarcodeOrAwbLike(code);
}
