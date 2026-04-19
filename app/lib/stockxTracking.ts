/**
 * lib/stockxTracking.ts
 * 
 * Server-only module for fetching supplier order tracking info
 * from stockx.com GraphQL endpoint (not Pro).
 * 
 * USES DB TOKEN - Same token as Buying query (getSupplierToken).
 * Auth via Authorization: Bearer <token> header.
 * 
 * IMPORTANT: Use MINIMAL query that does NOT request pickUpDetails
 * because GET_BUY_ORDER sometimes returns GraphQL errors for that field.
 * 
 * GraphQL can still return partial data including shipping.trackingUrl with HTTP 200.
 * Treat as SUCCESS if trackingUrl exists even when json.errors exists.
 */

import crypto from "node:crypto";
import { getSupplierToken } from "@/lib/stockxToken";

const STOCKX_GRAPHQL_URL = "https://stockx.com/api/p/e";

/**
 * Extract AWB (Air Waybill / tracking number) from tracking URL
 * @param trackingUrl - Full tracking URL
 * @returns AWB string or null
 */
export function extractAwbFromTrackingUrl(trackingUrl: string | null | undefined): string | null {
  if (!trackingUrl) return null;
  
  try {
    const url = new URL(trackingUrl);
    
    const normalizeTrackingNumber = (value: string): string | null => {
      const trimmed = value.trim();
      if (!trimmed) return null;

      // Some providers include multiple numbers: "A,B" or "A|B"
      const first = trimmed.split(/[,\s|;]+/)[0] || "";
      const cleaned = first.replace(/[^A-Z0-9]/gi, "");
      if (!cleaned) return null;

      // UPS (1Z + 16 chars)
      if (/^1Z[0-9A-Z]{16}$/i.test(cleaned)) {
        return cleaned.toUpperCase();
      }

      // Numeric-only tracking (DHL/other): keep last 12 if very long
      if (/^\d{13,}$/.test(cleaned)) {
        return cleaned.slice(-12);
      }

      // Generic alphanumeric tracking
      if (/^[A-Z0-9]{8,}$/i.test(cleaned)) {
        return cleaned.toUpperCase();
      }

      return null;
    };

    // Try common query parameter names (case-insensitive)
    const paramKeys = new Set([
      "awb",
      "trackingnumber",
      "tracking_number",
      "waybill",
      "consignment",
      "shipmentnumber",
      "tracknum",
      "tracknums",
      "tracknumber",
      "tracknumbers",
    ]);

    for (const [key, rawValue] of url.searchParams.entries()) {
      const keyLower = key.toLowerCase();
      const looksLikeTrackingKey = paramKeys.has(keyLower) || keyLower.includes("track");
      if (!looksLikeTrackingKey) continue;

      const normalized = normalizeTrackingNumber(rawValue);
      if (normalized) return normalized;
    }
    
    // Try to extract from pathname (e.g., /track/ABC123456789)
    const pathSegments = url.pathname.split("/").filter((s) => s.length > 0);
    for (const segment of pathSegments) {
      // Look for alphanumeric segments >= 8 chars (likely tracking numbers)
      const normalized = normalizeTrackingNumber(segment);
      if (normalized) return normalized;
    }

    // Try hash fragments (some UPS links put tracking in hash)
    const hash = url.hash ? url.hash.replace(/^#/, "") : "";
    if (hash) {
      const hashSegments = hash.split(/[/\s]+/).filter((s) => s.length > 0);
      for (const segment of hashSegments) {
        const normalized = normalizeTrackingNumber(segment);
        if (normalized) return normalized;
      }
    }
    
    return null;
  } catch (error) {
    console.error('[AWB] Error extracting AWB from URL:', error);
    return null;
  }
}

export type StockXState = {
  title?: string | null;
  subtitle?: string | null;
  status?: string | null;
  progress?: string | null;
  meta?: string | null;
  sourceType?: string | null;
};

function normalizeStockXStates(states: any[] | null | undefined): StockXState[] | null {
  if (!Array.isArray(states) || states.length === 0) return null;
  return states.map((state) => ({
    title: state?.title ?? null,
    subtitle: state?.subtitle ?? null,
    status: state?.status ?? null,
    progress: state?.progress ?? null,
    meta: state?.meta ?? null,
    sourceType: state?.sourceType ?? null,
  }));
}

export function hashStockXStates(states: StockXState[] | null | undefined): string | null {
  if (!states || states.length === 0) return null;
  const payload = JSON.stringify(states);
  return crypto.createHash("sha256").update(payload).digest("hex");
}

// ✅ ENHANCED Query B: Includes cost fields, excludes pickUpDetails to avoid 404 errors
const GET_BUY_ORDER_FULL_QUERY = `
  query GET_BUY_ORDER_FULL(
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
          status
          currentStatus {
            key
            completionStatus
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
          estimatedDeliveryDateRange {
            estimatedDeliveryDate
            latestEstimatedDeliveryDate
          }
          shipping {
            shipment {
              trackingUrl
              deliveryDate
            }
            returnShipment {
              trackingUrl
            }
          }
          currency {
            code
          }
          payment {
            settledAmount {
              value
              currency
            }
            authorizedAmount {
              value
              currency
            }
          }
          pricing {
            finalized {
              local {
                total
                subtotal
              }
            }
          }
          product {
            localizedSize {
              title
            }
            variant {
              id
              product {
                title
                brand
                urlKey
                media {
                  thumbUrl
                  imageUrl
                }
              }
            }
          }
        }
      }
    }
  }
`;

interface StockXFullOrderResult {
  orderNumber: string;
  chainId: string;
  checkoutType: string | null;
  status: string | null;
  statusKey: string | null;
  trackingUrl: string | null;
  returnTrackingUrl: string | null;
  deliveryDate: Date | null;
  estimatedDeliveryDate: Date | null;
  latestEstimatedDeliveryDate: Date | null;
  awb: string | null; // Air Waybill / tracking number
  supplierCostCHF: number | null; // ALL-IN cost from Query B
  currencyCode: string | null;
  productTitle: string | null;
  brand: string | null;
  size: string | null;
  imageUrl: string | null;
  states: StockXState[] | null;
}

// Legacy type for backward compatibility
type StockXTrackingResult = StockXFullOrderResult;

interface StockXFullOrderResponse {
  data?: {
    viewer?: {
      order?: {
        id: string;
        chainId: string;
        orderNumber: string;
        status?: string | null;
        currentStatus?: {
          key: string;
          completionStatus: string;
        } | null;
        checkoutType?: string | null;
        states?: Array<{
          title?: string | null;
          subtitle?: string | null;
          status?: string | null;
          progress?: string | null;
          meta?: string | null;
          sourceType?: string | null;
        }> | null;
        estimatedDeliveryDateRange?: {
          estimatedDeliveryDate?: string | null;
          latestEstimatedDeliveryDate?: string | null;
        } | null;
        shipping?: {
          shipment?: {
            trackingUrl?: string | null;
            deliveryDate?: string | null;
          } | null;
          returnShipment?: {
            trackingUrl?: string | null;
          } | null;
        } | null;
        currency?: {
          code?: string | null;
        } | null;
        payment?: {
          settledAmount?: {
            value?: number | null;
            currency?: string | null;
          } | null;
          authorizedAmount?: {
            value?: number | null;
            currency?: string | null;
          } | null;
        } | null;
        pricing?: {
          finalized?: {
            local?: {
              total?: string | number | null;
              subtotal?: string | number | null;
            } | null;
          } | null;
        } | null;
        product?: {
          localizedSize?: {
            title?: string | null;
          } | null;
          variant?: {
            id?: string | null;
            product?: {
              title?: string | null;
              brand?: string | null;
              urlKey?: string | null;
              media?: {
                thumbUrl?: string | null;
                imageUrl?: string | null;
              } | null;
            } | null;
          } | null;
        } | null;
      } | null;
    } | null;
  };
  errors?: Array<{
    message: string;
    path?: string[];
    extensions?: {
      httpStatusCode?: number;
    };
  }>;
}

// Legacy type for backward compatibility
type StockXTrackingResponse = StockXFullOrderResponse;

/**
 * Fetch FULL supplier order details from stockx.com GraphQL (Query B)
 * Includes tracking, status, cost, and product info
 * 
 * @param chainId - LONG Chain ID from DB (e.g. "14826275139352606543")
 * @param orderId - Order ID from DB (e.g. "03-9WRPD7UF2G")
 * @returns Full order data including ALL-IN cost
 */
async function fetchStockXTracking(
  chainId: string,
  orderId: string
): Promise<StockXFullOrderResult> {
  // Get token from DB (same as Buying query)
  const token = await getSupplierToken();
  if (!token) {
    throw new Error("Supplier token not found or expired in DB");
  }

  const variables = {
    chainId,
    orderId,
    country: "CH",
    market: "CH",
    isShipByDateEnabled: true,
    isDFSUpdatesEnabled: true,
  };

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "Authorization": `Bearer ${token}`, // Use same token as Buying
    "apollographql-client-name": "Iron",
    "apollographql-client-version": "2026.01.11.01",
    "app-platform": "Iron",
    "app-version": "2026.01.11.01",
    "accept": "application/json",
  };

  const body = {
    operationName: "GET_BUY_ORDER_FULL",
    query: GET_BUY_ORDER_FULL_QUERY,
    variables,
  };

  let lastError: Error | null = null;
  const maxRetries = 2;

  // Retry logic for transient failures
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[STOCKX-ORDER] Fetching full order details for ${orderId} (attempt ${attempt + 1}/${maxRetries + 1})...`);

      const response = await fetch(STOCKX_GRAPHQL_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
      }

      const json: StockXFullOrderResponse = await response.json();

      // Extract data
      const order = json.data?.viewer?.order;
      const trackingUrl = order?.shipping?.shipment?.trackingUrl || null;
      const returnTrackingUrl = order?.shipping?.returnShipment?.trackingUrl || null;
      const deliveryDateStr = order?.shipping?.shipment?.deliveryDate || null;
      const status = order?.status || null;
      const statusKey = order?.currentStatus?.key || null;
      const orderNumberFromResponse = order?.orderNumber || orderId;
      const checkoutType = order?.checkoutType || null;
      const states = normalizeStockXStates(order?.states);
      
      // ✅ STEP B: Derive ALL-IN supplierCost from Query B
      let supplierCostCHF: number | null = null;
      
      // Priority 1: payment.settledAmount.value (most accurate)
      if (order?.payment?.settledAmount?.value != null) {
        supplierCostCHF = Number(order.payment.settledAmount.value);
        console.log(`[STOCKX-ORDER] ✅ Cost from payment.settledAmount: ${supplierCostCHF} CHF`);
      }
      // Priority 2: payment.authorizedAmount.value
      else if (order?.payment?.authorizedAmount?.value != null) {
        supplierCostCHF = Number(order.payment.authorizedAmount.value);
        console.log(`[STOCKX-ORDER] ✅ Cost from payment.authorizedAmount: ${supplierCostCHF} CHF`);
      }
      // Priority 3: pricing.finalized.local.total (fallback)
      else if (order?.pricing?.finalized?.local?.total != null) {
        const totalStr = String(order.pricing.finalized.local.total);
        supplierCostCHF = parseFloat(totalStr);
        if (!isNaN(supplierCostCHF)) {
          console.log(`[STOCKX-ORDER] ✅ Cost from pricing.finalized: ${supplierCostCHF} CHF`);
        } else {
          supplierCostCHF = null;
        }
      }
      
      // Extract delivery dates
      const estimatedDeliveryDateStr = order?.estimatedDeliveryDateRange?.estimatedDeliveryDate || null;
      const latestEstimatedDeliveryDateStr = order?.estimatedDeliveryDateRange?.latestEstimatedDeliveryDate || null;
      
      // Extract product info
      const productTitle = order?.product?.variant?.product?.title || null;
      const brand = order?.product?.variant?.product?.brand || null;
      const size = order?.product?.localizedSize?.title || null;
      const imageUrl = order?.product?.variant?.product?.media?.imageUrl || 
                       order?.product?.variant?.product?.media?.thumbUrl || null;
      const currencyCode = order?.currency?.code || "CHF";

      // CRITICAL: Treat as SUCCESS if order exists (even if partial data or errors)
      if (order) {
        if (json.errors && json.errors.length > 0) {
          console.log(`[STOCKX-ORDER] ⚠️ GraphQL errors present but data retrieved:`, json.errors);
        }

        // Extract AWB from tracking URL
        const awb = extractAwbFromTrackingUrl(trackingUrl);
        if (awb) {
          console.log(`[STOCKX-ORDER] ✅ Extracted AWB: ${awb}`);
        }

        console.log(`[STOCKX-ORDER] ✅ Full order data retrieved for ${orderNumberFromResponse}`);
        return {
          orderNumber: orderNumberFromResponse,
          chainId,
          checkoutType,
          status,
          statusKey,
          trackingUrl,
          returnTrackingUrl,
          deliveryDate: deliveryDateStr ? new Date(deliveryDateStr) : null,
          estimatedDeliveryDate: estimatedDeliveryDateStr ? new Date(estimatedDeliveryDateStr) : null,
          latestEstimatedDeliveryDate: latestEstimatedDeliveryDateStr ? new Date(latestEstimatedDeliveryDateStr) : null,
          awb,
          supplierCostCHF,
          currencyCode,
          productTitle,
          brand,
          size,
          imageUrl,
          states,
        };
      }

      // If no order data and errors exist, log and throw
      if (json.errors && json.errors.length > 0) {
        console.error(`[STOCKX-ORDER] GraphQL errors and no data:`, json.errors);
        throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
      }

      // No data, no errors (empty response)
      throw new Error("No order data returned");

    } catch (error: any) {
      lastError = error;
      console.error(`[STOCKX-ORDER] Attempt ${attempt + 1} failed:`, error.message);

      // Retry on 5xx or network errors
      if (attempt < maxRetries && (error.message.includes("HTTP 5") || error.message.includes("fetch"))) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt), 5000);
        console.log(`[STOCKX-ORDER] Retrying in ${backoffMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      } else {
        break;
      }
    }
  }

  throw lastError || new Error("Failed to fetch order details after retries");
}

/**
 * Fetch and upsert full order details (tracking + cost) for a supplier order
 * 
 * @param chainId - Chain ID
 * @param orderNumber - Order number
 * @param prisma - Prisma client instance
 * @param force - Force refresh even if data already exists
 * @returns Upserted tracking record or null on error
 */
async function fetchAndUpsertTracking(
  chainId: string,
  orderNumber: string,
  prisma: any,
  force: boolean = false
): Promise<any | null> {
  try {
    // Check if data already exists
    if (!force) {
      const existing = await prisma.supplierOrderTracking.findUnique({
        where: {
          chainId_orderNumber: { chainId, orderNumber },
        },
      });

      if (existing && existing.trackingUrl) {
        console.log(`[STOCKX-ORDER] Order data already exists for ${orderNumber}, skipping`);
        return existing;
      }
    }

    // Fetch full order details (including cost)
    const orderData = await fetchStockXTracking(chainId, orderNumber);

    // Upsert to DB
    const record = await prisma.supplierOrderTracking.upsert({
      where: {
        chainId_orderNumber: { chainId, orderNumber },
      },
      update: {
        trackingUrl: orderData.trackingUrl,
        returnTrackingUrl: orderData.returnTrackingUrl,
        deliveryDate: orderData.deliveryDate,
        statusKey: orderData.statusKey,
        awb: orderData.awb,
        updatedAt: new Date(),
      },
      create: {
        chainId,
        orderNumber,
        trackingUrl: orderData.trackingUrl,
        returnTrackingUrl: orderData.returnTrackingUrl,
        deliveryDate: orderData.deliveryDate,
        statusKey: orderData.statusKey,
        awb: orderData.awb,
      },
    });

    console.log(`[STOCKX-ORDER] ✅ Upserted order data for ${orderNumber}`);
    return record;

  } catch (error: any) {
    console.error(`[STOCKX-ORDER] ❌ Failed to fetch/upsert order data for ${orderNumber}:`, error.message);
    return null;
  }
}

