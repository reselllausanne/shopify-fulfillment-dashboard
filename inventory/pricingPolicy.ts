import type { InventoryChannel } from "./types";

export type ProductPricingKind = "normal" | "liquidation" | "plus_size";

type ProductClassificationInput = {
  title?: string | null;
  sizeRaw?: string | null;
  sizeNormalized?: string | null;
  sizeEu?: string | null;
  sizeUs?: string | null;
};

type ChannelPricingMultipliers = {
  normal: number;
  liquidation: number;
  plusSize: number;
};

const DEFAULT_MULTIPLIERS: Record<InventoryChannel, ChannelPricingMultipliers> = {
  SHOPIFY: {
    normal: 1.0,
    liquidation: 0.96,
    plusSize: 1.08,
  },
  GALAXUS: {
    normal: 1.0,
    liquidation: 1.0,
    plusSize: 1.0,
  },
  DECATHLON: {
    normal: 1.0,
    liquidation: 1.0,
    plusSize: 1.0,
  },
};

const plusSizeTokens = new Set([
  "PLUS",
  "PLUSSIZE",
  "PLUS SIZE",
  "XXL",
  "XXXL",
  "XXXXL",
  "2XL",
  "3XL",
  "4XL",
  "5XL",
]);

function roundPrice(value: number): number {
  return Math.round(value * 100) / 100;
}

function readMultiplier(keys: string[], fallback: number): number {
  for (const key of keys) {
    const raw = process.env[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const parsed = Number.parseFloat(String(raw));
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 10) continue;
    return parsed;
  }
  return fallback;
}

function buildChannelMultipliers(channel: InventoryChannel): ChannelPricingMultipliers {
  const defaults = DEFAULT_MULTIPLIERS[channel];
  const prefix = channel;
  return {
    normal: readMultiplier(
      [`${prefix}_PRICE_MULTIPLIER_NORMAL`, "INVENTORY_PRICE_MULTIPLIER_NORMAL"],
      defaults.normal
    ),
    liquidation: readMultiplier(
      [`${prefix}_PRICE_MULTIPLIER_LIQUIDATION`, "INVENTORY_PRICE_MULTIPLIER_LIQUIDATION"],
      defaults.liquidation
    ),
    plusSize: readMultiplier(
      [`${prefix}_PRICE_MULTIPLIER_PLUS_SIZE`, "INVENTORY_PRICE_MULTIPLIER_PLUS_SIZE"],
      defaults.plusSize
    ),
  };
}

function extractNumericSizes(input: string): number[] {
  const values: number[] = [];
  const regex = /([0-9]{1,2}(?:\.[05])?)/g;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(input)) !== null) {
    const parsed = Number.parseFloat(match[1]);
    if (Number.isFinite(parsed)) {
      values.push(parsed);
    }
  }
  return values;
}

export function isLiquidationProductTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  return /%\s*$/.test(title.trim());
}

export function isPlusSizeProduct(input: ProductClassificationInput): boolean {
  const combined = [
    input.title ?? "",
    input.sizeRaw ?? "",
    input.sizeNormalized ?? "",
    input.sizeEu ?? "",
    input.sizeUs ?? "",
  ]
    .join(" ")
    .toUpperCase();

  for (const token of plusSizeTokens) {
    if (combined.includes(token)) return true;
  }

  const euSizes = extractNumericSizes(
    [input.sizeEu ?? "", input.sizeRaw ?? "", input.sizeNormalized ?? ""].join(" ")
  );
  if (euSizes.some((value) => value >= 47)) {
    return true;
  }

  const usSizes = extractNumericSizes(input.sizeUs ?? "");
  if (usSizes.some((value) => value >= 13)) {
    return true;
  }

  return false;
}

export function classifyProductPricingKind(input: ProductClassificationInput): ProductPricingKind {
  if (isLiquidationProductTitle(input.title)) return "liquidation";
  if (isPlusSizeProduct(input)) return "plus_size";
  return "normal";
}

export function computeChannelVariantPrice(input: {
  channel: InventoryChannel;
  basePrice: number;
  classification: ProductPricingKind;
}): number | null {
  if (!Number.isFinite(input.basePrice) || input.basePrice <= 0) return null;
  const multipliers = buildChannelMultipliers(input.channel);
  const factor =
    input.classification === "liquidation"
      ? multipliers.liquidation
      : input.classification === "plus_size"
        ? multipliers.plusSize
        : multipliers.normal;
  if (!Number.isFinite(factor) || factor <= 0) return null;
  const computed = input.basePrice * factor;
  if (!Number.isFinite(computed) || computed <= 0) return null;
  return roundPrice(computed);
}
