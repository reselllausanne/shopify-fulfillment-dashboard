export interface OrderNode {
  chainId: string;
  orderId: string;
  orderNumber: string | null;
  purchaseDate: string | null;
  purchaseDateFormatted: string | null;
  statusKey: string | null;
  statusTitle: string | null;
  amount: number | null;
  currencyCode: string | null;
  productName: string | null;
  productTitle: string | null;
  displayName: string;
  styleId: string | null;
  model: string | null;
  skuKey: string;
  size: string | null;
  sizeType: string | null;
  estimatedDeliveryDate: string | null;
  estimatedDeliveryFormatted: string | null;
  latestEstimatedDeliveryDate: string | null;
  productVariantId: string | null;
  thumbUrl: string | null;
}

export interface PricingResult {
  subtotal: number;
  total: number;
  adjustments: { amount: number; text: string; translationKey: string }[];
}

export interface PageInfo {
  endCursor: string | null;
  hasNextPage: boolean;
  totalCount: number;
  startCursor: string | null;
  hasPreviousPage: boolean;
}

