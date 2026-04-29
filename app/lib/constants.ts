export const DEFAULT_QUERY = `query Buying(
  $first: Int
  $after: String
  $currencyCode: CurrencyCode
  $query: String
  $state: BuyingGeneralState
  $sort: BuyingSortInput
  $order: AscDescOrderInput
) {
  viewer {
    buying(
      query: $query
      state: $state
      currencyCode: $currencyCode
      first: $first
      after: $after
      sort: $sort
      order: $order
    ) {
      edges {
        node {
          chainId
          orderId
          orderNumber
          amount
          currencyCode
          purchaseDate
          creationDate
          estimatedDeliveryDateRange {
            estimatedDeliveryDate
            latestEstimatedDeliveryDate
          }
          state {
            statusKey
            statusTitle
          }
          localizedSizeTitle
          localizedSizeType
          productVariant {
            id
            traits {
              size
              sizeDescriptor
            }
            sizeChart {
              baseType
              baseSize
              displayOptions {
                size
                type
              }
            }
            product {
              id
              name
              title
              model
              styleId
              primaryCategory
              productCategory
              contentGroup
              media {
                thumbUrl
              }
            }
          }
        }
      }
      pageInfo {
        endCursor
        hasNextPage
        totalCount
        startCursor
        hasPreviousPage
      }
    }
  }
}`;

export const DEFAULT_VARIABLES = {
  first: 50,
  after: "",
  currencyCode: "CHF",
  query: null,
  state: "PENDING",
  sort: "MATCHED_AT",
  order: "DESC",
};

/** Legacy VPS working payload (StockX Pro) */
export const STOCKX_LEGACY_OPERATION_NAME = "Buying";
export const STOCKX_LEGACY_PERSISTED_QUERY_HASH =
  "";
export const STOCKX_LEGACY_VARIABLES = {
  first: 50,
  after: "",
  currencyCode: "CHF",
  query: null,
  state: "PENDING",
  sort: "MATCHED_AT",
  order: "DESC",
};

/** Same as browser Network → graphql for pending bids list (hash can change on deploy). */
export const STOCKX_PERSISTED_OPERATION_NAME = "FetchCurrentBids";
export const STOCKX_PERSISTED_QUERY_HASH =
  "a8c817d79585ec38b73a23a9487291b17924084b40ad5e934e5a10dfd068ad3c";
export const STOCKX_PERSISTED_VARIABLES = {
  first: 100,
  state: "PENDING",
  sort: "MATCHED_AT",
  order: "DESC",
  currencyCode: "CHF",
  market: "CH",
  country: "CH",
  page: { index: 1 },
};

/** Single buy order (tracking, AWB, pricing) — same as browser persisted op. Hash changes on deploy. */
export const STOCKX_GET_BUY_ORDER_OPERATION_NAME = "getBuyOrder";
export const STOCKX_GET_BUY_ORDER_PERSISTED_HASH =
  "8f8967d0168d4c3a6990f7d48ceb038f7b7332dd255f64442aacc43ffa037107";

/** Purchase pricing persisted op (estimate total/adjustments). */
export const STOCKX_PURCHASE_PRICING_OPERATION_NAME = "PurchasePricing";
export const STOCKX_PURCHASE_PRICING_PERSISTED_HASH =
  "fd0522ecdbc464f7870ad6725768048a45ed761573dc26d249574be9e8562a0e";

