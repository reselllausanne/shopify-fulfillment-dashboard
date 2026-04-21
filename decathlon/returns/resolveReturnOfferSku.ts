/** Mirakl return lines often carry shop/product ids; THE_/STX_ lives on `DecathlonOrderLine.offerSku`. */
export function resolveDecathlonReturnOfferSku(row: {
  offerSku?: string | null;
  productId?: string | null;
  orderLine?: { offerSku?: string | null } | null;
}): string | null {
  const lineSku = row.orderLine?.offerSku?.trim() ?? null;
  const rowSku = row.offerSku?.trim() ?? null;
  const productId = row.productId?.trim() ?? null;
  const isTheStx = (s: string | null) => {
    if (!s) return false;
    const l = s.toLowerCase();
    return l.startsWith("the_") || l.startsWith("stx_");
  };
  if (isTheStx(lineSku)) return lineSku;
  if (isTheStx(rowSku)) return rowSku;
  if (isTheStx(productId)) return productId;
  return lineSku ?? rowSku ?? productId ?? null;
}
