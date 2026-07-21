/**
 * GTINs that must NEVER get an STX supplier row / StockX refresh.
 * Physical Shopify-only items that share a barcode with a different KickDB
 * product (wrong match) live here.
 *
 * Env override: MANUAL_ONLY_GTINS=198437210359,other...
 */
const HARDCODED = new Set<string>([
  // Essentials short tee (Antica) — Shopify product ≠ FOG KickDB match
  "198437210359",
]);

export function isManualOnlyGtin(gtin: string | null | undefined): boolean {
  const g = String(gtin ?? "").trim();
  if (!g) return false;
  if (HARDCODED.has(g)) return true;
  const env = process.env.MANUAL_ONLY_GTINS ?? "";
  if (!env) return false;
  return env
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(g);
}
