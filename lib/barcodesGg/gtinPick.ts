import { isValidGtin } from "@/galaxus/exports/feedValidation";
import type { BarcodesGgSizeRow, PickedGtin } from "@/lib/barcodesGg/types";
import { normSize } from "@/shopify/stx/stxStockShopify";

/** Digits-only; prefer UPC when check-digit valid, else EAN. */
export function pickValidGtinFromSize(row: BarcodesGgSizeRow): PickedGtin | null {
  const upc = String(row.upc ?? "").replace(/\D/g, "").trim();
  const ean = String(row.ean ?? "").replace(/\D/g, "").trim();
  if (upc && isValidGtin(upc)) {
    return {
      gtin: upc.length === 12 ? `0${upc}` : upc,
      source: "upc",
      eu: row.eu != null ? String(row.eu) : null,
      us: row.us != null ? String(row.us) : null,
    };
  }
  if (ean && isValidGtin(ean)) {
    return {
      gtin: ean,
      source: "ean",
      eu: row.eu != null ? String(row.eu) : null,
      us: row.us != null ? String(row.us) : null,
    };
  }
  return null;
}

export function pickAllValidGtins(sizes: BarcodesGgSizeRow[] | null | undefined): PickedGtin[] {
  const out: PickedGtin[] = [];
  const seen = new Set<string>();
  for (const row of sizes ?? []) {
    const pick = pickValidGtinFromSize(row);
    if (!pick) continue;
    const key = pick.gtin.replace(/^0+/, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(pick);
  }
  return out;
}

/** "40 1/2" / "40 ½" / "40,5" → "40.5" after normSize. */
export function canonSize(raw: unknown): string {
  return normSize(raw)
    .replace(/\s*1\/2\b/g, ".5")
    .replace(/\s*1\/3\b/g, ".33")
    .replace(/\s*2\/3\b/g, ".67")
    .replace(/½/g, ".5")
    .replace(/⅓/g, ".33")
    .replace(/⅔/g, ".67")
    .replace(/\s+/g, "");
}

/** Match SV sizeRaw / sizeNormalized to barcodes.gg EU (or US fallback). */
export function matchSizeToPicked(
  sizeRaw: string | null | undefined,
  sizeNormalized: string | null | undefined,
  picks: PickedGtin[]
): PickedGtin | null {
  const candidates = [sizeRaw, sizeNormalized]
    .map((s) => canonSize(s))
    .filter(Boolean);
  if (candidates.length === 0) return null;

  for (const cand of candidates) {
    const euHit = picks.find((p) => p.eu && canonSize(p.eu) === cand);
    if (euHit) return euHit;
  }
  for (const cand of candidates) {
    const usHit = picks.find((p) => p.us && canonSize(p.us) === cand);
    if (usHit) return usHit;
  }
  return null;
}

export function normalizeStyleCode(raw: string | null | undefined): string | null {
  const s = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  return s || null;
}
