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

/** Swiss Post Sperrgut: longest side > 100 cm. */
export const REICHELT_BULKY_LONGEST_SIDE_MM_DEFAULT = 1000;

/**
 * Customer-facing encombrant add-on (after margin, not ×1.3).
 * Inbound DPD ~9.80 is free margin on bulk buys. Bake 5 only on long SKUs.
 */
export const REICHELT_BULKY_SURCHARGE_CHF_DEFAULT = 5;

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
  /** Longest rigid side in mm (tech table + title). Null if unknown / flexible cable. */
  longestSideMm: number | null;
  bulkySurchargeChf: number;
  bulky: boolean;
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
    bulkyLongestSideMm: Math.max(
      100,
      Number(process.env.SCRAPER_REI_BULKY_LONGEST_SIDE_MM || REICHELT_BULKY_LONGEST_SIDE_MM_DEFAULT)
    ),
    bulkySurchargeChf: Math.max(
      0,
      Number(process.env.SCRAPER_REI_BULKY_SURCHARGE_CHF || REICHELT_BULKY_SURCHARGE_CHF_DEFAULT)
    ),
  };
}

const REICHELT_DIM_NAME =
  /^(longueur|length|l[äa]nge|laenge|h[oö]he|hoehe|height|hauteur|breite|width|largeur|tiefe|depth|profondeur)$/i;
const REICHELT_DIM_SKIP_NAME = /ø|durchmesser|diameter|diam[eè]tre|cable.?length|longueur du c[aâ]ble/i;
const REICHELT_FLEXIBLE_LENGTH =
  /c[aâ]ble|kabel|hdmi|usb|rj-?45|ethernet|patchcord|rallonge|verl[äa]nger|schlauch|tuyau|\bhose\b|bande(?:\s+\w+){0,2}\s*led|led[- ]?strip|maxled|film|folie|\blitze\b/i;
const REICHELT_RIGID_LONG =
  /tube|r[oö]hre|n[eé]on|leiste|wannen|aquaprofi|\bt8\b|\bt5\b|rail|profil[eé]?|antenne|antenna|r[eé]glette|lin[eé]aire|feuchtraum|damp[- ]?proof|submarine/i;

export type ReicheltTechDim = { name: string; value: string };

function normalizeReicheltMm(mm: number): number | null {
  let value = mm;
  // Reichelt FR titles: 12000 for 1200 mm tubes
  if (value >= 6000 && value <= 20000 && value % 10 === 0) {
    const fixed = value / 10;
    if (fixed >= 300 && fixed <= 2000) value = fixed;
  }
  if (value < 50 || value > 5000) return null;
  return Math.round(value);
}

/** Parse "1200 mm" / "1 500 mm" / "120 cm" / "1,2 m". */
export function parseReicheltDimensionToMm(raw: string): number | null {
  const s = String(raw ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/'/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;

  const mmMatch = s.match(/^(\d{1,3}(?:[ ]\d{3})+|\d{3,5})\s*mm\b/i);
  if (mmMatch) {
    const n = Number(mmMatch[1].replace(/ /g, ""));
    return Number.isFinite(n) ? normalizeReicheltMm(n) : null;
  }

  const cmMatch = s.match(/^(\d{2,3})\s*cm\b/i);
  if (cmMatch) {
    const cm = Number(cmMatch[1]);
    if (Number.isFinite(cm) && cm >= 10 && cm <= 400) return cm * 10;
  }

  const mMatch = s.match(/^(\d+(?:[.,]\d+)?)\s*m\b/i);
  if (mMatch) {
    const meters = Number(mMatch[1].replace(",", "."));
    if (Number.isFinite(meters) && meters >= 0.5 && meters <= 5) return Math.round(meters * 1000);
  }
  return null;
}

function collectTitleDimensionMm(title: string, allowMeters: boolean): number[] {
  const t = String(title ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ");
  const out: number[] = [];
  for (const match of t.matchAll(/(\d{1,3}(?:[ ]\d{3})+|\d{3,5})\s*mm\b/gi)) {
    const n = Number(match[1].replace(/ /g, ""));
    const mm = Number.isFinite(n) ? normalizeReicheltMm(n) : null;
    if (mm != null) out.push(mm);
  }
  for (const match of t.matchAll(/(?<![\d,.])(\d{2,3})\s*cm\b/gi)) {
    const cm = Number(match[1]);
    if (Number.isFinite(cm) && cm >= 10 && cm <= 400) out.push(cm * 10);
  }
  if (allowMeters) {
    for (const match of t.matchAll(/(\d[,.]\d)\s*m\b/gi)) {
      const meters = Number(match[1].replace(",", "."));
      if (Number.isFinite(meters) && meters >= 0.5 && meters <= 5) out.push(Math.round(meters * 1000));
    }
  }
  return out;
}

export function longestSideMmFromTechAttributes(attrs: ReicheltTechDim[] | null | undefined): number | null {
  let max: number | null = null;
  for (const attr of attrs ?? []) {
    const name = String(attr.name ?? "").trim();
    if (!name || REICHELT_DIM_SKIP_NAME.test(name) || !REICHELT_DIM_NAME.test(name)) continue;
    const mm = parseReicheltDimensionToMm(attr.value);
    if (mm == null) continue;
    if (max == null || mm > max) max = mm;
  }
  return max;
}

/**
 * Longest rigid side. Drops coiled cable / strip lengths (not Sperrgut).
 */
export function resolveReicheltLongestSideMm(input: {
  title?: string | null;
  techAttributes?: ReicheltTechDim[] | null;
  breadcrumbs?: string[] | null;
}): { longestSideMm: number | null; bulky: boolean } {
  const title = String(input.title ?? "");
  const blob = [title, ...(input.breadcrumbs ?? [])].join(" ");
  const flexible = REICHELT_FLEXIBLE_LENGTH.test(blob);
  const rigid = REICHELT_RIGID_LONG.test(blob);
  const fromTech = longestSideMmFromTechAttributes(input.techAttributes);
  const fromTitle = collectTitleDimensionMm(title, rigid);
  const titleMax = fromTitle.length ? Math.max(...fromTitle) : null;
  let longestSideMm: number | null = null;
  for (const value of [fromTech, titleMax]) {
    if (value == null) continue;
    if (longestSideMm == null || value > longestSideMm) longestSideMm = value;
  }
  if (longestSideMm == null) return { longestSideMm: null, bulky: false };
  if (flexible && !rigid) return { longestSideMm: null, bulky: false };
  // 3m+ with no tube/fixture keyword = reel / coil, not a 3m carton.
  if (!rigid && longestSideMm > 2500) return { longestSideMm: null, bulky: false };
  const threshold = reicheltPricingConfig().bulkyLongestSideMm;
  return { longestSideMm, bulky: longestSideMm >= threshold };
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

/** Landed buy = product CHF + Reichelt DPD (weight). Sell = landed × (1 + margin%) + encombrant. */
export function computeReicheltLandedCost(input: {
  priceChf: number | null;
  priceEur: number | null;
  weightGrams: number | null;
  marginPercent?: number;
  /** When known, marks packaging preference in weightSource. */
  weightKind?: "packaging" | "generic" | null;
  title?: string | null;
  techAttributes?: ReicheltTechDim[] | null;
  breadcrumbs?: string[] | null;
  longestSideMm?: number | null;
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
  const dims =
    input.longestSideMm != null && Number.isFinite(input.longestSideMm)
      ? { longestSideMm: Math.round(input.longestSideMm), bulky: input.longestSideMm >= cfg.bulkyLongestSideMm }
      : resolveReicheltLongestSideMm({
          title: input.title,
          techAttributes: input.techAttributes,
          breadcrumbs: input.breadcrumbs,
        });
  const bulkySurchargeChf = dims.bulky ? roundChf(cfg.bulkySurchargeChf) : 0;
  const sellPriceChf = roundChf(landedChf * (1 + marginPercent / 100) + bulkySurchargeChf);

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
    longestSideMm: dims.longestSideMm,
    bulkySurchargeChf,
    bulky: dims.bulky,
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
