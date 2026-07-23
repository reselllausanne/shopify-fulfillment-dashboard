import { calcSuggestedRetailFromStxOffer } from "@/galaxus/pricing/suggestedSellPrice";

const DEFAULT_PHYSICAL_RAW_CHF = Number(process.env.PHYSICAL_IMPORT_STOCKX_RAW_CHF ?? "80");

function cleanGtin(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "").trim();
}

/** GTIN compare tolerant to leading zeros (UPC-A vs EAN-13). */
export function gtinDigitsEqual(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const da = cleanGtin(a).replace(/^0+/, "");
  const db = cleanGtin(b).replace(/^0+/, "");
  return Boolean(da) && da === db;
}

export function pickTraitValue(traits: unknown[], names: string[]): string | null {
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  for (const row of traits) {
    const t = row as Record<string, unknown>;
    const key = String(t?.name ?? t?.trait ?? t?.key ?? "").toLowerCase();
    if (!wanted.has(key)) continue;
    const val = t?.value ?? t?.val;
    if (val == null) continue;
    const s = String(val).trim();
    if (s) return s;
  }
  return null;
}

/**
 * When StockX has no asks, estimate a raw ask from retail trait so calc_sell_price
 * can still run for physical-only intake.
 */
export function pickPhysicalImportStockxRaw(input: {
  traits?: unknown[];
  product?: Record<string, unknown> | null;
}): number {
  const traits = input.traits ?? [];
  const retailRaw = pickTraitValue(traits, ["retail price", "rrp", "msrp"]);
  const retail = retailRaw ? Number(retailRaw) : NaN;
  if (Number.isFinite(retail) && retail > 0) {
    // Conservative: retail ~ 2.2× raw ask for sneakers (calibration band).
    return Math.max(40, Math.round((retail / 2.2) * 100) / 100);
  }
  const fromProduct = Number(input.product?.retail_price ?? input.product?.retailPrice);
  if (Number.isFinite(fromProduct) && fromProduct > 0) {
    return Math.max(40, Math.round((fromProduct / 2.2) * 100) / 100);
  }
  if (Number.isFinite(DEFAULT_PHYSICAL_RAW_CHF) && DEFAULT_PHYSICAL_RAW_CHF > 0) {
    return DEFAULT_PHYSICAL_RAW_CHF;
  }
  return 80;
}

export function buildPhysicalOnlySelectedOffer(stockxRaw: number): {
  deliveryType: "standard";
  price: number;
  asks: number;
} {
  return {
    deliveryType: "standard",
    price: stockxRaw,
    asks: 0,
  };
}

export function calcSuggestedRetailForPhysicalRaw(input: {
  stockxRaw: number;
  productHandle?: string | null;
  productName?: string | null;
}): number | null {
  return calcSuggestedRetailFromStxOffer({
    stockxRaw: input.stockxRaw,
    productHandle: input.productHandle,
    productName: input.productName,
    deliveryType: "standard",
  });
}
