/** Decathlon / Galaxus StockX match row considered linked when any StockX identifier is present. */
export const isStockxMatchLinked = (match: {
  stockxOrderNumber?: string | null;
  stockxOrderId?: string | null;
  stockxChainId?: string | null;
}) => {
  if (!match) return false;
  const onum = String(match.stockxOrderNumber ?? "").trim();
  const oid = String(match.stockxOrderId ?? "").trim();
  const chain = String(match.stockxChainId ?? "").trim();
  return onum.length > 0 || oid.length > 0 || chain.length > 0;
};
