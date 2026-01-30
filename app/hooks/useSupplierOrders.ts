import { useState } from "react";
import { DEFAULT_QUERY, DEFAULT_VARIABLES } from "@/app/lib/constants";
import { extractAwbFromTrackingUrl } from "@/app/utils/format";
import type { OrderNode, PageInfo, PricingResult } from "@/app/types";
import { postJson } from "@/app/lib/api";

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
                  lowestAsk {
                    amount
                  }
                  highestBid {
                    amount
                  }
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
                defaultSizeConversion {
                  name
                  type
                }
                media {
                  thumbUrl
                  smallImageUrl
                  imageUrl
                }
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
          currency {
            code
          }
          returnDetails {
            refundMechanism
            type
          }
          return {
            returnDetails {
              refundMechanism
              type
            }
            shipping {
              shipment {
                documents {
                  returnInstructions
                }
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
            settledAmount {
              value
              currency
            }
            authorizedAmount {
              value
              currency
            }
            transactions {
              paymentInstrument {
                descriptor
                type
                cardType
              }
              authorizedAmount {
                value
                currency
              }
              settledAmount {
                value
                currency
              }
              provider
              id
              token
              status
              method {
                id
                type
              }
            }
          }
          shipping {
            shipment {
              trackingUrl
              deliveryDate
            }
            returnShipment {
              documents {
                returnInstructions
              }
              trackingUrl
            }
          }
          resellNoFee {
            eligible
            expiresAt
            eligibilityDays
          }
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
              monday {
                open
                close
              }
              tuesday {
                open
                close
              }
              wednesday {
                open
                close
              }
              thursday {
                open
                close
              }
              friday {
                open
                close
              }
              saturday {
                open
                close
              }
              sunday {
                open
                close
              }
            }
          }
        }
      }
    }
  }
`;

type FetchPageArgs = {
  token: string;
  query: string;
  variablesJSON: string;
  stateFilter: string;
  cursor?: string | null;
  append?: boolean;
};

type FetchAllArgs = {
  token: string;
  query: string;
  variablesJSON: string;
  stateFilter: string;
};

export function useSupplierOrders() {
  const [orders, setOrders] = useState<OrderNode[]>([]);
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [lastStatus, setLastStatus] = useState<number | null>(null);
  const [lastErrors, setLastErrors] = useState<any[]>([]);
  const [enrichedOrders, setEnrichedOrders] = useState<any[] | null>(null);
  const [isEnriching, setIsEnriching] = useState(false);
  const [detailsProgress, setDetailsProgress] = useState({ done: 0, total: 0 });
  const [loading, setLoading] = useState(false);
  const [isFetchingAll, setIsFetchingAll] = useState(false);
  const [pricingByOrder, setPricingByOrder] = useState<Record<string, PricingResult | null>>({});
  const [pricingLoading, setPricingLoading] = useState<Record<string, boolean>>({});

  const fetchPage = async ({
    token,
    query,
    variablesJSON,
    stateFilter,
    cursor = null,
    append = false,
  }: FetchPageArgs) => {
    if (!token.trim()) {
      alert("Please enter a Bearer token");
      return null;
    }

    setLoading(true);
    try {
      const vars = JSON.parse(variablesJSON || JSON.stringify(DEFAULT_VARIABLES));
      const stateValue = stateFilter.trim() === "" ? null : stateFilter.trim();
      const afterValue = cursor === null ? "" : cursor;
      const updatedVars = { ...vars, after: afterValue, state: stateValue };

      const response = await fetch("/api/stockx", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token,
          operationName: "Buying",
          query,
          variables: updatedVars,
        }),
      });

      setLastStatus(response.status);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        setLastErrors([{ message: `HTTP ${response.status}: ${errorData.error || "Unknown error"}` }]);
        return null;
      }

      const data = await response.json();
      if (data.errors) {
        setLastErrors(data.errors);
        return null;
      }

      setLastErrors([]);

      const buyingData = data.data?.viewer?.buying;
      if (!buyingData) {
        setLastErrors([{ message: "No buying data in response" }]);
        return null;
      }

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
      if (append) {
        setOrders((prev) => [...prev, ...newOrders]);
      } else {
        setOrders(newOrders);
      }
      setPageInfo(newPageInfo);
      return { pageInfo: newPageInfo, orders: newOrders };
    } catch (error: any) {
      setLastErrors([{ message: error.message }]);
      return null;
    } finally {
      setLoading(false);
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

  const handleFetchAllPages = async ({ token, query, variablesJSON, stateFilter }: FetchAllArgs) => {
    setIsFetchingAll(true);
    setIsEnriching(false);
    setOrders([]);
    setPageInfo(null);
    setEnrichedOrders(null);
    setDetailsProgress({ done: 0, total: 0 });

    const allLoadedOrders: OrderNode[] = [];
    let currentResult = await fetchPage({ token, query, variablesJSON, stateFilter, cursor: null, append: false });
    if (currentResult) {
      allLoadedOrders.push(...currentResult.orders);
    }
    while (currentResult?.pageInfo?.hasNextPage && currentResult?.pageInfo?.endCursor) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      currentResult = await fetchPage({
        token,
        query,
        variablesJSON,
        stateFilter,
        cursor: currentResult.pageInfo.endCursor,
        append: true,
      });
      if (currentResult) {
        allLoadedOrders.push(...currentResult.orders);
      }
    }

    setIsFetchingAll(false);

    if (allLoadedOrders.length === 0) {
      console.error("[ENRICH] ❌ No orders found! Check if fetchPage is working correctly.");
      alert("❌ No orders to enrich. Please try fetching again.");
      return;
    }

    setIsEnriching(true);
    const total = allLoadedOrders.length;
    const enriched: any[] = [];
    let done = 0;

    const fetchOrderDetails = async (node: OrderNode): Promise<any> => {
      try {
        const variables = {
          chainId: node.chainId,
          orderId: node.orderId,
          country: "CH",
          market: "CH",
          isShipByDateEnabled: true,
          isDFSUpdatesEnabled: true,
        };

        const response = await fetch("/api/stockx", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            token,
            operationName: "GET_BUY_ORDER",
            query: GET_BUY_ORDER_QUERY,
            variables,
          }),
        });

        const json = await response.json();
        const buyOrder = json.data?.viewer?.order || null;
        const errors = json.errors || [];

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

        const enrichedData = {
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
        };

        return {
          node,
          enriched: enrichedData,
          success: !!buyOrder,
          productTitleB: productTitleB || null,
          sizeB: sizeB || null,
          brandB: brandB || null,
          supplierCost: supplierCost || null,
          statusKeyB: statusKeyB || null,
          statusB: statusB || null,
          awb: awb || null,
          trackingUrl: trackingUrl || null,
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
          success: false,
          error: error.message,
        };
      }
    };

    const BATCH_SIZE = 30;
    const BATCH_DELAY_MS = 1000;
    const totalBatches = Math.ceil(total / BATCH_SIZE);

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const batchStart = batchIndex * BATCH_SIZE;
      const batchEnd = Math.min(batchStart + BATCH_SIZE, total);
      const batch = allLoadedOrders.slice(batchStart, batchEnd);

      const batchResults = await Promise.all(batch.map((node) => fetchOrderDetails(node)));

      for (const result of batchResults) {
        enriched.push(result.enriched);
        done++;
        setDetailsProgress({ done, total });
      }

      if (batchIndex + 1 < totalBatches) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }

    const enrichedIds = enriched.map((o) => o.orderId);
    const uniqueIds = new Set(enrichedIds);
    if (uniqueIds.size !== enriched.length) {
      const seen = new Set<string>();
      const deduplicated = enriched.filter((o: any) => {
        if (seen.has(o.orderId)) return false;
        seen.add(o.orderId);
        return true;
      });
      setEnrichedOrders(deduplicated);
    } else {
      setEnrichedOrders(enriched);
    }

    setIsEnriching(false);
  };

  return {
    orders,
    pageInfo,
    lastStatus,
    lastErrors,
    enrichedOrders,
    isEnriching,
    detailsProgress,
    loading,
    isFetchingAll,
    pricingByOrder,
    pricingLoading,
    fetchPage,
    handleFetchAllPages,
    fetchPricingForOrder,
    fetchAllPricing,
    setOrders,
    setPageInfo,
    setLastStatus,
    setLastErrors,
    setEnrichedOrders,
  };
}

