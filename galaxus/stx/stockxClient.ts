import { DEFAULT_QUERY } from "@/app/lib/constants";
import { extractAwbFromTrackingUrl } from "@/app/lib/stockxTracking";

type StockxBuyingNode = {
  chainId: string | null;
  orderId: string | null;
  orderNumber: string | null;
  productVariant?: { id?: string | null } | null;
};

type StockxBuyOrder = {
  id?: string | null;
  chainId?: string | null;
  orderNumber?: string | null;
  checkoutType?: string | null;
  estimatedDeliveryDateRange?: {
    estimatedDeliveryDate?: string | null;
    latestEstimatedDeliveryDate?: string | null;
  } | null;
  shipping?: {
    shipment?: {
      trackingUrl?: string | null;
    } | null;
  } | null;
  product?: {
    variant?: {
      id?: string | null;
    } | null;
  } | null;
};

const STOCKX_PRO_URL = "https://pro.stockx.com/api/graphql";

const GET_BUY_ORDER_QUERY = `
  query GET_BUY_ORDER(
    $chainId: String
    $orderId: String
    $country: String
    $market: String
    $isShipByDateEnabled: Boolean!
    $isDFSUpdatesEnabled: Boolean!
  ) {
    viewer {
      order(chainId: $chainId, orderId: $orderId) {
        ... on BuyOrder {
          id
          chainId
          orderNumber
          checkoutType
          estimatedDeliveryDateRange {
            estimatedDeliveryDate
            latestEstimatedDeliveryDate
          }
          shipping {
            shipment {
              trackingUrl
            }
          }
          product {
            variant {
              id
            }
          }
        }
      }
    }
  }
`;

async function callStockx<T>(
  token: string,
  operationName: string,
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const res = await fetch(STOCKX_PRO_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      origin: "https://pro.stockx.com",
      referer: "https://pro.stockx.com/purchasing/orders",
      "apollographql-client-name": "Iron",
      "apollographql-client-version": "2026.01.11.01",
      "app-platform": "Iron",
      "app-version": "2026.01.11.01",
      "user-agent": "Mozilla/5.0 (compatible; ResellLausanneBot/1.0)",
    },
    body: JSON.stringify({ operationName, query, variables }),
  });
  const raw = await res.text();
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`StockX non-JSON response (HTTP ${res.status})`);
  }
  if (!res.ok) {
    const message =
      (Array.isArray(data?.errors) && data.errors[0]?.message) ||
      data?.error ||
      `StockX request failed (HTTP ${res.status})`;
    throw new Error(String(message));
  }
  return data as T;
}

export async function fetchRecentStockxBuyingOrders(
  token: string,
  options?: { first?: number; maxPages?: number }
): Promise<StockxBuyingNode[]> {
  const first = Math.max(1, Math.min(options?.first ?? 50, 100));
  const maxPages = Math.max(1, options?.maxPages ?? 4);
  const out: StockxBuyingNode[] = [];
  let after = "";

  for (let page = 0; page < maxPages; page += 1) {
    const response = await callStockx<any>(token, "Buying", DEFAULT_QUERY, {
      first,
      after,
      currencyCode: "CHF",
      query: null,
      state: null,
      sort: "MATCHED_AT",
      order: "DESC",
    });
    const buying = response?.data?.viewer?.buying;
    const edges = Array.isArray(buying?.edges) ? buying.edges : [];
    for (const edge of edges) {
      const node = edge?.node;
      if (!node) continue;
      out.push({
        chainId: node.chainId ?? null,
        orderId: node.orderId ?? null,
        orderNumber: node.orderNumber ?? null,
        productVariant: node.productVariant ?? null,
      });
    }
    const pageInfo = buying?.pageInfo;
    const hasNext = Boolean(pageInfo?.hasNextPage);
    const nextCursor = typeof pageInfo?.endCursor === "string" ? pageInfo.endCursor : "";
    if (!hasNext || !nextCursor) break;
    after = nextCursor;
  }

  return out;
}

export async function fetchStockxBuyOrderDetails(
  token: string,
  params: { chainId: string; orderId: string }
): Promise<{
  order: StockxBuyOrder | null;
  awb: string | null;
  etaMin: Date | null;
  etaMax: Date | null;
}> {
  const response = await callStockx<any>(token, "GET_BUY_ORDER", GET_BUY_ORDER_QUERY, {
    chainId: params.chainId,
    orderId: params.orderId,
    country: "CH",
    market: "CH",
    isShipByDateEnabled: true,
    isDFSUpdatesEnabled: true,
  });
  const order = (response?.data?.viewer?.order ?? null) as StockxBuyOrder | null;
  const trackingUrl = order?.shipping?.shipment?.trackingUrl ?? null;
  const etaMinRaw = order?.estimatedDeliveryDateRange?.estimatedDeliveryDate ?? null;
  const etaMaxRaw = order?.estimatedDeliveryDateRange?.latestEstimatedDeliveryDate ?? null;
  return {
    order,
    awb: extractAwbFromTrackingUrl(trackingUrl),
    etaMin: etaMinRaw ? new Date(etaMinRaw) : null,
    etaMax: etaMaxRaw ? new Date(etaMaxRaw) : null,
  };
}

export function extractStockxVariantId(
  listNode: StockxBuyingNode | null | undefined,
  buyOrder: StockxBuyOrder | null | undefined
): string | null {
  const fromList = listNode?.productVariant?.id ?? null;
  const fromDetails = buyOrder?.product?.variant?.id ?? null;
  const candidate = fromList ?? fromDetails;
  if (typeof candidate !== "string") return null;
  const normalized = candidate.trim();
  return normalized.length > 0 ? normalized : null;
}

