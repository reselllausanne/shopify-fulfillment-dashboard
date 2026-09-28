import type { NormalizedSupplierOrder } from "@/app/utils/matching";
import type { LabStockxBuy, StockxAccountKey } from "./types";

/** Normalize a StockX buying-list node into a lab buy (shared Shopify/Galaxus path). */
export function normalizeStockxBuyingNode(
  node: any,
  accountKey: StockxAccountKey
): LabStockxBuy | null {
  const orderNumber = String(node?.orderNumber ?? "").trim();
  const orderId = String(node?.orderId ?? "").trim();
  if (!orderNumber || !orderId) return null;

  const variant = node?.productVariant ?? {};
  const product = variant?.product ?? {};
  const purchaseDate = String(node?.purchaseDate ?? node?.creationDate ?? "");
  const localizedSize = String(node?.localizedSizeTitle ?? "");
  const sizeType = String(node?.localizedSizeType ?? "").toUpperCase();
  const sizeEU = sizeType.includes("EU")
    ? localizedSize.replace(/^EU\s*/i, "")
    : localizedSize ||
      variant?.traits?.size ||
      variant?.sizeChart?.baseSize ||
      null;

  const skuKey = String(
    variant?.styleId ?? variant?.model ?? product?.styleId ?? product?.urlKey ?? product?.model ?? ""
  );
  const gtin =
    String(variant?.gtin ?? variant?.barcode ?? product?.gtin ?? "").trim() || null;
  const productVariantId = String(variant?.id ?? "").trim() || null;

  const base: NormalizedSupplierOrder = {
    supplierOrderNumber: orderNumber,
    chainId: String(node?.chainId ?? ""),
    orderId,
    supplierSource: "STOCKX",
    purchaseDate,
    offerAmount: typeof node?.amount === "number" ? node.amount : null,
    totalTTC: null,
    productTitle: String(product?.title ?? product?.name ?? "—"),
    productName: product?.name ?? product?.title ?? undefined,
    skuKey,
    sizeEU: sizeEU ? String(sizeEU) : null,
    statusKey: node?.state?.statusKey ?? null,
    statusTitle: node?.state?.statusTitle ?? null,
    currencyCode: node?.currencyCode ?? "CHF",
    estimatedDeliveryDate: node?.estimatedDeliveryDateRange?.estimatedDeliveryDate ?? null,
    latestEstimatedDeliveryDate:
      node?.estimatedDeliveryDateRange?.latestEstimatedDeliveryDate ?? null,
    productVariantId: productVariantId ?? undefined,
    awb: node?.awb ?? null,
    trackingUrl: node?.trackingUrl ?? null,
  };

  return {
    ...base,
    stockxAccountKey: accountKey,
    gtin,
    productVariantId,
    rawNode: node,
  };
}

export function isStockxBuyMatchable(statusKey: string | null | undefined): boolean {
  const key = String(statusKey ?? "").trim().toUpperCase();
  if (!key) return true;
  if (key.includes("CANCEL")) return false;
  if (key.includes("REFUND")) return false;
  return true;
}

export function normalizeSkuKey(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function normalizeGtin(value: string | null | undefined): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

export function normalizeSizeLabel(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "—" || raw.toLowerCase() === "n/a") return null;
  return raw
    .toUpperCase()
    .replace(/^EU\s*/i, "")
    .replace(/^US\s*[MW]?\s*/i, "")
    .replace(/\s*(Y|GS)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}
