/** Reichelt CH (Suisse / DPD) shipping tiers — EUR, from /shop/service/-12_28 */
export const REICHELT_CH_SHIPPING_TIERS_EUR: Array<{ maxKg: number; priceEur: number }> = [
  { maxKg: 10, priceEur: 10.21 },
  { maxKg: 20, priceEur: 15.59 },
  { maxKg: 30, priceEur: 18.81 },
  { maxKg: 40, priceEur: 24.19 },
  { maxKg: 50, priceEur: 29.56 },
];

export const REICHELT_CH_SHIPPING_EXTRA_EUR_PER_10KG = 5.91;

/** Parcel-tier ceiling used when scraped weight is absurd / freight-only. */
export const REICHELT_MAX_SHIP_WEIGHT_GRAMS_DEFAULT = 50_000;

/**
 * Reichelt often mislabels grams as kg on the bare "Poids/Gewicht" row
 * (webcam "121 kg", keyboard "425 kg"). Integers in this band are treated as grams.
 */
export const REICHELT_MISLABEL_KG_AS_GRAMS_MAX = 500;

export type ReicheltLandedCost = {
  productChf: number;
  productPriceSource: "chf_paren" | "eur_converted" | "eur_converted_with_vat";
  shippingEur: number;
  shippingChf: number;
  landedChf: number;
  marginPercent: number;
  sellPriceChf: number;
  weightGrams: number;
  /** Raw scrape before packaging preference / absurd-kg sanitization. */
  rawWeightGrams: number | null;
  weightSource: "packaging" | "generic" | "default" | "capped" | "mislabeled_g";
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
    maxShipWeightGrams: Math.max(
      1000,
      Number(process.env.SCRAPER_REI_MAX_SHIP_WEIGHT_GRAMS || REICHELT_MAX_SHIP_WEIGHT_GRAMS_DEFAULT)
    ),
    /** Below this product CHF, weight above maxShip is treated as scrape garbage → default. */
    absurdWeightProductChfMax: Math.max(
      0,
      Number(process.env.SCRAPER_REI_ABSURD_WEIGHT_PRODUCT_CHF || 500)
    ),
    applyVatOnEurFallback: String(process.env.SCRAPER_REI_EUR_FALLBACK_ADD_VAT ?? "1") !== "0",
  };
}

type WeightHit = {
  grams: number;
  raw: number;
  unit: "kg" | "g";
  kind: "packaging" | "generic";
};

function parseWeightNumber(raw: string): number | null {
  const n = Number.parseFloat(String(raw).replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function toGrams(raw: number, unit: string): number {
  const u = unit.toLowerCase();
  return u.startsWith("k") ? Math.round(raw * 1000) : Math.round(raw);
}

function collectWeightHits(html: string): WeightHit[] {
  const hits: WeightHit[] = [];
  const packagingPatterns: RegExp[] = [
    /(?:Poids\s+de\s+l['’]emballage|Versandgewicht|Shipping weight|Packaging weight|Poids d['’]envoi|Packungsgewicht|Gewicht\s*\(Verpackung\))[^<]{0,40}<\/[^>]+>\s*<[^>]+>\s*([\d.,]+)\s*(kg|g)\b/gi,
    /<li>(?:Poids\s+de\s+l['’]emballage|Versandgewicht|Packaging weight|Packungsgewicht)[^<]*<\/li>\s*<li>\s*([\d.,]+)\s*(kg|g)\b/gi,
  ];
  const genericPatterns: RegExp[] = [
    /(?:Gewicht|Poids)(?!\s+de\s+l['’]emballage)[^<]{0,40}<\/[^>]+>\s*<[^>]+>\s*([\d.,]+)\s*(kg|g)\b/gi,
    /<li>(?:Gewicht|Poids)(?!\s+de\s+l['’]emballage)[^<]*<\/li>\s*<li>\s*([\d.,]+)\s*(kg|g)\b/gi,
    /itemprop="weight"[^>]*content="([\d.]+)\s*(KG|G)?"/gi,
  ];

  for (const pattern of packagingPatterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) != null) {
      const raw = parseWeightNumber(match[1] ?? "");
      if (raw == null) continue;
      const unit = String(match[2] ?? "g").toLowerCase().startsWith("k") ? "kg" : "g";
      const grams = toGrams(raw, unit);
      if (grams > 0 && grams <= 500_000) hits.push({ grams, raw, unit, kind: "packaging" });
    }
  }
  for (const pattern of genericPatterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) != null) {
      const raw = parseWeightNumber(match[1] ?? "");
      if (raw == null) continue;
      const unitRaw = String(match[2] ?? "g");
      const unit = unitRaw.toLowerCase().startsWith("k") ? "kg" : "g";
      let grams = toGrams(raw, unit);
      // Webcam "121 kg", keyboard "425 kg" — grams mislabeled as kg.
      if (
        unit === "kg" &&
        raw >= 30 &&
        raw <= REICHELT_MISLABEL_KG_AS_GRAMS_MAX &&
        Number.isInteger(raw)
      ) {
        grams = Math.round(raw);
        hits.push({ grams, raw, unit, kind: "generic" });
        continue;
      }
      if (grams > 0 && grams <= 500_000) hits.push({ grams, raw, unit, kind: "generic" });
    }
  }
  return hits;
}

/**
 * Prefer packaging / shipping weight. Bare Poids/Gewicht with absurd kg is
 * either mislabeled grams (≤500) or rejected (caller uses default).
 */
export function extractReicheltWeightGrams(html: string): number | null {
  const hits = collectWeightHits(html);
  const packaging = hits.find((h) => h.kind === "packaging");
  if (packaging) return packaging.grams;

  const generic = hits.find((h) => h.kind === "generic");
  if (!generic) return null;

  // Still absurd after mislabel fix (e.g. real 80 kg with no packaging row) — keep.
  // Extreme bare kg with no packaging and >500 raw already kept as kg*1000 above.
  if (generic.unit === "kg" && generic.raw > REICHELT_MISLABEL_KG_AS_GRAMS_MAX && generic.grams > 50_000) {
    // Keep — sanitizeReicheltShipWeightGrams will cap / default by product price.
    return generic.grams;
  }
  return generic.grams;
}

/** Resolve ship weight used for DPD tiers (never infinite freight from scrape bugs). */
export function sanitizeReicheltShipWeightGrams(input: {
  weightGrams: number | null | undefined;
  productChf: number;
}): { weightGrams: number; weightSource: ReicheltLandedCost["weightSource"]; rawWeightGrams: number | null } {
  const cfg = reicheltPricingConfig();
  const raw =
    input.weightGrams != null && Number.isFinite(input.weightGrams) && input.weightGrams > 0
      ? Math.round(input.weightGrams)
      : null;

  if (raw == null) {
    return { weightGrams: cfg.defaultWeightGrams, weightSource: "default", rawWeightGrams: null };
  }

  if (raw > cfg.maxShipWeightGrams) {
    // 200kg+ on a sub-CHF500 SKU is almost always grams-mislabeled-as-kg (keyboard 425kg).
    if (input.productChf < cfg.absurdWeightProductChfMax && raw >= 200_000) {
      return { weightGrams: cfg.defaultWeightGrams, weightSource: "default", rawWeightGrams: raw };
    }
    // 50–200kg: cap at parcel ceiling (gaming chair 150kg scrape, tool chests, etc.).
    return { weightGrams: cfg.maxShipWeightGrams, weightSource: "capped", rawWeightGrams: raw };
  }

  return {
    weightGrams: raw,
    weightSource: raw <= REICHELT_MISLABEL_KG_AS_GRAMS_MAX && raw === Math.round(raw) ? "mislabeled_g" : "generic",
    rawWeightGrams: raw,
  };
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
  /** When known, marks packaging preference in weightSource. */
  weightKind?: "packaging" | "generic" | null;
}): ReicheltLandedCost | null {
  const cfg = reicheltPricingConfig();
  const resolved = resolveReicheltProductChf({
    priceChf: input.priceChf,
    priceEur: input.priceEur,
  });
  if (!resolved) return null;

  const sanitized = sanitizeReicheltShipWeightGrams({
    weightGrams: input.weightGrams,
    productChf: resolved.productChf,
  });
  let weightSource = sanitized.weightSource;
  if (input.weightKind === "packaging" && sanitized.weightSource !== "default" && sanitized.weightSource !== "capped") {
    weightSource = "packaging";
  } else if (
    input.weightGrams != null &&
    input.weightGrams <= REICHELT_MISLABEL_KG_AS_GRAMS_MAX &&
    sanitized.rawWeightGrams === sanitized.weightGrams &&
    sanitized.weightSource === "generic"
  ) {
    // extract already converted mislabeled kg→g
    weightSource = "mislabeled_g";
  }

  const shippingEur = computeReicheltShippingEur(sanitized.weightGrams);
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
    weightGrams: sanitized.weightGrams,
    rawWeightGrams: sanitized.rawWeightGrams,
    weightSource,
    eurChfRate: resolved.eurChfRate,
    vatRate: cfg.vatRate,
    priceEur: input.priceEur,
    rawPriceChf: input.priceChf,
  };
}

export function isPlausibleReicheltSellPrice(cost: ReicheltLandedCost): boolean {
  if (!Number.isFinite(cost.sellPriceChf) || cost.sellPriceChf <= 0) return false;
  if (cost.priceEur != null && cost.priceEur >= 100 && cost.productChf < cost.priceEur * 0.05) return false;
  if (cost.rawPriceChf != null && cost.priceEur != null && cost.rawPriceChf < cost.priceEur * 0.05) return false;
  if (cost.sellPriceChf > 100_000) return false;
  return true;
}
