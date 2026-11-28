import { GALAXUS_DELIVERY_ROUTE_48H } from "@/galaxus/warehouse/delivery48h";

/** Orders placed while the 48h route was live, promised by this date. Not a moving rule. */
export const GALAXUS_48H_LEGACY_ORDER_FROM = "2026-11-20";
export const GALAXUS_48H_LEGACY_ARRIVAL_UNTIL = "2026-12-06";
const LEGACY_MAX_DAYS = 5;

function utcDay(value: Date): number {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

/** True only for the short arrivals already promised before the route was turned off. */
export function isLegacy48hPromise(
  orderDate: Date | string | null | undefined,
  arrivalEnd: Date | string | null | undefined
): boolean {
  if (!orderDate || !arrivalEnd) return false;
  const order = new Date(orderDate);
  const end = new Date(arrivalEnd);
  if (Number.isNaN(order.getTime()) || Number.isNaN(end.getTime())) return false;
  const from = new Date(`${GALAXUS_48H_LEGACY_ORDER_FROM}T00:00:00.000Z`);
  const until = new Date(`${GALAXUS_48H_LEGACY_ARRIVAL_UNTIL}T00:00:00.000Z`);
  if (utcDay(order) < utcDay(from) || utcDay(end) > utcDay(until)) return false;
  const days = Math.round((utcDay(end) - utcDay(order)) / 86_400_000);
  return days >= 0 && days <= LEGACY_MAX_DAYS;
}

/** Ongoing rule: the offer was on the 48h route when the order arrived. */
export function isExpressDeliveryRoute(routeId: string | null | undefined): boolean {
  return String(routeId ?? "").trim() === GALAXUS_DELIVERY_ROUTE_48H;
}
