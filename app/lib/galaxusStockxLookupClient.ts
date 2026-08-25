import {
  STOCKX_GET_BUY_ORDER_OPERATION_NAME,
  STOCKX_PERSISTED_OPERATION_NAME,
  buildStockxGetBuyOrderVariables,
} from "@/app/lib/constants";
import { extractAwbFromTrackingUrl } from "@/app/lib/stockxTracking";
import { normalizeStockxOrderNumberInput } from "@/decathlon/stx/manualStockxEnrich";

function buyOrderNumbersMatch(stored: string | null | undefined, search: string): boolean {
  const a = normalizeStockxOrderNumberInput(stored).toLowerCase();
  const b = normalizeStockxOrderNumberInput(search).toLowerCase();
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function mapListAndOrderToFields(listNode: any, order: any | null) {
  const variant = order?.product?.variant ?? listNode?.productVariant ?? null;
  const product = variant?.product ?? null;
  const amountRaw =
    order?.payment?.settledAmount?.value ??
    order?.payment?.authorizedAmount?.value ??
    listNode?.amount;
  const amount =
    amountRaw != null && Number.isFinite(Number(amountRaw)) ? Number(amountRaw) : null;
  const etaMinRaw =
    order?.estimatedDeliveryDateRange?.estimatedDeliveryDate ??
    listNode?.estimatedDeliveryDateRange?.estimatedDeliveryDate ??
    null;
  const etaMaxRaw =
    order?.estimatedDeliveryDateRange?.latestEstimatedDeliveryDate ??
    listNode?.estimatedDeliveryDateRange?.latestEstimatedDeliveryDate ??
    null;
  const trackingUrl = order?.shipping?.shipment?.trackingUrl ?? null;

  return {
    stockxOrderNumber: listNode?.orderNumber ?? order?.orderNumber ?? null,
    stockxOrderId: listNode?.orderId ?? order?.id ?? null,
    stockxChainId: listNode?.chainId ?? order?.chainId ?? null,
    stockxVariantId: variant?.id ?? null,
    stockxProductName: product?.title ?? product?.name ?? null,
    stockxSkuKey: product?.styleId ?? product?.id ?? null,
    stockxSizeEU:
      listNode?.localizedSizeTitle ??
      order?.product?.localizedSize?.title ??
      variant?.traits?.size ??
      null,
    stockxPurchaseDate: order?.created ?? listNode?.purchaseDate ?? listNode?.creationDate ?? null,
    stockxAmount: amount,
    stockxCurrencyCode:
      order?.payment?.settledAmount?.currency ?? listNode?.currencyCode ?? "CHF",
    stockxStatus:
      order?.status ?? listNode?.state?.statusKey ?? listNode?.state?.statusTitle ?? null,
    stockxEstimatedDelivery: etaMinRaw,
    stockxLatestEstimatedDelivery: etaMaxRaw,
    stockxAwb: extractAwbFromTrackingUrl(trackingUrl),
    stockxTrackingUrl: trackingUrl,
    stockxCheckoutType: order?.checkoutType ?? listNode?.checkoutType ?? null,
    stockxStates: order?.states ?? null,
    supplierCost: amount,
    matchType: "SYNC",
    matchConfidence: "high",
    matchScore: 1,
  };
}

/** Same StockX path as dashboard auto-match: browser → /api/stockx (+ Playwright fallback on server). */
export async function lookupGalaxusStockxBuyViaProxy(
  token: string,
  orderNumberInput: string,
  options?: { getBuyOrderHash?: string | null }
): Promise<
  { ok: true; fields: ReturnType<typeof mapListAndOrderToFields> } | { ok: false; error: string }
> {
  const cleanedToken = String(token ?? "")
    .trim()
    .replace(/^Bearer\s+/i, "");
  if (!cleanedToken) return { ok: false, error: "missing_stockx_token" };

  const needle = normalizeStockxOrderNumberInput(orderNumberInput);
  if (!needle) return { ok: false, error: "empty_order_number" };

  const listRes = await fetch("/api/stockx", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: cleanedToken,
      operationName: STOCKX_PERSISTED_OPERATION_NAME,
      query: "",
      variables: {
        first: 50,
        after: "",
        state: null,
        sort: "MATCHED_AT",
        order: "DESC",
        currencyCode: "CHF",
        market: "CH",
        country: "CH",
        query: needle,
      },
    }),
  });
  const listJson = await listRes.json().catch(() => ({}));
  if (!listRes.ok) {
    const msg =
      String(listJson?.error ?? "").trim() ||
      String(listJson?.details ?? "").trim() ||
      (Array.isArray(listJson?.errors) ? listJson.errors[0]?.message : "") ||
      `StockX list HTTP ${listRes.status}`;
    return { ok: false, error: msg };
  }

  const edges = Array.isArray(listJson?.data?.viewer?.buying?.edges)
    ? listJson.data.viewer.buying.edges
    : [];
  const listNode =
    edges.map((edge: any) => edge?.node).find((node: any) =>
      buyOrderNumbersMatch(node?.orderNumber, needle)
    ) ?? null;
  if (!listNode) return { ok: false, error: "order_not_found_in_buying_list" };

  const chainId = String(listNode?.chainId ?? "").trim();
  const orderId = String(listNode?.orderId ?? "").trim();
  if (!chainId || !orderId) return { ok: false, error: "order_missing_ids" };

  const detailBody: Record<string, unknown> = {
    token: cleanedToken,
    operationName: STOCKX_GET_BUY_ORDER_OPERATION_NAME,
    query: "",
    variables: buildStockxGetBuyOrderVariables({ chainId, orderId }),
  };
  const hash = String(options?.getBuyOrderHash ?? "").trim();
  if (hash) {
    detailBody.persistedQueryHash = hash;
    detailBody.extensions = { persistedQuery: { version: 1, sha256Hash: hash } };
  }

  let order: any | null = null;
  try {
    const detailRes = await fetch("/api/stockx", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(detailBody),
    });
    const detailJson = await detailRes.json().catch(() => ({}));
    if (detailRes.ok) {
      order = detailJson?.data?.viewer?.order ?? null;
    }
  } catch {
    // list node still has amount/ETA
  }

  return { ok: true, fields: mapListAndOrderToFields(listNode, order) };
}
