/**
 * Galaxus line listed as STX_* but fulfilled by another supplier (e.g. Golden).
 * Drives warehouseStockHint=GOLDEN so StockX auto-link is skipped and ops sees BUY GLD.
 */

export type GalaxusBuySourceOverride = {
  /** Warehouse hint surfaced on the order line. */
  hint: "GOLDEN";
  /** Listed SupplierVariant.supplierVariantId receiving live source quantity. */
  listingSupplierVariantId: string;
  /** SupplierVariant.supplierVariantId to buy from (e.g. golden:926). */
  buySupplierVariantId: string;
  /** Optional GLD provider key for display. */
  buyProviderKey?: string;
  /** Human note for ops UI. */
  note: string;
  /** Fallback buy CHF if DB lookup unavailable. */
  buyPriceChfFallback?: number;
};

/**
 * Keyed by Galaxus listing ProviderKey (STX_…) and/or GTIN digits.
 * AF1 Low '07 White — sell on KickDB EAN, buy from Golden CW2288-111.
 */
const BY_PROVIDER_KEY: Record<string, GalaxusBuySourceOverride> = {
  STX_0194500874923: {
    hint: "GOLDEN",
    listingSupplierVariantId: "stx_af1w_0194500874923",
    buySupplierVariantId: "golden:926",
    buyProviderKey: "GLD_2008596300076",
    note: "AF1 White EU41 — buy Golden (CW2288-111), not StockX",
    buyPriceChfFallback: 69.5,
  },
  STX_0194500874947: {
    hint: "GOLDEN",
    listingSupplierVariantId: "stx_eb667426-c617-4b12-950b-fbbe52c14538",
    buySupplierVariantId: "golden:924",
    buyProviderKey: "GLD_2460001729979",
    note: "AF1 White EU42.5 — buy Golden (CW2288-111), not StockX",
    buyPriceChfFallback: 69.5,
  },
  STX_0194500874961: {
    hint: "GOLDEN",
    listingSupplierVariantId: "stx_134d6624-4683-4733-b836-2424eceef480",
    buySupplierVariantId: "golden:922",
    buyProviderKey: "GLD_2460001729993",
    note: "AF1 White EU44 — buy Golden (CW2288-111), not StockX",
    buyPriceChfFallback: 69.5,
  },
  STX_0194500874978: {
    hint: "GOLDEN",
    listingSupplierVariantId: "stx_5635d6cc-68eb-40ae-9dc3-bf16f391733d",
    buySupplierVariantId: "golden:921",
    buyProviderKey: "GLD_2460001730005",
    note: "AF1 White EU44.5 — buy Golden (CW2288-111), not StockX",
    buyPriceChfFallback: 69.5,
  },
};

const BY_GTIN: Record<string, GalaxusBuySourceOverride> = Object.fromEntries(
  Object.entries(BY_PROVIDER_KEY).flatMap(([pk, override]) => {
    const gtin = pk.replace(/^STX_/i, "");
    const stripped = gtin.replace(/^0+/, "");
    return [
      [gtin, override],
      ...(stripped && stripped !== gtin ? [[stripped, override] as const] : []),
    ];
  })
) as Record<string, GalaxusBuySourceOverride>;

function normKey(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function normGtin(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/\D/g, "");
}

export function resolveGalaxusBuySourceOverride(line: {
  providerKey?: string | null;
  supplierPid?: string | null;
  gtin?: string | null;
  offerSupplierSku?: string | null;
}): GalaxusBuySourceOverride | null {
  const pk = normKey(line.providerKey) || normKey(line.supplierPid) || normKey(line.offerSupplierSku);
  if (pk && BY_PROVIDER_KEY[pk]) return BY_PROVIDER_KEY[pk]!;

  const gtin = normGtin(line.gtin);
  if (gtin && BY_GTIN[gtin]) return BY_GTIN[gtin]!;
  // also try without leading zeros
  const stripped = gtin.replace(/^0+/, "");
  if (stripped && BY_GTIN[stripped]) return BY_GTIN[stripped]!;

  return null;
}

export function listGalaxusBuySourceOverrides(): Array<{
  providerKey: string;
  override: GalaxusBuySourceOverride;
}> {
  return Object.entries(BY_PROVIDER_KEY).map(([providerKey, override]) => ({
    providerKey,
    override,
  }));
}

/**
 * Copy current buy-source quantity into locked marketplace listings.
 * Listing price and lock stay untouched; only manualStock moves.
 */
export function buildBuySourceOverrideStockUpdates(
  stockByBuySupplierVariantId: ReadonlyMap<string, number | null | undefined>
): Array<{ listingSupplierVariantId: string; manualStock: number }> {
  const updates: Array<{ listingSupplierVariantId: string; manualStock: number }> = [];
  for (const { override } of listGalaxusBuySourceOverrides()) {
    const rawStock = stockByBuySupplierVariantId.get(override.buySupplierVariantId);
    if (!Number.isFinite(rawStock)) continue;
    updates.push({
      listingSupplierVariantId: override.listingSupplierVariantId,
      manualStock: Math.max(0, Math.trunc(rawStock!)),
    });
  }
  return updates;
}
