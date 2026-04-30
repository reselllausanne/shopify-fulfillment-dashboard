import {
  extractStockxVariantId,
  fetchStockxBuyOrderDetailsFull,
  findBuyOrderListNodeByOrderNumber,
  type StockxBuyingNode,
} from "@/galaxus/stx/stockxClient";
import { readGalaxusStockxToken } from "@/lib/stockxGalaxusAuth";

export type DecathlonManualStockxEnrichResult =
  | {
      ok: true;
      listNode: StockxBuyingNode;
      details: Awaited<ReturnType<typeof fetchStockxBuyOrderDetailsFull>>;
    }
  | { ok: false; reason: string };

export function looksLikeStockxOrderNumber(input: string | null | undefined): boolean {
  const value = String(input ?? "").trim();
  if (!value) return false;
  if (value.length < 6 || value.length > 60) return false;
  if (/^https?:\/\//i.test(value)) return false;
  if (/\s/.test(value)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._:/#-]*$/.test(value);
}

/**
 * Resolve a StockX buy by order # using an existing Pro token (no file read).
 */
export async function resolveStockxBuyByOrderNumberWithToken(
  token: string,
  stockxOrderNumberInput: string
): Promise<DecathlonManualStockxEnrichResult> {
  const orderNum = String(stockxOrderNumberInput ?? "").trim();
  if (!orderNum) return { ok: false, reason: "empty_order_number" };
  try {
    const listNode = await findBuyOrderListNodeByOrderNumber(token, orderNum);
    const chainId = String(listNode?.chainId ?? "").trim();
    const orderId = String(listNode?.orderId ?? "").trim();
    if (!listNode || !chainId || !orderId) {
      return { ok: false, reason: "order_not_found_in_buying_list" };
    }
    const details = await fetchStockxBuyOrderDetailsFull(token, { chainId, orderId });
    return { ok: true, listNode, details };
  } catch (error: any) {
    const reason = String(error?.message ?? "").trim();
    return {
      ok: false,
      reason: reason ? `lookup_failed:${reason}` : "lookup_failed",
    };
  }
}

/**
 * Resolve a StockX buy by order # (as shown in Pro), then load full buy order (same as auto-sync).
 */
export async function resolveStockxBuyForManualDecathlon(
  stockxOrderNumberInput: string
): Promise<DecathlonManualStockxEnrichResult> {
  const token = await readGalaxusStockxToken();
  if (!token) return { ok: false, reason: "missing_stockx_token" };
  return resolveStockxBuyByOrderNumberWithToken(token, stockxOrderNumberInput);
}

/**
 * Map StockX buy details → `DecathlonStockxMatch` StockX columns.
 * `listNode` may be null when refreshing from GET_BUY_ORDER only (variant/product come from `details.order`).
 */
export function applyStockxDetailsToDecathlonMatchFields(
  listNode: StockxBuyingNode | null | undefined,
  details: Awaited<ReturnType<typeof fetchStockxBuyOrderDetailsFull>>,
  options?: { matchReasons?: string[] }
) {
  const order = details.order;
  const variantId = extractStockxVariantId(listNode, order);
  const fromListSize =
    listNode?.localizedSizeTitle ?? listNode?.productVariant?.traits?.size ?? null;
  const fromOrderVariant = order?.product?.variant;
  const fromOrderSize =
    order?.product?.localizedSize?.title ?? fromOrderVariant?.traits?.size ?? null;
  const size = fromListSize ?? fromOrderSize;

  const listProduct = listNode?.productVariant?.product;
  const detailProduct = fromOrderVariant?.product ?? order?.product;
  const stockxProductName =
    String(
      listProduct?.title ?? detailProduct?.title ?? detailProduct?.primaryTitle ?? ""
    ).trim() || null;
  const stockxSkuKey =
    String(
      listProduct?.styleId ??
        listProduct?.id ??
        detailProduct?.styleId ??
        detailProduct?.id ??
        detailProduct?.urlKey ??
        ""
    ).trim() || null;

  const normalizedEtaMin = details.etaMin ?? details.etaMax ?? null;
  const normalizedEtaMax = details.etaMax ?? details.etaMin ?? null;
  const reasons = options?.matchReasons ?? ["MANUAL_STOCKX_ORDER_LOOKUP"];

  return {
    stockxChainId:
      String(listNode?.chainId ?? order?.chainId ?? "").trim() || null,
    stockxOrderId: String(listNode?.orderId ?? order?.id ?? "").trim() || null,
    stockxOrderNumber:
      String(listNode?.orderNumber ?? order?.orderNumber ?? "").trim() || null,
    stockxVariantId: variantId ? String(variantId).trim() : null,
    stockxProductName,
    stockxSkuKey,
    stockxSizeEU: String(size ?? "").trim() || null,
    stockxPurchaseDate: order?.created ? new Date(order.created) : null,
    stockxAmount: order?.payment?.settledAmount?.value ?? null,
    stockxCurrencyCode: order?.payment?.settledAmount?.currency ?? null,
    stockxStatus: order?.status != null ? String(order.status) : null,
    stockxEstimatedDelivery: normalizedEtaMin,
    stockxLatestEstimatedDelivery: normalizedEtaMax,
    stockxAwb: details.awb ?? null,
    stockxTrackingUrl: order?.shipping?.shipment?.trackingUrl ?? null,
    stockxCheckoutType: typeof order?.checkoutType === "string" ? order.checkoutType : null,
    stockxStates: order?.states ?? null,
    matchType: "SYNC",
    matchConfidence: "high",
    matchScore: 1,
    matchReasons: JSON.stringify(reasons),
  };
}
