import { useState } from "react";
import {
  DEFAULT_QUERY,
  DEFAULT_VARIABLES,
  STOCKX_GET_BUY_ORDER_OPERATION_NAME,
  STOCKX_LEGACY_OPERATION_NAME,
  STOCKX_LEGACY_VARIABLES,
  STOCKX_PERSISTED_OPERATION_NAME,
  STOCKX_PERSISTED_QUERY_HASH,
  STOCKX_PERSISTED_VARIABLES,
} from "@/app/lib/constants";
import { extractAwbFromTrackingUrl } from "@/app/utils/format";
import type { OrderNode, PageInfo, PricingResult } from "@/app/types";
import { postJson } from "@/app/lib/api";

type FetchPageArgs = {
  token: string;
  operationName: string;
  query: string;
  persistedQueryHash?: string;
  variablesJSON: string;
  stateFilter: string;
  cursor?: string | null;
  append?: boolean;
  /** 1-based page for ops that use `variables.page.index` (e.g. FetchCurrentBids). */
  stockxPageIndex?: number | null;
  /** Internal retry guard for duplicate FetchCurrentBids pages. */
  retryDepth?: number;
};

type FetchAllArgs = {
  token: string;
  operationName: string;
  query: string;
  persistedQueryHash?: string;
  variablesJSON: string;
  stateFilter: string;
  goatCookie?: string;
  goatCsrfToken?: string;
};

type EnrichLoadedArgs = {
  token: string;
  detailPersistedQueryHash?: string;
};

const DETAIL_REQUEST_TIMEOUT_MS = 2000;

export function useSupplierOrders() {
  const [orders, setOrders] = useState<OrderNode[]>([]);
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [lastStatus, setLastStatus] = useState<number | null>(null);
  const [lastErrors, setLastErrors] = useState<any[]>([]);
  const [lastRequestPayload, setLastRequestPayload] = useState<Record<string, unknown> | null>(null);
  const [lastResponsePayload, setLastResponsePayload] = useState<any | null>(null);
  const [enrichedOrders, setEnrichedOrders] = useState<any[] | null>(null);
  const [isEnriching, setIsEnriching] = useState(false);
  const [detailsProgress, setDetailsProgress] = useState({ done: 0, total: 0 });
  const [loading, setLoading] = useState(false);
  const [isFetchingAll, setIsFetchingAll] = useState(false);
  const [pricingByOrder, setPricingByOrder] = useState<Record<string, PricingResult | null>>({});
  const [pricingLoading, setPricingLoading] = useState<Record<string, boolean>>({});
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const isRetryableStatus = (status: number) => status === 429 || status === 502 || status === 503 || status === 504;
  const hasRetryableGraphQLError = (errors: any[]): boolean =>
    errors.some((error) => {
      const msg = String(error?.message ?? "").toLowerCase();
      return (
        msg.includes("rate") ||
        msg.includes("throttl") ||
        msg.includes("too many") ||
        msg.includes("timeout") ||
        msg.includes("temporar")
      );
    });

  const fetchPage = async ({
    token,
    operationName,
    query,
    persistedQueryHash,
    variablesJSON,
    stateFilter,
    cursor = null,
    append = false,
    stockxPageIndex = null,
    retryDepth = 0,
  }: FetchPageArgs) => {
    if (!token.trim()) {
      alert("Please enter a Bearer token");
      return null;
    }

    if (retryDepth === 0) {
      setLoading(true);
    }
    try {
      const hash = persistedQueryHash?.trim();
      const requestedOpName = String(operationName || "").trim() || "Buying";
      const isPersistedListHash = hash === STOCKX_PERSISTED_QUERY_HASH;
      const opName = isPersistedListHash ? STOCKX_PERSISTED_OPERATION_NAME : requestedOpName;
      const fallbackVars =
        opName === STOCKX_PERSISTED_OPERATION_NAME
          ? STOCKX_PERSISTED_VARIABLES
          : opName === STOCKX_LEGACY_OPERATION_NAME
            ? STOCKX_LEGACY_VARIABLES
            : DEFAULT_VARIABLES;
      const vars = JSON.parse(variablesJSON || JSON.stringify(fallbackVars));
      const updatedVars = { ...vars } as Record<string, unknown>;
      const isFetchCurrentBids = opName === STOCKX_PERSISTED_OPERATION_NAME;
      const orderKey = (order: OrderNode) =>
        `${String(order.chainId || "").trim()}::${String(order.orderId || "").trim()}::${String(order.orderNumber || "").trim()}`;
      const stateValue = stateFilter.trim() === "" ? null : stateFilter.trim();
      const afterValue = cursor === null ? "" : cursor;
      if (isFetchCurrentBids) {
        const firstRaw = Number(updatedVars.first);
        const requestedFirst =
          Number.isFinite(firstRaw) && firstRaw > 0 ? firstRaw : STOCKX_PERSISTED_VARIABLES.first;
        // Keep first page above 50 even if old localStorage saved lower values.
        updatedVars.first = Math.max(60, Math.min(100, requestedFirst));
        updatedVars.sort =
          typeof updatedVars.sort === "string" && updatedVars.sort
            ? updatedVars.sort
            : STOCKX_PERSISTED_VARIABLES.sort;
        updatedVars.order =
          typeof updatedVars.order === "string" && updatedVars.order
            ? updatedVars.order
            : STOCKX_PERSISTED_VARIABLES.order;
        updatedVars.currencyCode =
          typeof updatedVars.currencyCode === "string" && updatedVars.currencyCode
            ? updatedVars.currencyCode
            : STOCKX_PERSISTED_VARIABLES.currencyCode;
        updatedVars.market =
          typeof updatedVars.market === "string" && updatedVars.market
            ? updatedVars.market
            : STOCKX_PERSISTED_VARIABLES.market;
        updatedVars.country =
          typeof updatedVars.country === "string" && updatedVars.country
            ? updatedVars.country
            : STOCKX_PERSISTED_VARIABLES.country;
        updatedVars.after = afterValue;
        delete updatedVars.query;
        delete updatedVars.page;
      } else if (Object.prototype.hasOwnProperty.call(updatedVars, "after")) {
        updatedVars.after = afterValue;
      }
      if (
        !isFetchCurrentBids &&
        stockxPageIndex != null &&
        updatedVars.page &&
        typeof updatedVars.page === "object" &&
        !Array.isArray(updatedVars.page)
      ) {
        updatedVars.page = { ...(updatedVars.page as Record<string, unknown>), index: stockxPageIndex };
      }
      if (Object.prototype.hasOwnProperty.call(updatedVars, "state")) {
        if (stateValue === null) {
          if (isFetchCurrentBids) {
            updatedVars.state = STOCKX_PERSISTED_VARIABLES.state;
          } else {
            delete updatedVars.state;
          }
        } else {
          updatedVars.state = stateValue;
        }
      } else if (isFetchCurrentBids && stateValue !== null) {
        updatedVars.state = stateValue;
      }

      const requestBody: Record<string, unknown> = {
        token,
        operationName: opName,
        variables: updatedVars,
      };
      if (isFetchCurrentBids) {
        // Keep list flow independent from detail hash input.
        // Backend resolves latest FetchCurrentBids hash from captured store/fallbacks.
        requestBody.query = "";
      } else if (!hash) {
        requestBody.query = query;
      } else {
        requestBody.extensions = {
          persistedQuery: { version: 1, sha256Hash: hash },
        };
      }
      setLastRequestPayload(requestBody);
      const MAX_PAGE_RETRIES = 4;
      let data: any = null;
      let responseStatus = 0;
      let lastErrorData: any = null;
      for (let attempt = 1; attempt <= MAX_PAGE_RETRIES; attempt += 1) {
        const response = await fetch("/api/stockx", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        });
        responseStatus = response.status;
        setLastStatus(response.status);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          lastErrorData = errorData;
          const retryable =
            isRetryableStatus(response.status) || response.status >= 500;
          if (retryable && attempt < MAX_PAGE_RETRIES) {
            const backoffMs =
              Math.min(450 * 2 ** (attempt - 1), 4000) + Math.floor(Math.random() * 180);
            await sleep(backoffMs);
            continue;
          }
          setLastResponsePayload(errorData);
          setLastErrors([{ message: `HTTP ${response.status}: ${errorData.error || "Unknown error"}` }]);
          return null;
        }

        data = await response.json().catch(() => null);
        if (!data) {
          if (attempt < MAX_PAGE_RETRIES) {
            const backoffMs = Math.min(400 * 2 ** (attempt - 1), 3200) + Math.floor(Math.random() * 160);
            await sleep(backoffMs);
            continue;
          }
          setLastResponsePayload(lastErrorData || { error: "Invalid JSON response" });
          setLastErrors([{ message: "Invalid JSON response from /api/stockx" }]);
          return null;
        }

        const gqlErrors = Array.isArray(data?.errors) ? data.errors : [];
        const hasViewerPayload = Boolean(data?.data?.viewer);
        const retryableGraphql = hasRetryableGraphQLError(gqlErrors);
        if (!hasViewerPayload && retryableGraphql && attempt < MAX_PAGE_RETRIES) {
          const backoffMs = Math.min(450 * 2 ** (attempt - 1), 3800) + Math.floor(Math.random() * 180);
          await sleep(backoffMs);
          continue;
        }
        break;
      }

      if (!data) {
        setLastResponsePayload(lastErrorData || { error: "Unknown StockX fetch error" });
        setLastErrors([{ message: `StockX fetch failed (status ${responseStatus || "unknown"})` }]);
        return null;
      }

      setLastResponsePayload(data);
      if (data.errors) {
        setLastErrors(data.errors);
        // Allow partial data when viewer payload exists (buying list or FetchBuyQty summary)
        if (!data.data?.viewer) {
          return null;
        }
      }

      setLastErrors([]);

      const viewer = data.data?.viewer;
      const buyingData = viewer?.buying;
      const op = String(operationName || "").trim();

      if (buyingData) {
        const edges = buyingData.edges ?? [];
        const newOrders: OrderNode[] = edges.map((edge: any) => {
          const n = edge?.node ?? {};
          const product = n.productVariant?.product ?? {};
          const styleId = product.styleId?.trim() || null;
          const model = product.model?.trim() || null;
          const productName = product.name || null;
          const productTitle = product.title || null;
          const productVariantId = n.productVariant?.id ?? null;
          const skuKey = styleId || model || product.id || productVariantId || "unknown";
          const displayName = productTitle || productName || "—";
          const displayOptions = n.productVariant?.sizeChart?.displayOptions ?? [];
          const euOption = displayOptions.find((opt: any) => opt.type === "eu");
          let size: string | null = null;
          if (euOption?.size) {
            size = euOption.size;
          } else if (n.localizedSizeTitle) {
            size = n.localizedSizeTitle;
          } else {
            const baseSize = n.productVariant?.sizeChart?.baseSize;
            const baseTypeRaw = n.productVariant?.sizeChart?.baseType || "";
            const baseType = baseTypeRaw.toLowerCase();
            if (baseSize) {
              if (baseType.includes("eu")) {
                size = `EU ${baseSize}`;
              } else if (baseType.includes("us")) {
                size = `US ${baseSize}`;
              } else if (baseType.includes("uk")) {
                size = `UK ${baseSize}`;
              } else if (baseType.includes("asia")) {
                size = `ASIA ${baseSize}`;
              } else {
                size = `${baseTypeRaw.toUpperCase()} ${baseSize}`.trim();
              }
            } else {
              size = null;
            }
          }

          const purchaseDate = n.purchaseDate ?? null;
          const purchaseDateFormatted = purchaseDate
            ? new Date(purchaseDate).toLocaleString("fr-CH", {
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })
            : null;

          const estimatedDeliveryDate = n.estimatedDeliveryDateRange?.estimatedDeliveryDate ?? null;
          const estimatedDeliveryFormatted = estimatedDeliveryDate ? new Date(estimatedDeliveryDate).toLocaleDateString() : null;
          const latestEstimatedDeliveryDate = n.estimatedDeliveryDateRange?.latestEstimatedDeliveryDate ?? null;

          return {
            chainId: n.chainId ?? "",
            orderId: n.orderId ?? "",
            orderNumber: n.orderNumber ?? null,
            purchaseDate,
            purchaseDateFormatted,
            statusKey: n.state?.statusKey ?? null,
            statusTitle: n.state?.statusTitle ?? null,
            amount: typeof n.amount === "number" ? n.amount : null,
            currencyCode: n.currencyCode ?? null,
            productName,
            productTitle,
            displayName,
            styleId,
            model,
            skuKey,
            size,
            sizeType: n.localizedSizeType ?? null,
            estimatedDeliveryDate,
            estimatedDeliveryFormatted,
            latestEstimatedDeliveryDate,
            productVariantId,
            thumbUrl: product.media?.thumbUrl ?? null,
          };
        });

        const newPageInfo = buyingData.pageInfo;
        const existingOrderKeys = append ? new Set((orders || []).map(orderKey)) : new Set<string>();
        const uniqueNewOrders = append
          ? newOrders.filter((order) => !existingOrderKeys.has(orderKey(order)))
          : newOrders;
        if (
          append &&
          isFetchCurrentBids &&
          stockxPageIndex != null &&
          uniqueNewOrders.length === 0 &&
          Boolean(newPageInfo?.hasNextPage) &&
          retryDepth < 10
        ) {
          console.warn("[FETCH] Duplicate page detected, advancing index", {
            fromIndex: stockxPageIndex,
            toIndex: stockxPageIndex + 1,
            retryDepth: retryDepth + 1,
          });
          return await fetchPage({
            token,
            operationName: opName,
            query,
            persistedQueryHash: hash,
            variablesJSON,
            stateFilter,
            cursor,
            append,
            stockxPageIndex: stockxPageIndex + 1,
            retryDepth: retryDepth + 1,
          });
        }
        if (append) {
          setOrders((prev) => {
            const seen = new Set(prev.map(orderKey));
            const merged = [...prev];
            for (const order of newOrders) {
              const key = orderKey(order);
              if (seen.has(key)) continue;
              seen.add(key);
              merged.push(order);
            }
            return merged;
          });
        } else {
          setOrders(newOrders);
        }
        setPageInfo(newPageInfo);
        return {
          pageInfo: newPageInfo,
          orders: append ? uniqueNewOrders : newOrders,
          stockxPageIndexUsed: stockxPageIndex,
        };
      }

      const hasFetchBuyQtyShape = Boolean(
        viewer &&
          ("pendingQty" in viewer || "historicalQty" in viewer || "currentQty" in viewer)
      );
      const isExplicitFetchBuyQty = op === "FetchBuyQty";

      if (isExplicitFetchBuyQty && hasFetchBuyQtyShape && viewer) {
        const pending = viewer?.pendingQty?.pageInfo?.totalCount;
        const historical = viewer?.historicalQty?.pageInfo?.totalCount;
        const currentEdges = viewer?.currentQty?.edges ?? [];
        const currentTotal = viewer?.currentQty?.pageInfo?.totalCount;
        const rows: OrderNode[] = [];
        if (typeof pending === "number") {
          rows.push({
            chainId: "",
            orderId: "",
            orderNumber: `pendingQty:${pending}`,
            purchaseDate: null,
            purchaseDateFormatted: null,
            statusKey: "PENDING",
            statusTitle: `Pending qty total: ${pending}`,
            amount: pending,
            currencyCode: null,
            productName: null,
            productTitle: null,
            displayName: "FetchBuyQty — pending",
            styleId: null,
            model: null,
            skuKey: "stockx-fetch-buy-qty",
            size: null,
            sizeType: null,
            estimatedDeliveryDate: null,
            estimatedDeliveryFormatted: null,
            latestEstimatedDeliveryDate: null,
            productVariantId: null,
            thumbUrl: null,
          });
        }
        if (typeof historical === "number") {
          rows.push({
            chainId: "",
            orderId: "",
            orderNumber: `historicalQty:${historical}`,
            purchaseDate: null,
            purchaseDateFormatted: null,
            statusKey: "HISTORICAL",
            statusTitle: `Historical qty total: ${historical}`,
            amount: historical,
            currencyCode: null,
            productName: null,
            productTitle: null,
            displayName: "FetchBuyQty — historical",
            styleId: null,
            model: null,
            skuKey: "stockx-fetch-buy-qty",
            size: null,
            sizeType: null,
            estimatedDeliveryDate: null,
            estimatedDeliveryFormatted: null,
            latestEstimatedDeliveryDate: null,
            productVariantId: null,
            thumbUrl: null,
          });
        }
        if (typeof currentTotal === "number") {
          rows.push({
            chainId: "",
            orderId: "",
            orderNumber: `currentQty:${currentTotal}`,
            purchaseDate: null,
            purchaseDateFormatted: null,
            statusKey: "CURRENT",
            statusTitle: `Current qty total: ${currentTotal}`,
            amount: currentTotal,
            currencyCode: null,
            productName: null,
            productTitle: null,
            displayName: "FetchBuyQty — current (summary)",
            styleId: null,
            model: null,
            skuKey: "stockx-fetch-buy-qty",
            size: null,
            sizeType: null,
            estimatedDeliveryDate: null,
            estimatedDeliveryFormatted: null,
            latestEstimatedDeliveryDate: null,
            productVariantId: null,
            thumbUrl: null,
          });
        }
        for (let i = 0; i < currentEdges.length; i += 1) {
          const exp = currentEdges[i]?.node?.expirationDate ?? null;
          rows.push({
            chainId: "",
            orderId: `current-edge-${i}`,
            orderNumber: exp ? `currentExpiry:${String(exp)}` : `currentEdge:${i}`,
            purchaseDate: null,
            purchaseDateFormatted: null,
            statusKey: "CURRENT",
            statusTitle: exp ? `Expiration: ${exp}` : "Current qty edge",
            amount: null,
            currencyCode: null,
            productName: null,
            productTitle: null,
            displayName: exp || "—",
            styleId: null,
            model: null,
            skuKey: "stockx-fetch-buy-qty",
            size: null,
            sizeType: null,
            estimatedDeliveryDate: null,
            estimatedDeliveryFormatted: null,
            latestEstimatedDeliveryDate: null,
            productVariantId: null,
            thumbUrl: null,
          });
        }
        const syntheticPageInfo = {
          endCursor: "",
          hasNextPage: false,
          totalCount: rows.length,
          startCursor: "",
          hasPreviousPage: false,
        };
        if (append) {
          setOrders((prev) => [...prev, ...rows]);
        } else {
          setOrders(rows);
        }
        setPageInfo(syntheticPageInfo);
        return { pageInfo: syntheticPageInfo, orders: rows };
      }

      if (hasFetchBuyQtyShape) {
        setLastErrors([
          {
            message: `Persisted hash does not return buying.edges (got FetchBuyQty summary). Use a Buying/FetchCurrentBids hash. operation=${op} hash=${
              hash || "none"
            }`,
          },
        ]);
        if (!append) {
          setOrders([]);
          setPageInfo(null);
        }
        return null;
      }

      setLastErrors([{ message: "No buying data in response (wrong operation for order list?)" }]);
      return null;
    } catch (error: any) {
      setLastErrors([{ message: error.message }]);
      setLastResponsePayload({ error: error.message });
      return null;
    } finally {
      if (retryDepth === 0) {
        setLoading(false);
      }
    }
  };

  const fetchPricingForOrder = async (order: OrderNode, token: string) => {
    const orderNumber = order.orderNumber;
    if (!orderNumber || !token.trim()) return;
    if (pricingByOrder[orderNumber]) return;

    setPricingLoading((p) => ({ ...p, [orderNumber]: true }));

    const variables = {
      tradeContext: "buying",
      currencyCode: order.currencyCode ?? "CHF",
      orderNumber,
      variants: [
        {
          uuid: order.productVariantId,
          quantity: 1,
          amount: {
            currencyCode: order.currencyCode ?? "CHF",
            value: order.amount,
          },
        },
      ],
    };

    try {
      const res = await fetch("/api/stockx/pricing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, variables }),
      });
      const json = await res.json();
      const estimate = json?.data?.pricing?.estimate;
      if (estimate?.total != null) {
        setPricingByOrder((p) => ({ ...p, [orderNumber]: estimate }));
      } else {
        setPricingByOrder((p) => ({ ...p, [orderNumber]: null }));
      }
    } catch (error) {
      setPricingByOrder((p) => ({ ...p, [orderNumber]: null }));
    }
    setPricingLoading((p) => ({ ...p, [orderNumber]: false }));
  };

  const fetchAllPricing = async (token: string) => {
    if (!token.trim()) {
      alert("Please enter a Bearer token");
      return;
    }
    for (const order of orders) {
      if (!order.orderNumber) continue;
      await fetchPricingForOrder(order, token);
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  };

  const fetchAllGoatOrders = async (goatCookie: string, goatCsrfToken: string) => {
    const token = goatCookie.trim();
    if (!token) return [];

    const allOrders: any[] = [];
    let page = 1;
    while (true) {
      const res = await fetch("/api/goat/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cookie: token, csrfToken: goatCsrfToken, page }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLastErrors((prev) => [
          ...prev,
          { message: `[GOAT] Orders: ${json?.error || `HTTP ${res.status}`}` },
        ]);
        break;
      }
      const orders = Array.isArray(json?.orders) ? json.orders : [];
      if (orders.length === 0) break;
      allOrders.push(...orders);
      page += 1;
    }

    return allOrders.map((o: any) => ({
      ...o,
      productTitleB: o.productTitle || o.displayName || null,
      brandB: null,
      sizeB: o.size || null,
      thumbUrlB: o.thumbUrl || null,
      imageUrlB: o.thumbUrl || null,
      statusB: o.statusTitle || o.statusKey || null,
      statusKeyB: o.statusKey || null,
      estimatedDeliveryB: o.estimatedDeliveryDate || null,
      latestEstimatedDeliveryB: o.latestEstimatedDeliveryDate || null,
      styleId: o.skuKey || o.styleId || null,
    }));
  };

  const deduplicateRows = (rows: any[]) => {
    const seen = new Set<string>();
    return rows.filter((row: any) => {
      const key = `${row?.provider || "STOCKX"}:${row?.orderId || ""}:${row?.orderNumber || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const fetchOrderDetails = async (
    token: string,
    node: OrderNode,
    detailPersistedQueryHash?: string
  ): Promise<any> => {
    try {
      const chainId = String(node.chainId || "").trim();
      if (!chainId) {
        return {
          node,
          enriched: {
            ...node,
            buyOrder: null,
            errors: [{ message: "Missing chainId for getBuyOrder call" }],
            awb: null,
            supplierCost: null,
          },
        };
      }
      const variables = {
        chainId,
        country: "CH",
        market: "CH",
        isShipByDateEnabled: true,
        isDFSUpdatesEnabled: true,
      };

      const detailHash = String(detailPersistedQueryHash || "").trim();
      const requestBody: Record<string, unknown> = {
        token,
        operationName: STOCKX_GET_BUY_ORDER_OPERATION_NAME,
        query: "",
        variables,
      };
      if (detailHash) {
        requestBody.persistedQueryHash = detailHash;
        requestBody.extensions = {
          persistedQuery: { version: 1, sha256Hash: detailHash },
        };
      }
      let json: any = null;
      let responseStatus = 0;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DETAIL_REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch("/api/stockx", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });
        responseStatus = response.status;
        json = await response.json().catch(() => ({}));
      } catch (error: any) {
        if (error?.name === "AbortError") {
          return {
            node,
            enriched: {
              ...node,
              buyOrder: null,
              errors: [{ message: `Detail request timeout after ${DETAIL_REQUEST_TIMEOUT_MS}ms` }],
              awb: null,
              supplierCost: null,
            },
          };
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
      const buyOrder = json.data?.viewer?.order || null;
      const errors = Array.isArray(json?.errors) ? json.errors : [];
      if (!buyOrder && responseStatus >= 400 && errors.length === 0 && json?.error) {
        errors.push({ message: `${json.error}` });
      }

      const trackingUrl = buyOrder?.shipping?.shipment?.trackingUrl || null;
      const awb = extractAwbFromTrackingUrl(trackingUrl);

      const supplierCost =
        buyOrder?.payment?.settledAmount?.value ??
        buyOrder?.payment?.authorizedAmount?.value ??
        buyOrder?.pricing?.finalized?.local?.total ??
        null;

      const productTitleB = buyOrder?.product?.variant?.product?.title || null;
      const brandB = buyOrder?.product?.variant?.product?.brand || null;
      const sizeB = buyOrder?.product?.localizedSize?.title || null;
      const imageUrlB = buyOrder?.product?.variant?.product?.media?.imageUrl || null;
      const thumbUrlB = buyOrder?.product?.variant?.product?.media?.thumbUrl || null;

      const statusB = buyOrder?.status || null;
      const statusKeyB = buyOrder?.currentStatus?.key || null;
      const estimatedDeliveryB = buyOrder?.estimatedDeliveryDateRange?.estimatedDeliveryDate || null;
      const latestEstimatedDeliveryB = buyOrder?.estimatedDeliveryDateRange?.latestEstimatedDeliveryDate || null;
      const checkoutTypeB = buyOrder?.checkoutType || null;
      const statesB = buyOrder?.states || null;

      return {
        node,
        enriched: {
          ...node,
          buyOrder,
          errors,
          awb,
          supplierCost,
          productTitleB,
          brandB,
          sizeB,
          imageUrlB,
          thumbUrlB,
          statusB,
          statusKeyB,
          trackingUrl,
          estimatedDeliveryB,
          latestEstimatedDeliveryB,
          stockxCheckoutType: checkoutTypeB,
          stockxStates: statesB,
        },
      };
    } catch (error: any) {
      return {
        node,
        enriched: {
          ...node,
          buyOrder: null,
          errors: [{ message: error.message }],
          awb: null,
          supplierCost: null,
        },
      };
    }
  };

  const handleFetchAllPages = async ({
    token,
    operationName,
    query,
    persistedQueryHash,
    variablesJSON,
    stateFilter,
    goatCookie = "",
    goatCsrfToken = "",
  }: FetchAllArgs) => {
    const existingGoatRows = ((enrichedOrders || orders) as any[]).filter(
      (row) => String(row?.provider || "").toUpperCase() === "GOAT"
    );

    setIsFetchingAll(true);
    setIsEnriching(false);
    setOrders([]);
    setPageInfo(null);
    setEnrichedOrders(null);
    setDetailsProgress({ done: 0, total: 0 });

    try {
      const allLoadedStockXOrders: OrderNode[] = [];
      let parsedVariables: Record<string, unknown> = {};
      try {
        parsedVariables = JSON.parse(variablesJSON);
      } catch {
        parsedVariables = {};
      }
      const hash = String(persistedQueryHash || "").trim();
      const opName = String(operationName || "").trim();
      const isFetchCurrentBidsMode =
        opName === STOCKX_PERSISTED_OPERATION_NAME || hash === STOCKX_PERSISTED_QUERY_HASH;
      const usesCursorPagination = Object.prototype.hasOwnProperty.call(parsedVariables, "after");
      const usesPageIndexPagination =
        !!parsedVariables.page &&
        typeof parsedVariables.page === "object" &&
        !Array.isArray(parsedVariables.page);
      const useCursorPagination = isFetchCurrentBidsMode || (usesCursorPagination && !usesPageIndexPagination);
      const orderKey = (order: OrderNode) =>
        `${String(order.chainId ?? "").trim()}::${String(order.orderId ?? "").trim()}::${String(order.orderNumber ?? "").trim()}`;

      if (token.trim()) {
        const MAX_STOCKX_PAGES = 60;
        let stockxPageIndex = 1;
        const seenOrderKeys = new Set<string>();
        let noNewPageCount = 0;
        let currentResult = await fetchPage({
          token,
          operationName,
          query,
          persistedQueryHash,
          variablesJSON,
          stateFilter,
          cursor: null,
          append: false,
          stockxPageIndex,
        });
        if (currentResult && typeof (currentResult as any).stockxPageIndexUsed === "number") {
          stockxPageIndex = Number((currentResult as any).stockxPageIndexUsed);
        }
        if (currentResult) {
          for (const order of currentResult.orders) {
            const key = orderKey(order);
            if (seenOrderKeys.has(key)) continue;
            seenOrderKeys.add(key);
            allLoadedStockXOrders.push(order);
          }
        }
        let lastEndCursor: string | null = null;
        let pageCount = 1;
        const firstPageCount = Math.max(
          1,
          currentResult?.orders?.length ||
            Number((parsedVariables as Record<string, unknown>).first) ||
            20
        );
        const firstTotalCount = Math.max(0, Number(currentResult?.pageInfo?.totalCount || 0));
        const estimatedMaxPages =
          firstTotalCount > 0
            ? Math.min(MAX_STOCKX_PAGES, Math.max(3, Math.ceil(firstTotalCount / firstPageCount) + 1))
            : MAX_STOCKX_PAGES;
        const effectiveMaxPages = useCursorPagination ? MAX_STOCKX_PAGES : estimatedMaxPages;
        while (currentResult?.pageInfo?.hasNextPage && (useCursorPagination ? currentResult?.pageInfo?.endCursor : true)) {
          const ec = String(currentResult.pageInfo.endCursor ?? "");
          if (useCursorPagination && ec === lastEndCursor) {
            console.warn("[FETCH] StockX pagination stuck (same endCursor); stop.");
            break;
          }
          if (useCursorPagination) {
            lastEndCursor = ec;
          }
          if (pageCount >= effectiveMaxPages) {
            console.warn("[FETCH] StockX pagination max pages:", effectiveMaxPages);
            break;
          }
          pageCount += 1;
          stockxPageIndex += 1;
          await sleep(250);
          currentResult = await fetchPage({
            token,
            operationName,
            query,
            persistedQueryHash,
            variablesJSON,
            stateFilter,
            cursor: useCursorPagination ? currentResult.pageInfo.endCursor : null,
            append: true,
            stockxPageIndex,
          });
          if (!currentResult) break;
          if (typeof (currentResult as any).stockxPageIndexUsed === "number") {
            stockxPageIndex = Number((currentResult as any).stockxPageIndexUsed);
          }
          if (currentResult.orders.length === 0) {
            console.warn("[FETCH] StockX pagination returned empty page; stop.");
            break;
          }
          let pageNewUnique = 0;
          for (const order of currentResult.orders) {
            const key = orderKey(order);
            if (seenOrderKeys.has(key)) continue;
            seenOrderKeys.add(key);
            allLoadedStockXOrders.push(order);
            pageNewUnique += 1;
          }
          if (pageNewUnique === 0) {
            noNewPageCount += 1;
            console.warn("[FETCH] StockX pagination repeated same rows; stop.", {
              pageIndex: stockxPageIndex,
              noNewPageCount,
            });
            if (noNewPageCount >= 2) break;
          } else {
            noNewPageCount = 0;
          }
        }
      }

      const goatOrders =
        goatCookie && goatCookie.trim() ? await fetchAllGoatOrders(goatCookie, goatCsrfToken) : [];
      const goatRowsForMerge = goatOrders.length > 0 ? goatOrders : existingGoatRows;

      if (allLoadedStockXOrders.length === 0 && goatRowsForMerge.length === 0) {
        console.error("[FETCH] ❌ No StockX or GOAT orders found.");
        alert("❌ No orders found from StockX/GOAT. Check credentials and retry.");
        return;
      }

      const combinedOrders = deduplicateRows([...allLoadedStockXOrders, ...goatRowsForMerge]);
      setOrders(combinedOrders as OrderNode[]);
      setEnrichedOrders(null);
      setDetailsProgress({ done: 0, total: 0 });
    } finally {
      setIsFetchingAll(false);
    }
  };

  const handleEnrichLoadedOrders = async ({
    token,
    detailPersistedQueryHash,
  }: EnrichLoadedArgs) => {
    if (!token.trim()) {
      alert("Please enter a Bearer token");
      return;
    }

    const sourceRows = (orders || []) as any[];
    if (sourceRows.length === 0) {
      alert('No orders loaded. Click "📥 Fetch all order numbers (A)" first.');
      return;
    }

    setIsEnriching(true);
    setDetailsProgress({ done: 0, total: 0 });

    try {
      const stockxRows = sourceRows.filter(
        (row) => String(row?.provider || "STOCKX").toUpperCase() !== "GOAT"
      ) as OrderNode[];
      const goatRows = sourceRows.filter(
        (row) => String(row?.provider || "").toUpperCase() === "GOAT"
      );

      const enrichableStockX = stockxRows.filter(
        (row) => String(row.chainId || "").trim() && String(row.orderId || "").trim()
      );
      const total = enrichableStockX.length;
      const enrichedStockX: any[] = [];
      let done = 0;

      // Sequential detail fetch to reduce anti-bot / rate-limit spikes.
      const DETAIL_DELAY_MS = 320;
      const DETAIL_RATE_LIMIT_DELAY_MS = 1200;
      const DETAIL_DELAY_JITTER_MS = 120;
      const isRateLimitedError = (errors: any[]): boolean => {
        const text = errors
          .map((error) => String(error?.message ?? ""))
          .join(" ")
          .toLowerCase();
        return (
          text.includes("429") ||
          text.includes("rate") ||
          text.includes("throttl") ||
          text.includes("too many") ||
          text.includes("timeout") ||
          text.includes("tempor")
        );
      };
      for (let index = 0; index < total; index += 1) {
        const node = enrichableStockX[index];
        const result = await fetchOrderDetails(token, node, detailPersistedQueryHash);
        enrichedStockX.push(result.enriched);
        done += 1;
        setDetailsProgress({ done, total });

        if (index + 1 < total) {
          const errors = Array.isArray(result?.enriched?.errors) ? result.enriched.errors : [];
          const baseDelay = isRateLimitedError(errors) ? DETAIL_RATE_LIMIT_DELAY_MS : DETAIL_DELAY_MS;
          const jitter = Math.floor(Math.random() * DETAIL_DELAY_JITTER_MS);
          await sleep(baseDelay + jitter);
        }
      }

      const detailByChainOrder = new Map<string, any>();
      for (const row of enrichedStockX) {
        const key = `${String(row.chainId ?? "").trim()}::${String(row.orderId ?? "").trim()}`;
        if (key !== "::") detailByChainOrder.set(key, row);
      }

      const fullStockxEnriched = stockxRows.map((node) => {
        const key = `${String(node.chainId ?? "").trim()}::${String(node.orderId ?? "").trim()}`;
        if (detailByChainOrder.has(key)) return detailByChainOrder.get(key);
        return {
          ...node,
          buyOrder: null,
          errors: [{ message: "Detail fetch skipped (missing chainId/orderId)" }],
          awb: null,
          supplierCost: null,
        };
      });

      const combinedEnriched = deduplicateRows([...fullStockxEnriched, ...goatRows]);
      setEnrichedOrders(combinedEnriched);
    } finally {
      setIsEnriching(false);
    }
  };

  return {
    orders,
    pageInfo,
    lastStatus,
    lastErrors,
    lastRequestPayload,
    lastResponsePayload,
    enrichedOrders,
    isEnriching,
    detailsProgress,
    loading,
    isFetchingAll,
    pricingByOrder,
    pricingLoading,
    fetchPage,
    handleFetchAllPages,
    handleEnrichLoadedOrders,
    fetchPricingForOrder,
    fetchAllPricing,
    setOrders,
    setPageInfo,
    setLastStatus,
    setLastErrors,
    setLastRequestPayload,
    setLastResponsePayload,
    setEnrichedOrders,
  };
}

