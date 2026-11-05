export type DirectDeliveryListTab = "to_process" | "fulfilled";

/**
 * À traiter = not fulfilled (open, plus "shipped" when open-line coverage fails).
 * Fulfilled = every line shipped.
 * Search hits use the same split — the active tab is the filter.
 */
export function orderMatchesDirectDeliveryTab(
  order: { fulfillmentState?: string | null },
  tab: DirectDeliveryListTab,
): boolean {
  const state = order.fulfillmentState ?? "to_process";
  if (tab === "fulfilled") return state === "fulfilled";
  return state === "to_process" || state === "shipped";
}
