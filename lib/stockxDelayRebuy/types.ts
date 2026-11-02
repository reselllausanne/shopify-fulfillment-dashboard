import type { PrecheckResult } from "@/lib/stockxAutoCheckout/precheckAvailability";
import type { StockxDesiredLane } from "@/lib/stockxAutoCheckout/types";

/** Why we email the customer about a delay / rebuy. */
export type DelayNarrativeKind =
  /** Seller / supplier did not ship; StockX seeking another (or ETA slipped). */
  | "SUPPLIER_CHANGE_DELAY"
  /** STX buy cancelled / failed legit; we can rebuy — tell client we reordered. */
  | "CANCEL_REBUY_LEGIT"
  /** Cancelled and NOT rebuyable (OOS / margin) — ops only for now. */
  | "CANCEL_NO_REBUY";

export type DelayRebuyCase = {
  orderMatchId: string;
  shopifyOrderName: string;
  shopifyLineItemId: string;
  shopifyOrderId: string;
  productTitle: string;
  sku: string | null;
  sizeEU: string | null;
  saleChf: number;
  imageUrl: string | null;
  customerFirstName: string | null;
  customerEmail: string | null;
  trackingToken: string | null;
  stockxOrderNumber: string | null;
  stockxStatus: string | null;
  checkoutType: string | null;
  /** Lane we would use for rebuy (from original or forced). */
  rebuyLane: StockxDesiredLane;
  etaStart: Date | null;
  etaEnd: Date | null;
  daysPastEta: number | null;
  /** KickDB / SupplierVariant precheck (DB-only, SSE-fed). */
  precheck: PrecheckResult;
  slug: string | null;
  sizeUS: string | null;
  /** Hard StockX /buy/?size= deep link. */
  stockxCheckoutUrl: string | null;
  /** PDP ?size= fallback. */
  stockxPdpUrl: string | null;
  /** New ETA window if we rebuy now on rebuyLane. */
  rebuyEtaStart: Date;
  rebuyEtaEnd: Date;
  /**
   * ETA shown to the customer:
   * - delay: StockX latest end if still in the future, else rebuy window
   * - cancel-rebuy: always rebuy window
   */
  announceEtaStart: Date;
  announceEtaEnd: Date;
};
