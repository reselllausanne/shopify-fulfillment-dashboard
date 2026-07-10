export type ShopifyDeliveryMode = "express" | "standard";

export type ShopifyLineItemDeliveryInfo = {
  deliveryMode: ShopifyDeliveryMode | null;
  deliveryModeLabel: string | null;
  deliveryEstimate: string | null;
  expressAvailable: boolean | null;
  /** Express price actually charged on this line (express orders only). */
  expressPrice: string | null;
  /** Express price configured on the variant metafield. */
  variantExpressPrice: string | null;
};

type CustomAttribute = { key: string; value: string | null };

/** Shopify stores checkout delivery props on lineItemGroup, not always on the line item itself. */
export function mergeLineItemCustomAttributes(
  lineItemAttrs: CustomAttribute[] | null | undefined,
  lineItemGroupAttrs: CustomAttribute[] | null | undefined
): CustomAttribute[] {
  const merged = new Map<string, CustomAttribute>();
  for (const attr of lineItemGroupAttrs ?? []) {
    if (attr?.key) merged.set(attr.key, attr);
  }
  for (const attr of lineItemAttrs ?? []) {
    if (attr?.key) merged.set(attr.key, attr);
  }
  return Array.from(merged.values());
}

function attrValue(attrs: CustomAttribute[] | null | undefined, key: string): string | null {
  const found = (attrs ?? []).find((a) => a.key === key);
  const value = found?.value;
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function normalizeDeliveryMode(raw: string | null | undefined): ShopifyDeliveryMode | null {
  if (!raw) return null;
  const lower = raw.trim().toLowerCase();
  if (!lower) return null;
  if (lower.includes("express")) return "express";
  if (lower.includes("standard") || lower.includes("normale") || lower.includes("normal")) return "standard";
  return null;
}

function parseExpressPriceMetafield(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    const cents = Number(trimmed);
    if (Number.isFinite(cents) && cents > 0) {
      return `CHF ${(cents / 100).toFixed(2)}`;
    }
  }

  try {
    const parsed = JSON.parse(trimmed) as
      | { amount?: string | number; currency_code?: string }
      | number;
    if (typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0) {
      return `CHF ${(parsed / 100).toFixed(2)}`;
    }
    const amount = parsed && typeof parsed === "object" ? parsed.amount : null;
    if (amount == null || amount === "") return null;
    const currency =
      parsed && typeof parsed === "object" ? parsed.currency_code ?? "CHF" : "CHF";
    return `${currency} ${Number(amount).toFixed(2)}`;
  } catch {
    return trimmed;
  }
}

export function parseShopifyLineItemDelivery(input: {
  customAttributes?: CustomAttribute[] | null;
  expressAvailableMetafield?: string | null;
  expressPriceMetafield?: string | null;
}): ShopifyLineItemDeliveryInfo {
  const attrs = input.customAttributes ?? [];
  const deliveryFromHidden = normalizeDeliveryMode(attrValue(attrs, "_delivery"));
  const deliveryFromLabel = normalizeDeliveryMode(attrValue(attrs, "Mode d'expédition"));
  const deliveryMode = deliveryFromHidden ?? deliveryFromLabel;

  const deliveryModeLabel =
    attrValue(attrs, "Mode d'expédition") ??
    (deliveryMode === "express" ? "Express" : deliveryMode === "standard" ? "Standard" : null);

  const deliveryEstimate = attrValue(attrs, "Estimation livraison");

  const expressPriceFromAttr = attrValue(attrs, "_express_price");
  const variantExpressPrice = parseExpressPriceMetafield(input.expressPriceMetafield);
  const expressPrice =
    deliveryMode === "express"
      ? parseExpressPriceMetafield(expressPriceFromAttr) ?? variantExpressPrice
      : null;

  let expressAvailable: boolean | null = null;
  const expressAvailableRaw = input.expressAvailableMetafield;
  if (expressAvailableRaw != null && String(expressAvailableRaw).trim() !== "") {
    expressAvailable = String(expressAvailableRaw).trim().toLowerCase() === "true";
  }

  return {
    deliveryMode,
    deliveryModeLabel,
    deliveryEstimate,
    expressAvailable,
    expressPrice,
    variantExpressPrice,
  };
}

export function formatShopifyDeliveryModeLabel(mode: ShopifyDeliveryMode | null | undefined): string {
  if (mode === "express") return "Express";
  if (mode === "standard") return "Standard";
  return "—";
}
