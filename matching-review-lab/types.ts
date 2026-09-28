/**
 * Matching Review Lab — local human-review + dry-run simulation types.
 * Never writes OrderMatch / GalaxusStockxMatch.
 */

import type {
  MatchCandidate,
  NormalizedSupplierOrder,
  ShopifyLineItem,
} from "@/app/utils/matching";

export const MATCHING_REVIEW_REASONS = [
  "WRONG_PRODUCT",
  "WRONG_SIZE",
  "WRONG_GENDER_OR_SIZE_SYSTEM",
  "WRONG_STOCKX_ACCOUNT",
  "WRONG_CAUSAL_DATE",
  "ALREADY_CONSUMED",
  "NO_STOCKX_PURCHASE",
  "ONE_OFF_MANUAL_EXCEPTION",
  "VALID_EQUIVALENCE_TO_REVIEW",
] as const;

export type MatchingReviewReasonCode = (typeof MATCHING_REVIEW_REASONS)[number];

export type MatchingReviewDecision =
  | "CORRECT"
  | "WRONG_PICK_BUY"
  | "NO_STOCKX_MATCH"
  | "SPECIAL_EQUIVALENCE"
  | "NEVER_AUTO_MATCH";

export type LabChannel = "SHOPIFY" | "GALAXUS" | "DECATHLON";

/** Explicit StockX account label used by the lab (not mixed across channels). */
export type StockxAccountKey =
  | `shopify:${string}`
  | `galaxus:${string}`
  | "shopify:default"
  | "galaxus:default"
  | "unknown";

export type LabClientUnit = {
  unitKey: string;
  channel: LabChannel;
  orderId: string;
  orderNumber: string;
  orderDate: string;
  lineId: string;
  unitIndex: number;
  remainingQty: number;
  productTitle: string;
  gtin: string | null;
  sku: string | null;
  styleId: string | null;
  sizeRaw: string | null;
  sizeNormalized: string | null;
  /** Shopify line shape used by matchShopifyToSupplier (Galaxus mapped too). */
  shopifyLine: ShopifyLineItem;
  /** StockX variant id when known (Galaxus stx_… strip). */
  stockxVariantId: string | null;
  stockxAccountKeyExpected: StockxAccountKey;
};

export type LabStockxBuy = Omit<NormalizedSupplierOrder, "productVariantId"> & {
  stockxAccountKey: StockxAccountKey;
  gtin: string | null;
  productVariantId: string | null;
  rawNode?: unknown;
};

export type LabMatchProposal = {
  unit: LabClientUnit;
  proposed: MatchCandidate | null;
  topCandidates: MatchCandidate[];
  matchMethod: "VARIANT_ID" | "NAME_SIZE_TIME" | "FIXED_PRICE" | "LOCAL_STOCK" | "NONE";
  refusalReasons: string[];
  needsGenderOrSizeReview: boolean;
  stockxAccountKey: StockxAccountKey | null;
};

export type LabReviewRecord = {
  id: string;
  reviewedAt: string;
  decision: MatchingReviewDecision;
  reasonCodes: MatchingReviewReasonCode[];
  reasonNote: string | null;
  channel: LabChannel;
  orderId: string;
  orderNumber: string;
  orderDate: string;
  lineId: string;
  unitIndex: number;
  unitKey: string;
  productTitle: string;
  gtinRaw: string | null;
  gtinNormalized: string | null;
  skuRaw: string | null;
  skuNormalized: string | null;
  sizeRaw: string | null;
  sizeNormalized: string | null;
  proposedBuyOrderNumber: string | null;
  proposedBuyOrderId: string | null;
  proposedAccountKey: StockxAccountKey | null;
  proposedPurchaseDate: string | null;
  proposedAwb: string | null;
  proposedReasons: string[];
  chosenBuyOrderNumber: string | null;
  chosenBuyOrderId: string | null;
  chosenAccountKey: StockxAccountKey | null;
  chosenPurchaseDate: string | null;
  chosenAwb: string | null;
  chosenPrice: number | null;
  /** Full raw evidence snapshot (proposal + optional chosen buy). */
  evidence: Record<string, unknown>;
  /** Always false in this lab — documents that live matches were not touched. */
  wroteLiveMatch: false;
};

export type ProposedMatchingRule = {
  id: string;
  title: string;
  conditions: string[];
  confirmingCaseCount: number;
  confirmingUnitKeys: string[];
  counterExamples: string[];
  affectedOrders: string[];
  risk: "low" | "medium" | "high";
  proposedUnitTest: string;
  applied: false;
};

export type MatchingRulesReport = {
  generatedAt: string;
  reviewCount: number;
  decisionCounts: Record<MatchingReviewDecision, number>;
  reasonCounts: Partial<Record<MatchingReviewReasonCode, number>>;
  frequentSkuNormalizationErrors: Array<{ pattern: string; count: number; examples: string[] }>;
  recurrentSizeEquivalences: Array<{ from: string; to: string; count: number; examples: string[] }>;
  stockxAccountErrors: Array<{ expected: string; proposed: string; count: number }>;
  causalDateErrors: Array<{ unitKey: string; orderDate: string; buyDate: string }>;
  missingData: string[];
  generalizableRules: ProposedMatchingRule[];
  manualOnlyExceptions: ProposedMatchingRule[];
  note: string;
};

export type LabSimulateBatchResult = {
  simulatedAt: string;
  stockxFreshness: {
    fetchedAt: string | null;
    fromCache: boolean;
    buyCount: number;
    accounts: Array<{ accountKey: StockxAccountKey; buyCount: number }>;
  };
  proposals: LabMatchProposal[];
  stats: {
    totalUnits: number;
    withProposal: number;
    withoutProposal: number;
    high: number;
    medium: number;
    low: number;
    genderOrSizeReview: number;
  };
};
