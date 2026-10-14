/**
 * GA4 TEST property — Measurement Protocol payload (DISABLED adapter, gate G3).
 * Builds the body only; there is no transport in Phase 1. Production stream refused.
 */
import { assertDestinationOpen, isProductionId } from "../guards";
import type { ShadowPurchase } from "../contract";

export type Ga4MpBody = {
  client_id: string;
  timestamp_micros: number;
  non_personalized_ads: true;
  events: Array<{ name: string; params: Record<string, unknown> }>;
};

export function buildGa4TestPurchase(p: ShadowPurchase, measurementId: string): Ga4MpBody | null {
  if (isProductionId(measurementId)) throw new Error("GA4 shadow route refuses the production stream");
  if (p.consent.analytics !== true || !p.clientId) return null;
  return {
    client_id: p.clientId,
    timestamp_micros: p.occurredAt.getTime() * 1000,
    non_personalized_ads: true,
    events: [
      {
        name: "purchase",
        params: {
          transaction_id: p.orderId,
          currency: p.currency,
          value: p.revenue,
          tax: p.tax ?? undefined,
          shipping: p.shipping ?? undefined,
          session_id: p.sessionId ?? undefined,
          rl_source: "shadow_server",
          items: p.items.map((i) => ({
            item_id: i.itemId,
            item_name: i.name ?? undefined,
            item_brand: i.brand ?? undefined,
            item_variant: i.variant ?? undefined,
            price: i.price,
            quantity: i.quantity,
            lane: i.lane ?? undefined,
          })),
        },
      },
    ],
  };
}

export async function sendGa4Test(): Promise<never> {
  assertDestinationOpen("ga4_test");
  throw new Error("GA4 test transport not implemented before gate G3");
}
