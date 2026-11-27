/**
 * A linked StockX buy blocks a second purchase while it is still active.
 * CANCELLED / REFUNDED releases that line back to the buy queue.
 * No I/O: the night buyer and checkout call these before they touch a line.
 */

export function isTerminalStockxBuyStatus(status: string | null | undefined): boolean {
  const st = String(status ?? "").toUpperCase();
  return st.includes("CANCEL") || st.includes("REFUND");
}

/** True while this link is a live StockX order. Blank status counts as live (do not double-buy). */
export function linkedBuyBlocksNewPurchase(
  link: { stockxOrderNumber?: string | null; stockxStatus?: string | null } | null | undefined
): boolean {
  const num = String(link?.stockxOrderNumber ?? "").trim();
  if (!num) return false;
  return !isTerminalStockxBuyStatus(link?.stockxStatus);
}

/**
 * Night/ledger "bought" stays until the same StockX number is terminal.
 * A different order number is not proof the stored buy was refunded.
 */
export function boughtStateReleasedByRefund(
  state: { status?: string | null; stockxOrderNumber?: string | null } | null | undefined,
  link: { stockxOrderNumber?: string | null; stockxStatus?: string | null } | null | undefined
): boolean {
  if (!state || state.status !== "bought") return false;
  const linkNum = String(link?.stockxOrderNumber ?? "").trim();
  if (!linkNum || !isTerminalStockxBuyStatus(link?.stockxStatus)) return false;
  const stateNum = String(state.stockxOrderNumber ?? "").trim();
  if (!stateNum) return true;
  return stateNum === linkNum;
}

export function keysReleasedByRefund(
  state: Record<string, { status?: string | null; stockxOrderNumber?: string | null }>,
  links: Array<{ key: string; stockxOrderNumber?: string | null; stockxStatus?: string | null }>
): string[] {
  const byKey = new Map(links.map((l) => [l.key, l]));
  const out: string[] = [];
  for (const [key, row] of Object.entries(state)) {
    if (boughtStateReleasedByRefund(row, byKey.get(key) ?? null)) out.push(key);
  }
  return out;
}
