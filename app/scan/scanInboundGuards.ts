/**
 * Client-side guards for /scan behavior when a scanned AWB collides with an
 * inbound StockX buy. Pure functions so the decision can be unit-tested
 * without React state, and so both `handleChannelActions` and the
 * packing-session dispatcher share the same rule.
 *
 * An "active" stxInboundBuy means the scanned AWB backs a live StxPurchaseUnit
 * whose parent Galaxus order is not cancelled. Physical parcel is inbound to us.
 *
 * - Shopify auto-fulfill: always suppressed (stale OrderMatch sharing the AWB).
 * - Galaxus direct Swiss Post label: ALLOWED — that's the re-label flow when the
 *   StockX parcel arrives and we ship to the Galaxus customer.
 * - Packing session: ADD when warehouse inbound; skip for direct-delivery inbound.
 */

export type StxInboundBuyLike = {
  orderCancelledAt?: string | null;
  isWarehouse?: boolean;
  isDirectDelivery?: boolean;
} | null | undefined;

export type ScanLike = {
  stxInboundBuy?: StxInboundBuyLike;
  galaxus?: {
    isDirectDelivery?: boolean;
    allLinked?: boolean | null;
    source?: string | null;
  } | null;
} | null | undefined;

export function isActiveStxInboundBuy(scan: ScanLike): boolean {
  const inbound = scan?.stxInboundBuy;
  if (!inbound) return false;
  return !inbound.orderCancelledAt;
}

/** True when scan should auto-print the Galaxus direct-delivery Swiss Post label. */
export function shouldAutoGalaxusDirectLabelFor(scan: ScanLike): boolean {
  // Inbound StockX → direct Galaxus uses pack+label+DELR auto (single line) or manual table (multi).
  if (isActiveStxInboundBuy(scan) && scan?.stxInboundBuy?.isDirectDelivery) {
    return false;
  }
  const g = scan?.galaxus;
  if (!g?.isDirectDelivery) return false;
  if (g.allLinked === false) return false;
  return true;
}

export type DirectLineLike = {
  quantity?: number | null;
  remaining?: number | null;
};

export function countOpenDirectLines(lines: DirectLineLike[] | undefined | null): number {
  return (lines ?? []).filter((line) => directLineRemaining(line) > 0).length;
}

export function directLineRemaining(line: DirectLineLike): number {
  return Math.max(0, Number(line?.remaining ?? line?.quantity ?? 0));
}

/** Inbound StockX AWB for a direct Galaxus order — eligible for one-click fulfill when one line left. */
export function shouldAutoStxInboundDirectFulfill(scan: ScanLike): boolean {
  if (!isActiveStxInboundBuy(scan)) return false;
  return Boolean(scan?.stxInboundBuy?.isDirectDelivery);
}

/**
 * True when scan should auto-add the AWB to the warehouse packing session.
 * Warehouse inbound StockX buys MUST be added. Direct-delivery inbounds must not.
 */
export function shouldAutoAddToPackingSession(scan: ScanLike): boolean {
  const inbound = scan?.stxInboundBuy;
  if (!inbound || inbound.orderCancelledAt) return true;
  // Active inbound buy for a warehouse Galaxus order → add to the box.
  if (inbound.isWarehouse === true) return true;
  if (inbound.isDirectDelivery === true) return false;
  // Unknown delivery type on an active inbound — be conservative.
  return false;
}
