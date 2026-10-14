/**
 * Meta Conversions API event — DISABLED adapter (gate G6). No pixel, no send in Phase 1.
 * Marketing consent required; same event_id as the future browser pixel for dedup.
 */
import { assertDestinationOpen } from "../guards";
import { eventIdFor, type ShadowPurchase } from "../contract";
import { hashedEmail, hashedPhone, sha256Hex } from "../hash";

export type MetaCapiEvent = {
  event_name: "Purchase";
  event_time: number;
  event_id: string;
  action_source: "website";
  event_source_url?: string;
  user_data: Record<string, unknown>;
  custom_data: Record<string, unknown>;
};

export function metaFbc(fbclid: string | undefined, at: Date): string | undefined {
  return fbclid ? `fb.1.${at.getTime()}.${fbclid}` : undefined;
}

export function buildMetaPurchase(p: ShadowPurchase): MetaCapiEvent | null {
  if (p.consent.marketing !== true) return null;
  const em = hashedEmail(p.email);
  const ph = hashedPhone(p.phone, p.country ?? "CH", "digits");
  return {
    event_name: "Purchase",
    event_time: Math.floor(p.occurredAt.getTime() / 1000),
    event_id: eventIdFor("purchase", p.orderId),
    action_source: "website",
    event_source_url: p.pageUrl ?? undefined,
    user_data: {
      em: em ? [em] : undefined,
      ph: ph ? [ph] : undefined,
      country: p.country ? [sha256Hex(p.country.toLowerCase())] : undefined,
      external_id: p.clientId ? [sha256Hex(p.clientId)] : undefined,
      fbc: metaFbc(p.clickIds.fbclid, p.occurredAt),
      client_ip_address: p.ip ?? undefined,
      client_user_agent: p.userAgent ?? undefined,
    },
    custom_data: {
      currency: p.currency,
      value: p.revenue,
      order_id: p.orderId,
      content_type: "product",
      content_ids: p.items.map((i) => i.itemId),
      contents: p.items.map((i) => ({ id: i.itemId, quantity: i.quantity, item_price: i.price })),
      num_items: p.items.reduce((n, i) => n + i.quantity, 0),
    },
  };
}

export async function sendMeta(): Promise<never> {
  assertDestinationOpen("meta");
  throw new Error("Meta CAPI transport not implemented before gate G6");
}
