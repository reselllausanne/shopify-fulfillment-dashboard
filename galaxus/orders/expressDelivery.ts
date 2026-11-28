/** Arrival within this many calendar days of the order date is the 48h promise. Slow route is ~3 weeks. */
export const GALAXUS_EXPRESS_MAX_CALENDAR_DAYS = 5;

function utcDay(value: Date): number {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

/**
 * True when Galaxus asked for this line inside the express window and that
 * date is still today or later. Older short lead times (electronics, etc.)
 * are not open express ships.
 */
export function isGalaxusExpressArrival(
  orderDate: Date | string | null | undefined,
  arrivalEnd: Date | string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!orderDate || !arrivalEnd) return false;
  const order = new Date(orderDate);
  const end = new Date(arrivalEnd);
  if (Number.isNaN(order.getTime()) || Number.isNaN(end.getTime()) || Number.isNaN(now.getTime())) {
    return false;
  }
  const days = Math.round((utcDay(end) - utcDay(order)) / 86_400_000);
  if (days < 0 || days > GALAXUS_EXPRESS_MAX_CALENDAR_DAYS) return false;
  return utcDay(end) >= utcDay(now);
}
