import { sameGtinKey } from "@/galaxus/orders/gtinKey";
import { expandGtinsForDbLookup, normalizeGtinKey } from "@/galaxus/stx/purchaseUnits";
import { loadPhysicalMirrorStockByGtin } from "@/shopify/inventory/physicalAvailability";
import type { OrderLinePhysicalStock } from "@/shopify/inventory/orderLinePhysicalStock.types";

export type { OrderLinePhysicalStock } from "@/shopify/inventory/orderLinePhysicalStock.types";

export async function buildPhysicalStockByGtinMap(
  rawGtins: Iterable<string | null | undefined>
): Promise<Map<string, OrderLinePhysicalStock>> {
  const cleaned = Array.from(rawGtins)
    .map((g) => String(g ?? "").trim())
    .filter((g) => g.length > 0);
  const expand = expandGtinsForDbLookup(cleaned);
  if (expand.length === 0) return new Map();

  const mirror = await loadPhysicalMirrorStockByGtin(expand);
  const out = new Map<string, OrderLinePhysicalStock>();
  for (const [gtin, row] of mirror) {
    if (row.qty <= 0) continue;
    const entry: OrderLinePhysicalStock = {
      qty: row.qty,
      locationName: row.preferredLocationName ?? "Physical stock",
      locationId: row.preferredLocationId,
    };
    out.set(gtin, entry);
    const norm = normalizeGtinKey(gtin);
    if (norm && !out.has(norm)) out.set(norm, entry);
  }
  return out;
}

export function resolvePhysicalStockForGtin(
  gtin: string | null | undefined,
  map: Map<string, OrderLinePhysicalStock>
): OrderLinePhysicalStock | null {
  const raw = String(gtin ?? "").trim();
  if (!raw || map.size === 0) return null;
  for (const [key, val] of map) {
    if (sameGtinKey(raw, key)) return val;
  }
  return map.get(normalizeGtinKey(raw)) ?? null;
}

export function attachPhysicalStockToLines<T extends { gtin?: string | null }>(
  lines: T[],
  map: Map<string, OrderLinePhysicalStock>
): Array<T & { physicalStock: OrderLinePhysicalStock | null }> {
  return lines.map((line) => ({
    ...line,
    physicalStock: resolvePhysicalStockForGtin(line.gtin, map),
  }));
}
