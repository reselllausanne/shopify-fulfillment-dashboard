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
  try {
    const parsed = JSON.parse(trimmed) as { amount?: string | number; currency_code?: string };
    const amount = parsed?.amount;
    if (amount == null || amount === "") return null;
    const currency = parsed?.currency_code ?? "CHF";
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
