import {
  STOCKX_GET_BUY_ORDER_OPERATION_NAME,
  STOCKX_PERSISTED_OPERATION_NAME,
  buildStockxGetBuyOrderVariables,
} from "@/app/lib/constants";

function normalizeStockxOrderNumberInput(input: string | null | undefined): string {
  return String(input ?? "")
    .trim()
    .replace(/^#+/, "")
    .trim();
}

function extractAwbFromTrackingUrl(trackingUrl: string | null | undefined): string | null {
  if (!trackingUrl) return null;
  const tokens = String(trackingUrl).split(/[\s\r\n/?&#=]+/).filter(Boolean);
  for (const token of tokens) {
    const cleaned = token.replace(/[^A-Z0-9]/gi, "").toUpperCase();
    if (!cleaned) continue;
    if (/^1Z[0-9A-Z]{16}$/.test(cleaned)) return cleaned;
    if (/^\d{13,}$/.test(cleaned)) return cleaned.slice(-12);
    if (/^[A-Z0-9]{8,}$/.test(cleaned)) return cleaned;
  }
  return null;
}

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

  const fetchBuyingPage = async (vars: {
    after: string;
    state: string | null;
    query: string | null;
  }): Promise<{ ok: true; json: any } | { ok: false; error: string }> => {
    const res = await fetch("/api/stockx", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: cleanedToken,
        operationName: STOCKX_PERSISTED_OPERATION_NAME,
        query: "",
        variables: {
          first: 50,
          after: vars.after,
          state: vars.state,
          sort: "MATCHED_AT",
          order: "DESC",
          currencyCode: "CHF",
          market: "CH",
          country: "CH",
          ...(vars.query ? { query: vars.query } : {}),
        },
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg =
        String(json?.error ?? "").trim() ||
        String(json?.details ?? "").trim() ||
        (Array.isArray(json?.errors) ? json.errors[0]?.message : "") ||
        `StockX list HTTP ${res.status}`;
      return { ok: false, error: msg };
    }
    return { ok: true, json };
  };

  const findInBuyingJson = (json: any) => {
    const edges = Array.isArray(json?.data?.viewer?.buying?.edges)
      ? json.data.viewer.buying.edges
      : [];
    return (
      edges.map((edge: any) => edge?.node).find((node: any) =>
        buyOrderNumbersMatch(node?.orderNumber, needle)
      ) ?? null
    );
  };

  const scanPages = async (opts: {
    state: string | null;
    query: string | null;
    maxPages: number;
  }): Promise<{ listNode: any | null; lastError: string | null }> => {
    let after = "";
    let lastCursor = "";
    let lastError: string | null = null;
    for (let page = 0; page < opts.maxPages; page += 1) {
      const result = await fetchBuyingPage({
        after,
        state: opts.state,
        query: opts.query,
      });
      if (!result.ok) {
        lastError = result.error;
        break;
      }
      const hit = findInBuyingJson(result.json);
      if (hit) return { listNode: hit, lastError: null };

      const pageInfo = result.json?.data?.viewer?.buying?.pageInfo;
      const hasNext = Boolean(pageInfo?.hasNextPage);
      const nextCursor =
        typeof pageInfo?.endCursor === "string" ? pageInfo.endCursor.trim() : "";
      if (!hasNext || !nextCursor || nextCursor === after || nextCursor === lastCursor) {
        break;
      }
      lastCursor = after;
      after = nextCursor;
    }
    return { listNode: null, lastError };
  };

  // Same strategy as server findBuyOrderListNodeByOrderNumber: query + paginate, then states, then blind PENDING.
  const attempts: Array<{ state: string | null; query: string | null; maxPages: number }> = [
    { state: null, query: needle, maxPages: 12 },
    { state: "PENDING", query: needle, maxPages: 4 },
    { state: "COMPLETED", query: needle, maxPages: 4 },
    { state: "AUTHENTICATED", query: needle, maxPages: 4 },
    { state: "SHIPPED", query: needle, maxPages: 4 },
    { state: "CANCELED", query: needle, maxPages: 4 },
    { state: "PENDING", query: null, maxPages: 8 },
  ];

  let listNode: any | null = null;
  let lastError: string | null = null;
  for (const attempt of attempts) {
    const scanned = await scanPages(attempt);
    if (scanned.listNode) {
      listNode = scanned.listNode;
      break;
    }
    if (scanned.lastError) lastError = scanned.lastError;
  }

  if (!listNode) {
    return {
      ok: false,
      error: lastError ?? "order_not_found_in_buying_list",
    };
  }

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
