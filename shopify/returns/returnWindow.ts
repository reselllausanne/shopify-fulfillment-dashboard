/** Public customer portal: returns allowed within N days of delivery. */
export const PUBLIC_RETURN_WINDOW_DAYS = 14;

export type FulfillmentDeliveryHint = {
  deliveredAt?: string | null;
  createdAt?: string | null;
  fulfillmentLineItemIds?: string[];
};

/**
 * Anchor date for the 14-day window: Shopify `deliveredAt` when present,
 * else fulfillment `createdAt` (shipped / handed off — best available signal).
 */
export function resolveFulfillmentDeliveryAnchor(fulfillment: {
  deliveredAt?: string | null;
  createdAt?: string | null;
}): Date | null {
  const raw = String(fulfillment.deliveredAt ?? "").trim() || String(fulfillment.createdAt ?? "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function isOutsideReturnWindow(
  anchor: Date | null,
  now: Date = new Date(),
  windowDays: number = PUBLIC_RETURN_WINDOW_DAYS
): boolean {
  if (!anchor) return false;
  const ms = windowDays * 24 * 60 * 60 * 1000;
  return now.getTime() - anchor.getTime() > ms;
}

/** Map fulfillmentLineItemId → delivery anchor for window checks. */
export function buildFulfillmentLineDeliveryMap(
  fulfillments: FulfillmentDeliveryHint[]
): Map<string, Date> {
  const map = new Map<string, Date>();
  for (const fulfillment of fulfillments) {
    const anchor = resolveFulfillmentDeliveryAnchor(fulfillment);
    if (!anchor) continue;
    for (const id of fulfillment.fulfillmentLineItemIds ?? []) {
      if (!id) continue;
      const existing = map.get(id);
      // Keep earliest delivery if the same line appears twice.
      if (!existing || anchor.getTime() < existing.getTime()) {
        map.set(id, anchor);
      }
    }
  }
  return map;
}

/**
 * Drop lines whose fulfillment was delivered more than the window ago.
 * Lines with no delivery signal stay (not delivered yet / unknown).
 */
export function filterReturnableLinesByWindow<T extends { fulfillmentLineItemId: string }>(
  lines: T[],
  deliveryByLineId: Map<string, Date>,
  now: Date = new Date(),
  windowDays: number = PUBLIC_RETURN_WINDOW_DAYS
): { allowed: T[]; expired: T[] } {
  const allowed: T[] = [];
  const expired: T[] = [];
  for (const line of lines) {
    const anchor = deliveryByLineId.get(line.fulfillmentLineItemId) ?? null;
    if (isOutsideReturnWindow(anchor, now, windowDays)) {
      expired.push(line);
    } else {
      allowed.push(line);
    }
  }
  return { allowed, expired };
}
