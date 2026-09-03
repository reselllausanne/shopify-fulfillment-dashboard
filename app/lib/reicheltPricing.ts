/** Reichelt CH (Suisse / DPD) shipping tiers — EUR, from /shop/service/-12_28 */
export const REICHELT_CH_SHIPPING_TIERS_EUR: Array<{ maxKg: number; priceEur: number }> = [
  { maxKg: 10, priceEur: 10.21 },
  { maxKg: 20, priceEur: 15.59 },
  { maxKg: 30, priceEur: 18.81 },
  { maxKg: 40, priceEur: 24.19 },
  { maxKg: 50, priceEur: 29.56 },
];

export const REICHELT_CH_SHIPPING_EXTRA_EUR_PER_10KG = 5.91;

export type ReicheltLandedCost = {
  productChf: number;
  productPriceSource: "chf_paren" | "eur_converted" | "eur_converted_with_vat";
  shippingEur: number;
  shippingChf: number;
  landedChf: number;
  marginPercent: number;
  sellPriceChf: number;
  weightGrams: number;
  eurChfRate: number;
  vatRate: number;
  priceEur: number | null;
  rawPriceChf: number | null;
};

export function reicheltPricingConfig() {
  return {
    marginPercent: Math.max(0, Number(process.env.SCRAPER_REI_MARGIN_PERCENT || 30)),
    eurChfRate: Math.max(0.01, Number(process.env.SCRAPER_REI_EUR_CHF_RATE || 0.96)),
    vatRate: Math.max(0, Number(process.env.SCRAPER_REI_VAT_RATE || 0.081)),
    defaultWeightGrams: Math.max(1, Number(process.env.SCRAPER_REI_DEFAULT_WEIGHT_GRAMS || 500)),
    applyVatOnEurFallback: String(process.env.SCRAPER_REI_EUR_FALLBACK_ADD_VAT ?? "1") !== "0",
  };
}

export function extractReicheltWeightGrams(html: string): number | null {
  const patterns: RegExp[] = [
    /(?:Gewicht|Poids(?:\s+de\s+l['’]emballage)?|Versandgewicht|Shipping weight|Packaging weight|Poids d['’]envoi)[^<]{0,40}<\/[^>]+>\s*<[^>]+>\s*([\d.,]+)\s*(kg|g)\b/i,
    /<li>(?:Gewicht|Poids(?:\s+de\s+l['’]emballage)?|Versandgewicht)[^<]*<\/li>\s*<li>\s*([\d.,]+)\s*(kg|g)\b/i,
    /itemprop="weight"[^>]*content="([\d.]+)\s*(KG|G)?"/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) continue;
    const raw = Number.parseFloat(String(match[1]).replace(",", "."));
    if (!Number.isFinite(raw) || raw <= 0) continue;
    const unit = String(match[2] ?? "g").toLowerCase();
    const grams = unit.startsWith("k") ? Math.round(raw * 1000) : Math.round(raw);
    if (grams > 0 && grams <= 500_000) return grams;
  }
  return null;
}

export function computeReicheltShippingEur(weightGrams: number): number {
  const kg = Math.max(0.001, weightGrams / 1000);
  for (const tier of REICHELT_CH_SHIPPING_TIERS_EUR) {
    if (kg <= tier.maxKg) return tier.priceEur;
  }
  const top = REICHELT_CH_SHIPPING_TIERS_EUR[REICHELT_CH_SHIPPING_TIERS_EUR.length - 1];
  const extraKg = kg - top.maxKg;
  const extraBlocks = Math.ceil(extraKg / 10);
  return top.priceEur + extraBlocks * REICHELT_CH_SHIPPING_EXTRA_EUR_PER_10KG;
}

function roundChf(value: number): number {
  return Math.round(value * 100) / 100;
}

function inferEurChfRate(priceEur: number | null, priceChf: number | null, fallback: number): number {
  if (priceEur != null && priceChf != null && priceEur > 0 && priceChf > 0) {
    const ratio = priceChf / priceEur;
    if (ratio >= 0.5 && ratio <= 1.5) return ratio;
  }
  return fallback;
}

export function resolveReicheltProductChf(input: {
  priceChf: number | null;
  priceEur: number | null;
  eurChfRate?: number;
  vatRate?: number;
  applyVatOnEurFallback?: boolean;
}): { productChf: number; source: ReicheltLandedCost["productPriceSource"]; eurChfRate: number } | null {
  const cfg = reicheltPricingConfig();
  const vatRate = input.vatRate ?? cfg.vatRate;
  const applyVat = input.applyVatOnEurFallback ?? cfg.applyVatOnEurFallback;
  const eurChfRate = inferEurChfRate(input.priceEur, input.priceChf, input.eurChfRate ?? cfg.eurChfRate);

  if (input.priceChf != null && input.priceChf > 0) {
    return { productChf: roundChf(input.priceChf), source: "chf_paren", eurChfRate };
  }
  if (input.priceEur == null || input.priceEur <= 0) return null;

  const converted = input.priceEur * eurChfRate;
  if (applyVat) {
    return {
      productChf: roundChf(converted * (1 + vatRate)),
      source: "eur_converted_with_vat",
      eurChfRate,
    };
  }
  return { productChf: roundChf(converted), source: "eur_converted", eurChfRate };
}

/** Landed buy = product CHF + shipping CHF; DB price = landed × (1 + margin%). */
export function computeReicheltLandedCost(input: {
  priceChf: number | null;
  priceEur: number | null;
  weightGrams: number | null;
  marginPercent?: number;
}): ReicheltLandedCost | null {
  const cfg = reicheltPricingConfig();
  const resolved = resolveReicheltProductChf({
    priceChf: input.priceChf,
    priceEur: input.priceEur,
  });
  if (!resolved) return null;

  const weightGrams = input.weightGrams && input.weightGrams > 0 ? input.weightGrams : cfg.defaultWeightGrams;
  const shippingEur = computeReicheltShippingEur(weightGrams);
  const shippingChf = roundChf(shippingEur * resolved.eurChfRate);
  const landedChf = roundChf(resolved.productChf + shippingChf);
  const marginPercent = input.marginPercent ?? cfg.marginPercent;
  const sellPriceChf = roundChf(landedChf * (1 + marginPercent / 100));

  return {
    productChf: resolved.productChf,
    productPriceSource: resolved.source,
    shippingEur,
    shippingChf,
    landedChf,
    marginPercent,
    sellPriceChf,
    weightGrams,
    eurChfRate: resolved.eurChfRate,
    vatRate: cfg.vatRate,
    priceEur: input.priceEur,
    rawPriceChf: input.priceChf,
  };
}

export function isPlausibleReicheltSellPrice(cost: ReicheltLandedCost): boolean {
  if (!Number.isFinite(cost.sellPriceChf) || cost.sellPriceChf <= 0) return false;
  // CHF/EUR ~0.90–1.05. Product CHF below 50% of EUR → thousands-separator parse artifact
  // (regression: "1 300.59 CHF" captured as "300.59"). Guard applies at every price magnitude.
  if (cost.priceEur != null && cost.priceEur > 0 && cost.productChf < cost.priceEur * 0.5) return false;
  if (cost.rawPriceChf != null && cost.priceEur != null && cost.rawPriceChf < cost.priceEur * 0.5) return false;
  if (cost.sellPriceChf > 100_000) return false;
  return true;
}
