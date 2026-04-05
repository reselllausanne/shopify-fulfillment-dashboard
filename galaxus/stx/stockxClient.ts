import { DEFAULT_QUERY } from "@/app/lib/constants";
import { extractAwbFromTrackingUrl } from "@/app/lib/stockxTracking";

export type StockxBuyingNode = {
  chainId: string | null;
  orderId: string | null;
  orderNumber: string | null;
  // Keeping these fields loose because StockX query returns a lot of nested data and we
  // want to log/return the full node for debugging and history export.
  purchaseDate?: string | null;
  creationDate?: string | null;
  amount?: number | null;
  currencyCode?: string | null;
  state?: { statusKey?: string | null; statusTitle?: string | null } | null;
  localizedSizeTitle?: string | null;
  localizedSizeType?: string | null;
  productVariant?: any | null;
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

// Full detail query used for “A+B” enrichment exports and debugging.
const GET_BUY_ORDER_FULL_QUERY = `
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
          created
          sourceType
          guestOrderTransferMessage
          estimatedDeliveryDateRange {
            estimatedDeliveryDate
            latestEstimatedDeliveryDate
            estimatedDeliveryStatus
          }
          tradeInvoice @include(if: $isDFSUpdatesEnabled) {
            transactions {
              id
              locationUrl
            }
          }
          deliveredDate
          actionCode
          referenceType
          sellerShipByDateRange @include(if: $isShipByDateEnabled) {
            start
            end
            actual
          }
          status
          currentStatus {
            key
            completionStatus
          }
          user {
            shippingAddress {
              address1
              address2
              city
              region
              country
              zipCode
            }
          }
          product {
            localizedSize {
              title
            }
            variant {
              id
              traits {
                size
                sizeDescriptor
              }
              sizeChart {
                baseSize
                baseType
                displayOptions {
                  size
                  type
                }
              }
              market(currencyCode: USD) {
                state(country: $country, market: $market) {
                  lowestAsk { amount }
                  highestBid { amount }
                }
              }
              product {
                id
                title
                primaryTitle
                secondaryTitle
                listingType
                sizeDescriptor
                productCategory
                urlKey
                defaultSizeConversion { name type }
                media { thumbUrl smallImageUrl imageUrl }
                brand
                primaryCategory
                browseVerticals
                contentGroup
              }
            }
          }
          checkoutType
          states {
            title
            subtitle
            status
            progress
            meta
            sourceType
          }
          currency { code }
          returnDetails { refundMechanism type }
          return {
            returnDetails { refundMechanism type }
            shipping {
              shipment {
                documents { returnInstructions }
              }
            }
            pricing {
              finalized {
                local {
                  credit {
                    total
                    adjustments {
                      name
                      amount
                      percentage
                      translationKey
                      excludedFromTotal
                      item
                      groupInternal
                    }
                  }
                }
              }
            }
          }
          returnInfo {
            eligibilityDays
            returnEligibilityStatus
            returnEligibilityEndDate
            returnByDate
            orderDeliveredDate
            orderReturnedDate
          }
          pricing {
            finalized {
              local {
                credit {
                  total
                  adjustments {
                    name
                    amount
                    percentage
                    translationKey
                    excludedFromTotal
                    item
                    groupInternal
                  }
                }
                subtotal
                total
                adjustments {
                  name
                  amount
                  excludedFromTotal
                  translationKey
                  groupInternal
                }
              }
            }
          }
          payment {
            id
            settledAmount { value currency }
            authorizedAmount { value currency }
            transactions {
              paymentInstrument { descriptor type cardType }
              authorizedAmount { value currency }
              settledAmount { value currency }
              provider
              id
              token
              status
              method { id type }
            }
          }
          shipping {
            shipment {
              trackingUrl
              deliveryDate
            }
            returnShipment {
              documents { returnInstructions }
              trackingUrl
            }
          }
          resellNoFee { eligible expiresAt eligibilityDays }
          returnInfo {
            eligibilityDays
            returnEligibilityEndDate
            returnEligibilityStatus
            returnByDate
          }
          pickUpDetails {
            locationId
            locationName
            address {
              address1
              address2
              city
              region
              country
              zipCode
              latitude
              longitude
            }
            pickUpFirstName
            pickUpLastName
            openingHours {
              monday { open close }
              tuesday { open close }
              wednesday { open close }
              thursday { open close }
              friday { open close }
              saturday { open close }
              sunday { open close }
            }
          }
        }
      }
    }
  }
`;

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

function normalizeOrderNumberKey(raw: string): string {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
}

/** Loose match for manual lookup (user may paste partial order #). */
export function buyOrderNumbersMatch(stored: string | null | undefined, search: string | null | undefined): boolean {
  const a = normalizeOrderNumberKey(String(stored ?? ""));
  const b = normalizeOrderNumberKey(String(search ?? ""));
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

export async function fetchRecentStockxBuyingOrders(
  token: string,
  options?: { first?: number; maxPages?: number; state?: string | null; query?: string | null }
): Promise<StockxBuyingNode[]> {
  const first = Math.max(1, Math.min(options?.first ?? 50, 100));
  const maxPages = Math.max(1, options?.maxPages ?? 4);
  const out: StockxBuyingNode[] = [];
  let after = "";
  /** `undefined` → PENDING; explicit `null` = any buying state (used when searching by order #). */
  const stateForQuery = options?.state === undefined ? "PENDING" : options.state;

  for (let page = 0; page < maxPages; page += 1) {
    const response = await callStockx<any>(token, "Buying", DEFAULT_QUERY, {
      first,
      after,
      currencyCode: "CHF",
      query: options?.query ?? null,
      state: stateForQuery,
      sort: "MATCHED_AT",
      order: "DESC",
    });
    const buying = response?.data?.viewer?.buying;
    const edges = Array.isArray(buying?.edges) ? buying.edges : [];
    for (const edge of edges) {
      const node = edge?.node;
      if (!node) continue;
      // Keep the full node payload (but ensure expected root keys exist).
      out.push({
        ...node,
        chainId: node.chainId ?? null,
        orderId: node.orderId ?? null,
        orderNumber: node.orderNumber ?? null,
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

/**
 * Find a buying list node by human-readable order number (search + scan).
 * Tries: all states with query, PENDING with query, then recent PENDING pages without query.
 */
export async function findBuyOrderListNodeByOrderNumber(
  token: string,
  orderNumber: string
): Promise<StockxBuyingNode | null> {
  const needle = orderNumber.trim();
  if (!needle) return null;

  const key = (n: StockxBuyingNode) => `${String(n.chainId ?? "")}::${String(n.orderId ?? "")}`;
  const seen = new Set<string>();
  const merged: StockxBuyingNode[] = [];

  const addBatch = (batch: StockxBuyingNode[]) => {
    for (const n of batch) {
      const k = key(n);
      if (!n.orderId || seen.has(k)) continue;
      seen.add(k);
      merged.push(n);
    }
  };

  addBatch(
    await fetchRecentStockxBuyingOrders(token, {
      first: 50,
      maxPages: 12,
      state: null,
      query: needle,
    })
  );
  addBatch(
    await fetchRecentStockxBuyingOrders(token, {
      first: 50,
      maxPages: 8,
      state: "PENDING",
      query: needle,
    })
  );

  for (const n of merged) {
    if (buyOrderNumbersMatch(n.orderNumber, needle)) return n;
  }

  addBatch(
    await fetchRecentStockxBuyingOrders(token, {
      first: 50,
      maxPages: 8,
      state: "PENDING",
      query: null,
    })
  );

  for (const n of merged) {
    if (buyOrderNumbersMatch(n.orderNumber, needle)) return n;
  }

  return null;
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

export async function fetchStockxBuyOrderDetailsFull(
  token: string,
  params: { chainId: string; orderId: string }
): Promise<{
  order: any | null;
  awb: string | null;
  etaMin: Date | null;
  etaMax: Date | null;
}> {
  const extractAwbLoose = (raw: string | null | undefined): string | null => {
    if (!raw) return null;
    const normalize = (value: string): string | null => {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const first = trimmed.split(/[,\s|;]+/)[0] || "";
      const cleaned = first.replace(/[^A-Z0-9]/gi, "").toUpperCase();
      if (!cleaned) return null;
      if (/^1Z[0-9A-Z]{16}$/.test(cleaned)) return cleaned;
      if (/^\d{13,}$/.test(cleaned)) return cleaned.slice(-12);
      if (/^[A-Z0-9]{8,}$/.test(cleaned)) return cleaned;
      return null;
    };
    // Try URL-based extraction first.
    const urlAwb = extractAwbFromTrackingUrl(raw);
    if (urlAwb) return urlAwb;
    // Fallback: raw strings like "DPD\n123456789" or "tracking: 1Z...."
    const tokens = raw.split(/[\s\r\n]+/).filter(Boolean);
    for (const token of tokens) {
      const hit = normalize(token);
      if (hit) return hit;
    }
    return null;
  };

  const response = await callStockx<any>(token, "GET_BUY_ORDER", GET_BUY_ORDER_FULL_QUERY, {
    chainId: params.chainId,
    orderId: params.orderId,
    country: "CH",
    market: "CH",
    isShipByDateEnabled: true,
    isDFSUpdatesEnabled: true,
  });
  const order = (response?.data?.viewer?.order ?? null) as any | null;
  const trackingUrl = order?.shipping?.shipment?.trackingUrl ?? null;
  const returnTrackingUrl = order?.shipping?.returnShipment?.trackingUrl ?? null;
  const tradeInvoiceUrl =
    order?.tradeInvoice?.transactions?.[0]?.locationUrl ??
    order?.tradeInvoice?.transactions?.[0]?.locationURL ??
    null;
  const etaMinRaw = order?.estimatedDeliveryDateRange?.estimatedDeliveryDate ?? null;
  const etaMaxRaw = order?.estimatedDeliveryDateRange?.latestEstimatedDeliveryDate ?? null;
  return {
    order,
    awb:
      extractAwbLoose(trackingUrl) ||
      extractAwbLoose(returnTrackingUrl) ||
      extractAwbLoose(tradeInvoiceUrl),
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

