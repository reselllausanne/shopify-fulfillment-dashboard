export const MAX_ALL_IN_CHF = 250;

export type StockxDesiredLane = "STANDARD" | "EXPRESS";

export type StockxLaneLabel = "STANDARD" | "EXPRESS" | "UNKNOWN";

export type StockxLaneCard = {
  label: StockxLaneLabel;
  rawLabel: string;
  totalChf: number;
  eta?: string | null;
};

/** Why auto-buy stopped and ops must act. */
export type StockxNeedsHumanReason =
  | "oos"
  | "multi_price"
  | "wrong_lane_only"
  | "cap"
  | "size_us_map"
  | "price_moved"
  | "bot_fail"
  | "setup"
  | "margin"
  | "slug"
  | "already_matched"
  | "physical_stock"
  | "pickup";

export type StockxAutoOutcomeKind = "easy_buy" | "needs_human" | "skipped";

export type StockxNeedsHumanPayload = {
  shopifyOrderName: string;
  shopifyOrderId: string | null;
  shopifyLineItemId: string | null;
  title: string;
  sku: string;
  saleChf: number | null;
  slug: string | null;
  productUrl: string | null;
  buyUrl: string | null;
  sizeEU: string;
  sizeUS: string | null;
  desiredLane: StockxDesiredLane;
  lanes: StockxLaneCard[];
  recommended: StockxLaneCard | null;
  reason: StockxNeedsHumanReason;
  detail?: string | null;
};
