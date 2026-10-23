/**
 * Server-side checkout_completed backup when the Shopify custom pixel misses
 * the thank-you page (Shop Pay, TWINT redirects, tab close, consent gaps).
 * Idempotent on event_id + skips if a pixel completion already exists for order_id.
 */
import { prisma } from "@/app/lib/prisma";

export const SERVER_PURCHASE_PIXEL_VERSION = "server.orders_paid";

export type OrdersPaidLike = {
  id?: number | string;
  admin_graphql_api_id?: string;
  created_at?: string;
  processed_at?: string;
  total_price?: string | number;
  current_total_price?: string | number;
  currency?: string;
  payment_gateway_names?: string[];
  landing_site?: string | null;
  referring_site?: string | null;
  note_attributes?: Array<{ name?: string; value?: string | null }>;
};

function numericOrderId(payload: OrdersPaidLike): string | null {
  const gid = String(payload.admin_graphql_api_id ?? "").trim();
  if (gid) {
    const n = gid.slice(gid.lastIndexOf("/") + 1);
    if (/^\d+$/.test(n)) return n;
  }
  const id = String(payload.id ?? "").trim();
  return /^\d+$/.test(id) ? id : null;
}

function money(v: string | number | undefined): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function abFromNotes(attrs: OrdersPaidLike["note_attributes"]): string | null {
  if (!Array.isArray(attrs)) return null;
  const hit = attrs.find((a) => String(a?.name ?? "") === "_ab");
  const v = String(hit?.value ?? "").trim();
  return v || null;
}

/**
 * Insert checkout_completed from orders/paid if the pixel never recorded it.
 * Returns inserted=false when already covered or order id missing.
 */
export async function ensureServerCheckoutCompleted(
  payload: OrdersPaidLike,
): Promise<{ inserted: boolean; orderId: string | null; reason?: string }> {
  const orderId = numericOrderId(payload);
  if (!orderId) return { inserted: false, orderId: null, reason: "no_order_id" };

  const existing = await prisma.funnelEvent.findFirst({
    where: { eventName: "checkout_completed", orderId },
    select: { id: true },
  });
  if (existing) return { inserted: false, orderId, reason: "already_tracked" };

  const eventId = `server_orders_paid_${orderId}`;
  const occurredAt = new Date(payload.processed_at || payload.created_at || Date.now());
  const value = money(payload.current_total_price) ?? money(payload.total_price);
  const gateway = Array.isArray(payload.payment_gateway_names)
    ? payload.payment_gateway_names.filter(Boolean).join(",") || null
    : null;
  const abVariant = abFromNotes(payload.note_attributes);

  try {
    await prisma.funnelEvent.create({
      data: {
        eventId,
        eventName: "checkout_completed",
        occurredAt: Number.isFinite(occurredAt.getTime()) ? occurredAt : new Date(),
        orderId,
        value,
        currency: payload.currency ? String(payload.currency).slice(0, 8) : null,
        paymentGateway: gateway,
        abVariant,
        pixelVersion: SERVER_PURCHASE_PIXEL_VERSION,
        pagePath: "/checkouts/thank-you",
        props: {
          orderId,
          source: "orders_paid_webhook",
          landingSite: payload.landing_site ?? null,
          referringSite: payload.referring_site ?? null,
        },
      },
    });
    return { inserted: true, orderId };
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "P2002") return { inserted: false, orderId, reason: "duplicate_event_id" };
    throw err;
  }
}
