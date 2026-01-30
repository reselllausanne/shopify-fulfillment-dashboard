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

