import { prisma } from "@/app/lib/prisma";
import { getMailer } from "@/app/lib/mailer";
import { CUSTOMER_SHIPPED_LA_POSTE_KEY } from "@/app/lib/stockxStatus";
import {
  resolveSwissPostCustomerTracking,
  shopifyOrderIdAliases,
} from "@/app/lib/swissPostCustomerTracking";
import type { StockXState } from "@/app/lib/stockxTracking";

type NotifyInput = {
  shopifyOrderId: string;
  shopifyOrderName?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  trackingCompany?: string | null;
  matchIds?: string[];
};

type NotifyResult = {
  ok: boolean;
  sent: number;
  skipped: number;
  reason?: string;
  errors: string[];
};

const toNumberMaybe = (v: unknown): number | null => {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

function shippedStates(): StockXState[] {
  return Array.from({ length: 4 }).map((_, i) => ({
    title: `Step ${i + 1}`,
    status: "SUCCESS",
    progress: "COMPLETED",
    subtitle: "done",
    sourceType: "CUSTODIAL_OUTBOUND",
    meta: "",
  }));
}

export async function notifyCustomerShippedViaLaPoste(input: NotifyInput): Promise<NotifyResult> {
  const tracking = resolveSwissPostCustomerTracking({
    trackingNumber: input.trackingNumber,
    trackingUrl: input.trackingUrl,
    trackingCompany: input.trackingCompany,
  });
  if (!tracking) {
    return { ok: true, sent: 0, skipped: 1, reason: "not_swiss_post_tracking", errors: [] };
  }

  const orderIds = shopifyOrderIdAliases(input.shopifyOrderId);
  const matches = await prisma.orderMatch.findMany({
    where: input.matchIds?.length
      ? { id: { in: input.matchIds } }
      : { shopifyOrderId: { in: orderIds } },
    select: {
      id: true,
      shopifyOrderName: true,
      shopifyProductTitle: true,
      shopifySku: true,
      shopifySizeEU: true,
      shopifyTotalPrice: true,
      shopifyCustomerEmail: true,
      shopifyCustomerFirstName: true,
      shopifyCustomerLastName: true,
      shopifyLineItemImageUrl: true,
      customerTrackingToken: true,
      stockxCheckoutType: true,
      stockxOrderNumber: true,
      stockxSkuKey: true,
      stockxSizeEU: true,
      stockxEstimatedDelivery: true,
      stockxLatestEstimatedDelivery: true,
    },
  });

  if (matches.length === 0) {
    return { ok: true, sent: 0, skipped: 1, reason: "no_order_match", errors: [] };
  }

  const mailer = getMailer();
  const overrideTo = (process.env.POSTMARK_OVERRIDE_TO || "").trim();
  const states = shippedStates();
  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const match of matches) {
    const event = await prisma.stockXStatusEvent.upsert({
      where: {
        orderMatchId_milestoneKey: {
          orderMatchId: match.id,
          milestoneKey: CUSTOMER_SHIPPED_LA_POSTE_KEY,
        },
      },
      create: {
        orderMatchId: match.id,
        milestoneKey: CUSTOMER_SHIPPED_LA_POSTE_KEY,
        milestoneTitle: "Expédiée via La Poste",
        statesHash: tracking.trackingNumber,
      },
      update: {
        milestoneTitle: "Expédiée via La Poste",
        statesHash: tracking.trackingNumber,
      },
      select: { id: true, emailedAt: true },
    });

    if (event.emailedAt) {
      skipped += 1;
      continue;
    }

    const to = overrideTo || (match.shopifyCustomerEmail || "").trim();
    if (!to) {
      skipped += 1;
      continue;
    }

    const sendRes = await mailer.sendStockXMilestoneEmail({
      to,
      stockxStates: states,
      match: {
        id: match.id,
        customerTrackingToken: match.customerTrackingToken ?? null,
        shopifyOrderName: match.shopifyOrderName || input.shopifyOrderName || "",
        shopifyProductTitle: match.shopifyProductTitle,
        shopifySku: match.shopifySku ?? null,
        shopifySizeEU: match.shopifySizeEU ?? null,
        shopifyTotalPriceChf: toNumberMaybe(match.shopifyTotalPrice),
        shopifyLineItemImageUrl: match.shopifyLineItemImageUrl ?? null,
        shopifyCustomerFirstName: match.shopifyCustomerFirstName ?? null,
        shopifyCustomerLastName: match.shopifyCustomerLastName ?? null,
        stockxCheckoutType: match.stockxCheckoutType ?? null,
        stockxOrderNumber: match.stockxOrderNumber ?? null,
        stockxSkuKey: match.stockxSkuKey ?? null,
        stockxSizeEU: match.stockxSizeEU ?? null,
        stockxTrackingUrl: null,
        stockxAwb: null,
        swissPostTrackingUrl: tracking.trackingUrl,
        swissPostTrackingNumber: tracking.trackingNumber,
        stockxEstimatedDelivery: match.stockxEstimatedDelivery ?? null,
        stockxLatestEstimatedDelivery: match.stockxLatestEstimatedDelivery ?? null,
      },
      milestone: {
        key: CUSTOMER_SHIPPED_LA_POSTE_KEY,
        title: "Expédiée via La Poste",
        description: "Expédiée via La Poste",
      },
    });

    if (sendRes.ok) {
      await prisma.stockXStatusEvent.update({
        where: { id: event.id },
        data: {
          emailedAt: new Date(),
          emailTo: sendRes.to,
          emailProvider: sendRes.provider,
          emailProviderId: sendRes.providerMessageId || null,
          emailError: null,
        },
      });
      await prisma.orderMatch.update({
        where: { id: match.id },
        data: {
          lastMilestoneKey: CUSTOMER_SHIPPED_LA_POSTE_KEY,
          lastMilestoneAt: new Date(),
        },
      });
      sent += 1;
      continue;
    }

    await prisma.stockXStatusEvent.update({
      where: { id: event.id },
      data: {
        emailTo: sendRes.to,
        emailProvider: sendRes.provider,
        emailError: sendRes.error.slice(0, 1000),
      },
    });
    errors.push(`${match.id}: ${sendRes.error}`);
  }

  return { ok: errors.length === 0, sent, skipped, errors };
}
