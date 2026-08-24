import {
  extractStockxVariantId,
  fetchStockxBuyOrderDetailsFull,
  findBuyOrderListNodeByOrderNumber,
  synthesizeBuyOrderDetailsFromListNode,
  type StockxBuyingNode,
} from "@/galaxus/stx/stockxClient";
import { resolveStockxBearerToken } from "@/lib/stockxToken";

export type DecathlonManualStockxEnrichResult =
  | {
      ok: true;
      listNode: StockxBuyingNode;
      details: Awaited<ReturnType<typeof fetchStockxBuyOrderDetailsFull>>;
    }
  | { ok: false; reason: string };

/** Trim + strip leading `#` (StockX Pro UI paste). */
export function normalizeStockxOrderNumberInput(input: string | null | undefined): string {
  return String(input ?? "")
    .trim()
    .replace(/^#+/, "")
    .trim();
}

export function looksLikeStockxOrderNumber(input: string | null | undefined): boolean {
  const value = normalizeStockxOrderNumberInput(input);
  if (!value) return false;
  if (value.length < 6 || value.length > 60) return false;
  if (/^https?:\/\//i.test(value)) return false;
  if (/\s/.test(value)) return false;
  // Allow optional leading # on raw input; normalized must start alnum.
  return /^[A-Za-z0-9][A-Za-z0-9._:/#-]*$/.test(value);
}

/**
 * Resolve a StockX buy by order # using an existing Pro token (no file read).
 */
export async function resolveStockxBuyByOrderNumberWithToken(
  token: string,
  stockxOrderNumberInput: string
): Promise<DecathlonManualStockxEnrichResult> {
  const orderNum = normalizeStockxOrderNumberInput(stockxOrderNumberInput);
  if (!orderNum) return { ok: false, reason: "empty_order_number" };
  try {
    const listNode = await findBuyOrderListNodeByOrderNumber(token, orderNum);
    const chainId = String(listNode?.chainId ?? "").trim();
    const orderId = String(listNode?.orderId ?? "").trim();
    if (!listNode || !chainId || !orderId) {
      return { ok: false, reason: "order_not_found_in_buying_list" };
    }
    // Same as auto-link / sync: prefer GET_BUY_ORDER; if WAF blocks details, keep
    // Buying-list amount/ETA so manual paste still fills cost (not empty MANUAL).
    let details: Awaited<ReturnType<typeof fetchStockxBuyOrderDetailsFull>>;
    try {
      details = await fetchStockxBuyOrderDetailsFull(token, { chainId, orderId });
      if (!details?.order) {
        details = synthesizeBuyOrderDetailsFromListNode(listNode);
      }
    } catch {
      details = synthesizeBuyOrderDetailsFromListNode(listNode);
    }
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
  // Same bearer resolution as backfill (`getSupplierToken`) + auto-link file fallback.
  const auth = await resolveStockxBearerToken();
  if (!auth?.token) return { ok: false, reason: "missing_stockx_token" };
  return resolveStockxBuyByOrderNumberWithToken(auth.token, stockxOrderNumberInput);
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

  const listEtaMinRaw = listNode?.estimatedDeliveryDateRange?.estimatedDeliveryDate ?? null;
  const listEtaMaxRaw = listNode?.estimatedDeliveryDateRange?.latestEstimatedDeliveryDate ?? null;
  const normalizedEtaMin =
    details.etaMin ??
    details.etaMax ??
    (listEtaMinRaw ? new Date(listEtaMinRaw) : null) ??
    (listEtaMaxRaw ? new Date(listEtaMaxRaw) : null);
  const normalizedEtaMax =
    details.etaMax ??
    details.etaMin ??
    (listEtaMaxRaw ? new Date(listEtaMaxRaw) : null) ??
    (listEtaMinRaw ? new Date(listEtaMinRaw) : null);
  const reasons = options?.matchReasons ?? ["MANUAL_STOCKX_ORDER_LOOKUP"];

  const settledFromDetails = (() => {
    const raw = order?.payment?.settledAmount?.value;
    if (raw == null || raw === "") return null;
    const n = Number(String(raw).replace(",", "."));
    return Number.isFinite(n) ? n : null;
  })();
  const settledFromList =
    listNode?.amount != null && Number.isFinite(Number(listNode.amount))
      ? Number(listNode.amount)
      : null;

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
    stockxPurchaseDate: order?.created
      ? new Date(order.created)
      : listNode?.purchaseDate
        ? new Date(listNode.purchaseDate)
        : listNode?.creationDate
          ? new Date(listNode.creationDate)
          : null,
    stockxAmount: settledFromDetails ?? settledFromList,
    stockxCurrencyCode:
      order?.payment?.settledAmount?.currency ?? listNode?.currencyCode ?? null,
    stockxStatus:
      order?.status != null
        ? String(order.status)
        : listNode?.state?.statusKey != null
          ? String(listNode.state.statusKey)
          : null,
    stockxEstimatedDelivery: normalizedEtaMin,
    stockxLatestEstimatedDelivery: normalizedEtaMax,
    stockxAwb: details.awb ?? null,
    stockxTrackingUrl: order?.shipping?.shipment?.trackingUrl ?? null,
    stockxCheckoutType:
      typeof order?.checkoutType === "string"
        ? order.checkoutType
        : typeof listNode?.checkoutType === "string"
          ? listNode.checkoutType
          : null,
    stockxStates: order?.states ?? null,
    matchType: "SYNC",
    matchConfidence: "high",
    matchScore: 1,
    matchReasons: JSON.stringify(reasons),
  };
}
