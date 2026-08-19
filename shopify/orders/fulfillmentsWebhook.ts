import { prisma } from "@/app/lib/prisma";
import { notifyCustomerShippedViaLaPoste } from "@/app/lib/notifications/shopifyShippedEmail";
import {
  resolveSwissPostCustomerTracking,
  shopifyOrderIdAliases,
} from "@/app/lib/swissPostCustomerTracking";

export type ShopifyFulfillmentWebhookPayload = {
  id?: number | string;
  order_id?: number | string;
  name?: string | null;
  status?: string | null;
  tracking_company?: string | null;
  tracking_number?: string | null;
  tracking_numbers?: string[] | null;
  tracking_url?: string | null;
  tracking_urls?: string[] | null;
};

function firstString(values: Array<string | null | undefined>): string {
  for (const value of values) {
    const trimmed = String(value ?? "").trim();
    if (trimmed) return trimmed;
  }
  return "";
}

export async function processFulfillmentWebhook(
  payload: ShopifyFulfillmentWebhookPayload
): Promise<{ ok: boolean; shopifyOrderId: string | null; trackingNumber: string | null; email?: unknown }> {
  const orderId = payload.order_id;
  if (orderId == null || String(orderId).trim() === "") {
    return { ok: false, shopifyOrderId: null, trackingNumber: null };
  }

  const trackingNumber = firstString([
    payload.tracking_number,
    ...(Array.isArray(payload.tracking_numbers) ? payload.tracking_numbers : []),
  ]);
  const trackingUrl = firstString([
    payload.tracking_url,
    ...(Array.isArray(payload.tracking_urls) ? payload.tracking_urls : []),
  ]);
  const trackingCompany = String(payload.tracking_company ?? "").trim() || null;
  const tracking = resolveSwissPostCustomerTracking({
    trackingNumber,
    trackingUrl,
    trackingCompany,
  });
  if (!tracking) {
    return { ok: true, shopifyOrderId: String(orderId), trackingNumber: trackingNumber || null };
  }

  const aliases = shopifyOrderIdAliases(orderId);
  const gid = aliases.find((id) => id.startsWith("gid://")) || aliases[0];
  const match = await prisma.orderMatch.findFirst({
    where: { shopifyOrderId: { in: aliases } },
    select: { shopifyOrderId: true, shopifyOrderName: true },
  });
  const shopifyOrderId = match?.shopifyOrderId || gid;
  const shopifyOrderName = match?.shopifyOrderName || payload.name || null;

  await prisma.shopifyFulfillmentRecord.upsert({
    where: {
      shopifyOrderId_trackingNumber: {
        shopifyOrderId,
        trackingNumber: tracking.trackingNumber,
      },
    },
    create: {
      shopifyOrderId,
      shopifyOrderName,
      trackingNumber: tracking.trackingNumber,
      trackingUrl: tracking.trackingUrl,
      trackingCompany: trackingCompany || "Swiss Post",
      status: payload.status || "success",
    },
    update: {
      shopifyOrderName,
      trackingUrl: tracking.trackingUrl,
      trackingCompany: trackingCompany || "Swiss Post",
      status: payload.status || "success",
    },
  });

  const email = await notifyCustomerShippedViaLaPoste({
    shopifyOrderId,
    shopifyOrderName,
    trackingNumber: tracking.trackingNumber,
    trackingUrl: tracking.trackingUrl,
    trackingCompany: trackingCompany || "Swiss Post",
  });

  return {
    ok: true,
    shopifyOrderId,
    trackingNumber: tracking.trackingNumber,
    email,
  };
}
