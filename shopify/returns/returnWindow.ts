/** Public customer portal: returns allowed within N days of delivery. */
export const PUBLIC_RETURN_WINDOW_DAYS = 14;

/** When Shopify has no deliveredAt, estimate delivery = fulfilled + N business days. */
export const PUBLIC_RETURN_FULFILL_TO_DELIVERY_BUSINESS_DAYS = 3;

export type FulfillmentDeliveryHint = {
  deliveredAt?: string | null;
  createdAt?: string | null;
  fulfillmentLineItemIds?: string[];
};

function parseDate(raw: string | null | undefined): Date | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** Add N Mon–Fri business days (skips Sat/Sun). */
export function addBusinessDays(start: Date, businessDays: number): Date {
  const result = new Date(start.getTime());
  let remaining = Math.max(0, Math.floor(businessDays));
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    const day = result.getUTCDay(); // 0=Sun … 6=Sat
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return result;
}

/**
 * Anchor for the 14-day window:
 * - Shopify `deliveredAt` when present
 * - else fulfilledAt (`createdAt`) + 3 business days (we rarely get deliveredAt)
 */
export function resolveFulfillmentDeliveryAnchor(fulfillment: {
  deliveredAt?: string | null;
  createdAt?: string | null;
}): Date | null {
  const delivered = parseDate(fulfillment.deliveredAt);
  if (delivered) return delivered;

  const fulfilled = parseDate(fulfillment.createdAt);
  if (!fulfilled) return null;
  return addBusinessDays(fulfilled, PUBLIC_RETURN_FULFILL_TO_DELIVERY_BUSINESS_DAYS);
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
 * Lines with no delivery signal stay (not fulfilled yet / unknown).
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
