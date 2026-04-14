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

const DEFAULT_SHIPPING = 6;
const DEFAULT_TARGET_MARGIN = 0.08;
const DEFAULT_BUFFER = 0;
const DEFAULT_ROUND_TO = 0.05;
const DEFAULT_VAT_RATE = 0.081;
const DEFAULT_TARGET_MARGIN_KEYS = [
  "GALAXUS_TARGET_MARGIN",
  "GALAXUS_TARGET_NET_MARGIN",
  "GALAXUS_PRICE_TARGET_MARGIN",
];
const DEFAULT_SHIPPING_KEYS = ["GALAXUS_PRICE_SHIPPING_CHF", "GALAXUS_SHIPPING_CHF"];
const DEFAULT_BUFFER_KEYS = ["GALAXUS_PRICE_BUFFER_CHF", "GALAXUS_BUFFER_CHF"];
const DEFAULT_ROUND_TO_KEYS = ["GALAXUS_PRICE_ROUND_TO", "GALAXUS_ROUND_TO"];
const DEFAULT_VAT_RATE_KEYS = ["GALAXUS_PRICE_VAT_RATE", "GALAXUS_VAT_RATE"];

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

const GALAXUS_NER_SUPPLIER_KEY = "ner";

/**
 * Galaxus retail feed: `ner` = sell ex VAT equals partner buy (no uplift).
 * Other partner keys = +25% on buy ex VAT.
 * Everything else (e.g. StockX) uses env net-margin rules.
 */
export function resolveGalaxusSellExVatForChannel(
  buyPriceExVatCHF: number,
  supplierKey: string | null,
  partnerKeysLower: Set<string>
): number {
  const defaults = getDefaultPricing();
  const roundTo = defaults.roundTo;
  const k = supplierKey?.toLowerCase() ?? "";

  if (k === GALAXUS_NER_SUPPLIER_KEY) {
    return roundUpToIncrement(buyPriceExVatCHF, roundTo);
  }
  if (partnerKeysLower.has(k)) {
    return roundUpToIncrement(buyPriceExVatCHF * 1.25, roundTo);
  }

  return computeGalaxusSellPriceExVat({
    buyPriceExVatCHF,
    shippingPerPairCHF: defaults.shippingPerPair,
    targetNetMargin: defaults.targetMargin,
    bufferPerPairCHF: defaults.bufferPerPair,
    roundTo: defaults.roundTo,
    vatRate: defaults.vatRate,
  }).sellPriceExVatCHF;
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
