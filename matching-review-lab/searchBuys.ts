import { normalizeGtin, normalizeSkuKey, normalizeSizeLabel } from "./normalize";
import type { LabStockxBuy } from "./types";

export type BuySearchQuery = {
  awb?: string | null;
  buyOrderId?: string | null;
  buyOrderNumber?: string | null;
  gtin?: string | null;
  sku?: string | null;
  name?: string | null;
  size?: string | null;
  limit?: number;
};

function includesCI(hay: string | null | undefined, needle: string): boolean {
  if (!hay) return false;
  return hay.toLowerCase().includes(needle.toLowerCase());
}

/** Manual StockX buy search for review corrections (local snapshot only). */
export function searchStockxBuys(
  buys: LabStockxBuy[],
  query: BuySearchQuery
): LabStockxBuy[] {
  const limit = Math.max(1, Math.min(50, query.limit ?? 20));
  const awb = String(query.awb ?? "").trim();
  const buyOrderId = String(query.buyOrderId ?? "").trim();
  const buyOrderNumber = String(query.buyOrderNumber ?? query.buyOrderId ?? "").trim();
  const gtin = normalizeGtin(query.gtin);
  const sku = normalizeSkuKey(query.sku);
  const name = String(query.name ?? "").trim();
  const size = normalizeSizeLabel(query.size);

  const hasAny = awb || buyOrderId || buyOrderNumber || gtin || sku || name || size;
  if (!hasAny) return [];

  const hits: LabStockxBuy[] = [];
  for (const buy of buys) {
    if (awb) {
      const buyAwb = String(buy.awb ?? "").trim();
      if (!buyAwb || buyAwb.toLowerCase() !== awb.toLowerCase()) continue;
    }
    if (buyOrderId) {
      const id = String(buy.orderId ?? "").trim();
      const num = String(buy.supplierOrderNumber ?? "").trim();
      if (id !== buyOrderId && num !== buyOrderId) continue;
    }
    if (buyOrderNumber && !buyOrderId) {
      const num = String(buy.supplierOrderNumber ?? "").trim();
      if (num !== buyOrderNumber) continue;
    }
    if (gtin) {
      const buyGtin = normalizeGtin(buy.gtin);
      if (!buyGtin || buyGtin !== gtin) continue;
    }
    if (sku) {
      const buySku = normalizeSkuKey(buy.skuKey);
      if (!buySku || !buySku.includes(sku)) continue;
    }
    if (name && !includesCI(buy.productTitle, name) && !includesCI(buy.productName, name)) {
      continue;
    }
    if (size) {
      const buySize = normalizeSizeLabel(buy.sizeEU);
      if (!buySize || buySize !== size) continue;
    }
    hits.push(buy);
    if (hits.length >= limit) break;
  }
  return hits;
}
