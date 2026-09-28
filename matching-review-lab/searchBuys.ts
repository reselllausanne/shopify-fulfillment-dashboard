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
  const buyOrderRaw = String(query.buyOrderId ?? query.buyOrderNumber ?? "")
    .trim()
    .replace(/^#\s*/, "")
    .replace(/\s+/g, "");
  const buyOrderId = buyOrderRaw;
  const buyOrderNumber = buyOrderRaw;
  const gtin = normalizeGtin(query.gtin);
  const sku = normalizeSkuKey(query.sku);
  const name = String(query.name ?? "").trim();
  const size = normalizeSizeLabel(query.size);

  const hasAny = awb || buyOrderId || gtin || sku || name || size;
  if (!hasAny) return [];

  const hits: LabStockxBuy[] = [];
  for (const buy of buys) {
    if (awb) {
      const buyAwb = String(buy.awb ?? "").trim();
      if (!buyAwb || buyAwb.toLowerCase() !== awb.toLowerCase()) continue;
    }
    if (buyOrderId) {
      const id = String(buy.orderId ?? "").trim().replace(/^#\s*/, "");
      const num = String(buy.supplierOrderNumber ?? "").trim().replace(/^#\s*/, "");
      const idNorm = id.replace(/\s+/g, "");
      const numNorm = num.replace(/\s+/g, "");
      // Exact or suffix match (paste with/without #, partial order number).
      const idOk =
        idNorm === buyOrderId ||
        numNorm === buyOrderId ||
        (buyOrderId.length >= 6 &&
          (idNorm.endsWith(buyOrderId) || numNorm.endsWith(buyOrderId)));
      if (!idOk) continue;
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
