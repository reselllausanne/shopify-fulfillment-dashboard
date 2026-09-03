type PricingInput = {
  buyPriceExVatCHF: number;
  shippingPerPairCHF?: number;
  targetNetMargin?: number;
  bufferPerPairCHF?: number;
  roundTo?: number;
  vatRate?: number;
};

export type PricingOverrides = {
  targetMargin?: number | null;
  shippingPerPair?: number | null;
  bufferPerPair?: number | null;
  roundTo?: number | null;
  vatRate?: number | null;
};

/** Outbound bulk ship per pair (STX Galaxus feed). StockX inbound ship is already in variant.price. */
const DEFAULT_SHIPPING = 2;
/**
 * STX express / direct-delivery lanes: Galaxus reimburses ~6 CHF ship/colis;
 * remaining pack+fulfill gap to bake into sell ≈ 9 CHF (vs DEFAULT_SHIPPING 2).
 */
const STX_DIRECT_DELIVERY_SHIPPING = 9;
const DEFAULT_TARGET_MARGIN = 0.12;
const DEFAULT_BUFFER = 0;
const DEFAULT_ROUND_TO = 0.05;
const DEFAULT_VAT_RATE = 0.081;
const DEFAULT_TARGET_MARGIN_KEYS = [
  "GALAXUS_TARGET_MARGIN",
  "GALAXUS_TARGET_NET_MARGIN",
  "GALAXUS_PRICE_TARGET_MARGIN",
];
const STX_TARGET_MARGIN_KEYS = ["GALAXUS_STX_TARGET_NET_MARGIN", "GALAXUS_STX_TARGET_MARGIN"];
const STX_MARGIN_ADJUSTMENT_KEYS = ["GALAXUS_STX_MARGIN_ADJUSTMENT", "GALAXUS_STX_TARGET_MARGIN_ADJUSTMENT"];
const DEFAULT_SHIPPING_KEYS = ["GALAXUS_PRICE_SHIPPING_CHF", "GALAXUS_SHIPPING_CHF"];
const STX_DD_SHIPPING_KEYS = [
  "GALAXUS_STX_DD_SHIPPING_CHF",
  "GALAXUS_STX_DIRECT_DELIVERY_SHIPPING_CHF",
];
/** Flat ex-VAT surcharge on every STX Galaxus sell (next feed send). Set env to 0 to disable. */
const STX_PRICE_BUMP_KEYS = ["GALAXUS_STX_PRICE_BUMP_CHF", "GALAXUS_STX_PRICE_SURCHARGE_CHF"];
const STX_DEFAULT_PRICE_BUMP = 8;
const WEL_SHIPPING_KEYS = ["GALAXUS_WEL_SHIPPING_CHF", "GALAXUS_WEL_PRICE_SHIPPING_CHF"];
const WEL_TARGET_MARGIN_KEYS = ["GALAXUS_WEL_TARGET_NET_MARGIN", "GALAXUS_WEL_TARGET_MARGIN"];
const WEL_BUFFER_KEYS = ["GALAXUS_WEL_BUFFER_CHF", "GALAXUS_WEL_PRICE_BUFFER_CHF"];
const BWZ_TARGET_MARGIN_KEYS = ["GALAXUS_BWZ_TARGET_NET_MARGIN", "GALAXUS_BWZ_TARGET_MARGIN"];
const DEFAULT_BUFFER_KEYS = ["GALAXUS_PRICE_BUFFER_CHF", "GALAXUS_BUFFER_CHF"];
const DEFAULT_ROUND_TO_KEYS = ["GALAXUS_PRICE_ROUND_TO", "GALAXUS_ROUND_TO"];
const DEFAULT_VAT_RATE_KEYS = ["GALAXUS_PRICE_VAT_RATE", "GALAXUS_VAT_RATE"];
const WEL_DEFAULT_SHIPPING = 7;
/** WellPlayed own-catalog: at least 15% net + CHF 1 fixed buffer. */
const WEL_DEFAULT_TARGET_MARGIN = 0.15;
const WEL_DEFAULT_BUFFER = 1;
/** baby-walz.ch catalog: at least 15% net (default ship/buffer). */
const BWZ_DEFAULT_TARGET_MARGIN = 0.15;

function roundUpToIncrement(value: number, increment: number): number {
  if (increment <= 0) return value;
  const scale = 1 / increment;
  return Math.ceil((value + 1e-12) * scale) / scale;
}

function readNumberEnv(keys: string[], fallback: number): number {
  for (const key of keys) {
    const raw = process.env[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const parsed = Number.parseFloat(String(raw));
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function getDefaultPricing() {
  return {
    targetMargin: readNumberEnv(DEFAULT_TARGET_MARGIN_KEYS, DEFAULT_TARGET_MARGIN),
    shippingPerPair: readNumberEnv(DEFAULT_SHIPPING_KEYS, DEFAULT_SHIPPING),
    bufferPerPair: readNumberEnv(DEFAULT_BUFFER_KEYS, DEFAULT_BUFFER),
    roundTo: readNumberEnv(DEFAULT_ROUND_TO_KEYS, DEFAULT_ROUND_TO),
    vatRate: readNumberEnv(DEFAULT_VAT_RATE_KEYS, DEFAULT_VAT_RATE),
  };
}

export function resolvePricingOverrides(overrides?: PricingOverrides | null) {
  const defaults = getDefaultPricing();
  const normalizePercent = (value: number) => (value > 1 ? value / 100 : value);
  const isValidTarget = (value: number) => Number.isFinite(value) && value > 0 && value < 0.5;
  const isValidNonNegative = (value: number) => Number.isFinite(value) && value >= 0;
  const isValidPositive = (value: number) => Number.isFinite(value) && value > 0;
  return {
    targetMargin:
      overrides?.targetMargin !== null && overrides?.targetMargin !== undefined
        ? (() => {
            const value = normalizePercent(overrides.targetMargin);
            return isValidTarget(value) ? value : defaults.targetMargin;
          })()
        : defaults.targetMargin,
    shippingPerPair:
      overrides?.shippingPerPair !== null && overrides?.shippingPerPair !== undefined
        ? (isValidNonNegative(overrides.shippingPerPair) ? overrides.shippingPerPair : defaults.shippingPerPair)
        : defaults.shippingPerPair,
    bufferPerPair:
      overrides?.bufferPerPair !== null && overrides?.bufferPerPair !== undefined
        ? (isValidNonNegative(overrides.bufferPerPair) ? overrides.bufferPerPair : defaults.bufferPerPair)
        : defaults.bufferPerPair,
    roundTo:
      overrides?.roundTo !== null && overrides?.roundTo !== undefined
        ? (isValidPositive(overrides.roundTo) ? overrides.roundTo : defaults.roundTo)
        : defaults.roundTo,
    vatRate:
      overrides?.vatRate !== null && overrides?.vatRate !== undefined
        ? (() => {
            const value = normalizePercent(overrides.vatRate);
            return isValidNonNegative(value) ? value : defaults.vatRate;
          })()
        : defaults.vatRate,
  };
}

/**
 * Sell ex VAT = DB price as-is (no second uplift).
 * - ner / the: partner buy = sell
 * - rei / wrk / fan / haw / exl / bae / ven / tus: scrapers already store landed×margin shelf
 */
const GALAXUS_ZERO_MARGIN_SUPPLIER_KEYS = new Set([
  "ner",
  "the",
  "rei",
  "wrk",
  "fan",
  "haw",
  "exl",
  "bae",
  "ven",
  "tus",
]);
const GALAXUS_GLD_SUPPLIER_KEYS = new Set(["golden", "gld"]);

/** Golden PL→CH logistics defaults (overridable via env). */
const GLD_DEFAULT_SHIP_EUR = 100;
/** Conservative: amortize ship over 10 pairs (not full 12-box). */
const GLD_DEFAULT_SHIP_PAIRS = 10;
const GLD_DEFAULT_DOUANE_EUR = 20;
const GLD_DEFAULT_DOUANE_PAIRS = 10;
const GLD_DEFAULT_EURCHF = 0.94;
/** Swiss import VAT on (buy + ship). */
const GLD_DEFAULT_IMPORT_VAT = 0.081;
/** Markup on full landed: sell = landed × (1 + markup). */
const GLD_DEFAULT_MARKUP = 0.15;

function normalizeMarginFraction(value: number): number {
  return value > 1 ? value / 100 : value;
}

function isValidTargetMargin(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value < 0.5;
}

export function isStxGalaxusSupplierKey(supplierKey: string | null | undefined): boolean {
  return String(supplierKey ?? "")
    .trim()
    .toLowerCase() === "stx";
}

/** Flat CHF added on top of computed STX Galaxus sell ex VAT (all lanes). Default 8. */
export function resolveStxGalaxusPriceBumpChf(): number {
  const raw = readNumberEnv(STX_PRICE_BUMP_KEYS, STX_DEFAULT_PRICE_BUMP);
  if (!Number.isFinite(raw) || raw < 0) return STX_DEFAULT_PRICE_BUMP;
  return raw;
}

export function isGldGalaxusSupplierKey(supplierKey: string | null | undefined): boolean {
  return GALAXUS_GLD_SUPPLIER_KEYS.has(
    String(supplierKey ?? "")
      .trim()
      .toLowerCase()
  );
}

/**
 * Logistics per pair for Golden (EUR → CHF).
 * Defaults: ship 100€/10 pairs + douane 20€/box÷10 pairs @ EURCHF 0.94.
 */
export function resolveGldLandedExtrasPerPairChf(): {
  shipPerPairChf: number;
  douanePerPairChf: number;
  extrasPerPairChf: number;
} {
  const shipEur = readNumberEnv(["GALAXUS_GLD_SHIP_EUR"], GLD_DEFAULT_SHIP_EUR);
  const shipPairs = Math.max(1, readNumberEnv(["GALAXUS_GLD_SHIP_PAIRS"], GLD_DEFAULT_SHIP_PAIRS));
  const douaneEur = readNumberEnv(["GALAXUS_GLD_DOUANE_EUR"], GLD_DEFAULT_DOUANE_EUR);
  const douanePairs = Math.max(1, readNumberEnv(["GALAXUS_GLD_DOUANE_PAIRS"], GLD_DEFAULT_DOUANE_PAIRS));
  const eurchf = readNumberEnv(["GALAXUS_GLD_EURCHF", "EURCHF"], GLD_DEFAULT_EURCHF);
  const shipPerPairChf = (shipEur / shipPairs) * eurchf;
  const douanePerPairChf = (douaneEur / douanePairs) * eurchf;
  return {
    shipPerPairChf,
    douanePerPairChf,
    /** Ship + douane only (no import VAT — VAT depends on buy). */
    extrasPerPairChf: shipPerPairChf + douanePerPairChf,
  };
}

export function resolveGldImportVatRate(): number {
  const raw = readNumberEnv(
    ["GALAXUS_GLD_IMPORT_VAT", "GALAXUS_PRICE_VAT_RATE", "GALAXUS_VAT_RATE"],
    GLD_DEFAULT_IMPORT_VAT
  );
  const rate = normalizeMarginFraction(raw);
  return Number.isFinite(rate) && rate >= 0 && rate < 0.5 ? rate : GLD_DEFAULT_IMPORT_VAT;
}

/**
 * Full landed CHF per pair:
 * buy + ship + Swiss import VAT on (buy+ship) + douane/box share.
 */
export function resolveGldLandedCostChf(buyPriceChf: number): {
  buyChf: number;
  shipPerPairChf: number;
  importVatChf: number;
  douanePerPairChf: number;
  landedChf: number;
} {
  const { shipPerPairChf, douanePerPairChf } = resolveGldLandedExtrasPerPairChf();
  const vatRate = resolveGldImportVatRate();
  const importVatChf = (buyPriceChf + shipPerPairChf) * vatRate;
  const landedChf = buyPriceChf + shipPerPairChf + importVatChf + douanePerPairChf;
  return { buyChf: buyPriceChf, shipPerPairChf, importVatChf, douanePerPairChf, landedChf };
}

/** GLD markup fraction (0.15 → sell = landed × 1.15). */
export function resolveGldMarkupFraction(): number {
  const raw = readNumberEnv(
    ["GALAXUS_GLD_MARKUP", "GALAXUS_GLD_TARGET_NET_MARGIN", "GALAXUS_GLD_TARGET_MARGIN"],
    GLD_DEFAULT_MARKUP
  );
  const markup = normalizeMarginFraction(raw);
  return isValidTargetMargin(markup) ? markup : GLD_DEFAULT_MARKUP;
}

/** @deprecated Use {@link resolveGldMarkupFraction}. */
export function resolveGldTargetNetMargin(): number {
  return resolveGldMarkupFraction();
}

function isWelGalaxusSupplierKey(supplierKey: string | null): boolean {
  return String(supplierKey ?? "")
    .trim()
    .toLowerCase() === "wel";
}

function isBwzGalaxusSupplierKey(supplierKey: string | null): boolean {
  return String(supplierKey ?? "")
    .trim()
    .toLowerCase() === "bwz";
}

/**
 * STX / WEL / BWZ feed margin: optional explicit override, else default target (+ optional env adjustment).
 * NER/THE/partners use other rules — not this helper.
 */
export function resolveGalaxusTargetNetMarginForSupplier(
  supplierKey: string | null,
  defaultTargetMargin?: number
): number {
  const base = defaultTargetMargin ?? getDefaultPricing().targetMargin;

  if (isWelGalaxusSupplierKey(supplierKey)) {
    const explicitRaw = readNumberEnv(WEL_TARGET_MARGIN_KEYS, Number.NaN);
    if (Number.isFinite(explicitRaw)) {
      const explicit = normalizeMarginFraction(explicitRaw);
      if (isValidTargetMargin(explicit)) return Math.max(explicit, WEL_DEFAULT_TARGET_MARGIN);
    }
    return WEL_DEFAULT_TARGET_MARGIN;
  }

  if (isBwzGalaxusSupplierKey(supplierKey)) {
    const explicitRaw = readNumberEnv(BWZ_TARGET_MARGIN_KEYS, Number.NaN);
    if (Number.isFinite(explicitRaw)) {
      const explicit = normalizeMarginFraction(explicitRaw);
      if (isValidTargetMargin(explicit)) return Math.max(explicit, BWZ_DEFAULT_TARGET_MARGIN);
    }
    return BWZ_DEFAULT_TARGET_MARGIN;
  }

  if (!isStxGalaxusSupplierKey(supplierKey)) return base;

  const explicitRaw = readNumberEnv(STX_TARGET_MARGIN_KEYS, Number.NaN);
  if (Number.isFinite(explicitRaw)) {
    const explicit = normalizeMarginFraction(explicitRaw);
    if (isValidTargetMargin(explicit)) return explicit;
  }

  const adjustment = readNumberEnv(STX_MARGIN_ADJUSTMENT_KEYS, 0);
  const adjusted = base + adjustment;
  if (!isValidTargetMargin(adjusted)) return base;
  return adjusted;
}

function resolveShippingPerPairForSupplier(
  supplierKey: string | null,
  defaultShippingPerPair: number,
  deliveryType?: string | null
): number {
  const key = String(supplierKey ?? "")
    .trim()
    .toLowerCase();
  if (key === "wel") {
    const shipping = readNumberEnv(WEL_SHIPPING_KEYS, WEL_DEFAULT_SHIPPING);
    if (!Number.isFinite(shipping) || shipping < 0) return defaultShippingPerPair;
    return shipping;
  }
  if (isStxGalaxusSupplierKey(supplierKey) && isStxDirectDeliveryLane(deliveryType)) {
    const shipping = readNumberEnv(STX_DD_SHIPPING_KEYS, STX_DIRECT_DELIVERY_SHIPPING);
    if (!Number.isFinite(shipping) || shipping < 0) return STX_DIRECT_DELIVERY_SHIPPING;
    return shipping;
  }
  return defaultShippingPerPair;
}

/**
 * STX express lanes (express_standard / express_expedited / express_shipped) → Galaxus
 * direct delivery. Standard STX dropship is not DD in the stock feed.
 */
export function isStxDirectDeliveryLane(deliveryType?: string | null): boolean {
  const dt = String(deliveryType ?? "")
    .trim()
    .toLowerCase();
  if (!dt) return false;
  if (dt === "express_shipped" || dt === "express_standard" || dt === "express_expedited") {
    return true;
  }
  return dt.startsWith("express");
}

function resolveBufferPerPairForSupplier(
  supplierKey: string | null,
  defaultBufferPerPair: number
): number {
  if (!isWelGalaxusSupplierKey(supplierKey)) return defaultBufferPerPair;
  const buffer = readNumberEnv(WEL_BUFFER_KEYS, WEL_DEFAULT_BUFFER);
  if (!Number.isFinite(buffer) || buffer < 0) return WEL_DEFAULT_BUFFER;
  return Math.max(buffer, WEL_DEFAULT_BUFFER);
}

export type ResolveGalaxusSellOptions = {
  /** SupplierVariant.deliveryType — STX express → higher outbound ship (DD gap). */
  deliveryType?: string | null;
};

/**
 * Galaxus retail feed:
 * - `ner` / `the` = sell ex VAT equals partner buy (0% margin)
 * - `rei` / `wrk` / `fan` / `haw` / `exl` / `bae` / `ven` = scraper shelf already includes
 *   ship + % margin — push DB price as-is (no second Galaxus net-margin pass)
 * - other partners = +10% on buy ex VAT
 * - `golden` / `gld` = (buy + ship + CH import VAT + douane) × 1.15
 * - WEL: (buy + ship + ≥1 CHF buffer) / (1 − ≥15% net), default ship CHF 7
 * - BWZ: (buy + ship) / (1 − ≥15% net), default ship CHF 2 (env GALAXUS_BWZ_TARGET_NET_MARGIN)
 * - STX: (buy + outbound ship) / (1 − target net margin), default 12% + 2 CHF ship
 *   (express / direct-delivery lanes: +9 CHF ship — Galaxus ~6 ship reimbursement gap)
 *   + flat price bump on all STX (default +8 CHF ex VAT, env GALAXUS_STX_PRICE_BUMP_CHF)
 */
export function resolveGalaxusSellExVatForChannel(
  buyPriceExVatCHF: number,
  supplierKey: string | null,
  partnerKeysLower: Set<string>,
  options?: ResolveGalaxusSellOptions
): number {
  const defaults = getDefaultPricing();
  const roundTo = defaults.roundTo;
  const k = supplierKey?.toLowerCase() ?? "";

  if (GALAXUS_ZERO_MARGIN_SUPPLIER_KEYS.has(k)) {
    return roundUpToIncrement(buyPriceExVatCHF, roundTo);
  }
  if (isGldGalaxusSupplierKey(k)) {
    if (!Number.isFinite(buyPriceExVatCHF) || buyPriceExVatCHF <= 0) {
      throw new Error("buyPriceExVatCHF must be > 0");
    }
    const { landedChf } = resolveGldLandedCostChf(buyPriceExVatCHF);
    const markup = resolveGldMarkupFraction();
    return roundUpToIncrement(landedChf * (1 + markup), roundTo);
  }
  if (partnerKeysLower.has(k)) {
    return roundUpToIncrement(buyPriceExVatCHF * 1.10, roundTo);
  }

  const targetNetMargin = resolveGalaxusTargetNetMarginForSupplier(supplierKey, defaults.targetMargin);
  const shippingPerPair = resolveShippingPerPairForSupplier(
    supplierKey,
    defaults.shippingPerPair,
    options?.deliveryType
  );
  const bufferPerPair = resolveBufferPerPairForSupplier(supplierKey, defaults.bufferPerPair);

  let sellPriceExVat = computeGalaxusSellPriceExVat({
    buyPriceExVatCHF,
    shippingPerPairCHF: shippingPerPair,
    targetNetMargin,
    bufferPerPairCHF: bufferPerPair,
    roundTo: defaults.roundTo,
    vatRate: defaults.vatRate,
  }).sellPriceExVatCHF;

  if (isStxGalaxusSupplierKey(supplierKey)) {
    const bump = resolveStxGalaxusPriceBumpChf();
    if (bump > 0) {
      sellPriceExVat = Number((sellPriceExVat + bump).toFixed(2));
    }
  }

  return sellPriceExVat;
}

/**
 * @deprecated Prefer {@link resolveGalaxusSellExVatForChannel}. Legacy net-margin path from resolved overrides only.
 */
export function resolveSellPriceExVatCHF(
  buyPriceExVatCHF: number,
  overrides: ReturnType<typeof resolvePricingOverrides>
): number {
  return computeGalaxusSellPriceExVat({
    buyPriceExVatCHF,
    shippingPerPairCHF: overrides.shippingPerPair,
    targetNetMargin: overrides.targetMargin,
    bufferPerPairCHF: overrides.bufferPerPair,
    roundTo: overrides.roundTo,
    vatRate: overrides.vatRate,
  }).sellPriceExVatCHF;
}

export function computeGalaxusSellPriceExVat(input: PricingInput) {
  const shipping = input.shippingPerPairCHF ?? DEFAULT_SHIPPING;
  const target = input.targetNetMargin ?? DEFAULT_TARGET_MARGIN;
  const buffer = input.bufferPerPairCHF ?? DEFAULT_BUFFER;
  const roundTo = input.roundTo ?? DEFAULT_ROUND_TO;
  const vatRate = input.vatRate ?? DEFAULT_VAT_RATE;

  if (!Number.isFinite(input.buyPriceExVatCHF) || input.buyPriceExVatCHF <= 0) {
    throw new Error("buyPriceExVatCHF must be > 0");
  }
  if (!Number.isFinite(shipping) || shipping < 0) {
    throw new Error("shippingPerPairCHF must be >= 0");
  }
  if (!Number.isFinite(buffer) || buffer < 0) {
    throw new Error("bufferPerPairCHF must be >= 0");
  }
  if (!Number.isFinite(target) || target <= 0 || target >= 0.5) {
    throw new Error("targetNetMargin must be in (0, 0.5)");
  }
  if (!Number.isFinite(roundTo) || roundTo <= 0) {
    throw new Error("roundTo must be > 0");
  }
  if (!Number.isFinite(vatRate) || vatRate < 0) {
    throw new Error("vatRate must be >= 0");
  }

  const totalCost = input.buyPriceExVatCHF + shipping + buffer;
  const rawSellPrice = totalCost / (1 - target);
  const sellPriceExVat = roundUpToIncrement(rawSellPrice, roundTo);

  return {
    sellPriceExVatCHF: sellPriceExVat,
    sellPriceIncVatCHF: sellPriceExVat * (1 + vatRate),
    impliedNetMargin: (sellPriceExVat - totalCost) / sellPriceExVat,
    markupOnBuyPricePct: ((sellPriceExVat - input.buyPriceExVatCHF) / input.buyPriceExVatCHF) * 100,
  };
}
