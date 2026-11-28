/** Arrival within this many calendar days of the order date is the 48h promise. Slow route is ~3 weeks. */
export const GALAXUS_EXPRESS_MAX_CALENDAR_DAYS = 7;

function utcDay(value: Date): number {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

/** True when Galaxus asked for this line inside the express window. */
export function isGalaxusExpressArrival(
  orderDate: Date | string | null | undefined,
  arrivalEnd: Date | string | null | undefined
): boolean {
  if (!orderDate || !arrivalEnd) return false;
  const order = new Date(orderDate);
  const end = new Date(arrivalEnd);
  if (Number.isNaN(order.getTime()) || Number.isNaN(end.getTime())) return false;
  const days = Math.round((utcDay(end) - utcDay(order)) / 86_400_000);
  return days >= 0 && days <= GALAXUS_EXPRESS_MAX_CALENDAR_DAYS;
}
