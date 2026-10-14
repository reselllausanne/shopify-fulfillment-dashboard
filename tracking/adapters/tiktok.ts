/**
 * TikTok Events API 2.0 event — DISABLED adapter (gate G6). No pixel, no send in Phase 1.
 * Marketing consent required; same event_id as the future browser pixel for dedup.
 */
import { assertDestinationOpen } from "../guards";
import { eventIdFor, type ShadowPurchase } from "../contract";
import { hashedEmail, hashedPhone, sha256Hex } from "../hash";

export type TikTokEvent = {
  event: "CompletePayment";
  event_time: number;
  event_id: string;
  user: Record<string, unknown>;
  properties: Record<string, unknown>;
  page?: { url: string };
};

export function buildTikTokPurchase(p: ShadowPurchase): TikTokEvent | null {
  if (p.consent.marketing !== true) return null;
  const email = hashedEmail(p.email);
  const phone = hashedPhone(p.phone, p.country ?? "CH", "e164");
  return {
    event: "CompletePayment",
    event_time: Math.floor(p.occurredAt.getTime() / 1000),
    event_id: eventIdFor("purchase", p.orderId),
    user: {
      email: email ?? undefined,
      phone: phone ?? undefined,
      external_id: p.clientId ? sha256Hex(p.clientId) : undefined,
      ttclid: p.clickIds.ttclid ?? undefined,
      ip: p.ip ?? undefined,
      user_agent: p.userAgent ?? undefined,
    },
    properties: {
      currency: p.currency,
      value: p.revenue,
      order_id: p.orderId,
      content_type: "product",
      contents: p.items.map((i) => ({
        content_id: i.itemId,
        content_name: i.name ?? undefined,
        quantity: i.quantity,
        price: i.price,
      })),
    },
    page: p.pageUrl ? { url: p.pageUrl } : undefined,
  };
}

export async function sendTikTok(): Promise<never> {
  assertDestinationOpen("tiktok");
  throw new Error("TikTok Events API transport not implemented before gate G6");
}
