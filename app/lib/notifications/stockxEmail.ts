import { prisma } from "@/app/lib/prisma";
import { detectMilestone, isStockxInboundDeliveryMilestone } from "@/app/lib/stockxStatus";
import { StockXState } from "@/app/lib/stockxTracking";
import { getMailer } from "@/app/lib/mailer";

type SendOptions = {
  matchId: string;
  force?: boolean;
  skipIfFulfilled?: boolean;
  skipIfEtaPassed?: boolean;
};

type SendResult = {
  ok: boolean;
  sent?: boolean;
  skipped?: boolean;
  reason?: string;
  milestoneKey?: string | null;
  eventId?: string;
  to?: string;
  providerMessageId?: string | null;
  error?: string;
  matchId: string;
};

const MILESTONE_MAX_AGE_DAYS = Math.min(
  365,
  Math.max(1, Number(process.env.STOCKX_MILESTONE_MAX_AGE_DAYS || 60))
);

function isOlderThanDays(value: Date | null | undefined, days: number): boolean {
  if (!value) return true;
  const ageMs = Date.now() - value.getTime();
  return ageMs > days * 24 * 60 * 60 * 1000;
}

const toNumberMaybe = (v: any): number | null => {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const direct = Number(v);
    if (Number.isFinite(direct)) return direct;
    const cleaned = v.replace(/[^\d,.-]/g, "").trim();
    if (!cleaned) return null;
    const normalized = cleaned.includes(".") ? cleaned.replace(/,/g, "") : cleaned.replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof v?.toNumber === "function") {
    try {
      const n = v.toNumber();
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }
  return null;
};

export async function sendMilestoneEmailForMatch({
  matchId,
  force = false,
  skipIfFulfilled = true,
  skipIfEtaPassed = true,
}: SendOptions): Promise<SendResult> {
  const match = await prisma.orderMatch.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      createdAt: true,
      shopifyOrderId: true,
      shopifyOrderName: true,
      shopifyCreatedAt: true,
      matchType: true,
      customerTrackingToken: true,
      shopifyProductTitle: true,
      shopifySku: true,
      shopifySizeEU: true,
      shopifyTotalPrice: true,
      shopifyCustomerEmail: true,
      shopifyCustomerFirstName: true,
      shopifyCustomerLastName: true,
      shopifyLineItemImageUrl: true,
      stockxOrderNumber: true,
      stockxPurchaseDate: true,
      stockxTrackingUrl: true,
      stockxAwb: true,
      stockxStatus: true,
      stockxEstimatedDelivery: true,
      stockxLatestEstimatedDelivery: true,
      stockxCheckoutType: true,
      stockxSkuKey: true,
      stockxSizeEU: true,
      stockxStates: true,
      stockxStatesHash: true,
      lastMilestoneKey: true,
    },
  });

  if (!match) {
    return { ok: false, error: "Match not found", matchId };
  }

  // Safety: never notify for cancelled/refunded supplier orders.
  const stockxStatusKey = String(match.stockxStatus ?? "").trim().toUpperCase();
  if (stockxStatusKey.includes("CANCEL") || stockxStatusKey.includes("REFUND")) {
    return { ok: true, skipped: true, reason: "stockx_cancelled_or_refunded", matchId };
  }

  // Safety: auto_backfill is reconciliation. Allow emails only for recent orders.
  if (match.matchType === "auto_backfill") {
    const recencyAnchor =
      match.shopifyCreatedAt ?? match.stockxPurchaseDate ?? match.createdAt ?? null;
    if (isOlderThanDays(recencyAnchor, MILESTONE_MAX_AGE_DAYS)) {
      return { ok: true, skipped: true, reason: "historical_auto_backfill", matchId };
    }
  }

  if (skipIfFulfilled && match.shopifyOrderId) {
    const fulfilled = await prisma.shopifyFulfillmentRecord.findFirst({
      where: { shopifyOrderId: match.shopifyOrderId },
      select: { id: true },
    });
    if (fulfilled) {
      return { ok: true, skipped: true, reason: "fulfilled_on_shopify", matchId };
    }
  }

  if (skipIfEtaPassed) {
    const eta = match.stockxLatestEstimatedDelivery || match.stockxEstimatedDelivery;
    if (eta && eta.getTime() < Date.now()) {
      return { ok: true, skipped: true, reason: "eta_passed", matchId };
    }
  }

  const states = (match.stockxStates as StockXState[]) || null;
  const milestone = detectMilestone(match.stockxCheckoutType || null, states);
  const milestoneKey = milestone?.key || null;

  if (!milestoneKey) {
    return {
      ok: false,
      error: "No milestone detected (missing stockxStates / not completed yet)",
      matchId,
    };
  }

  if (isStockxInboundDeliveryMilestone(milestoneKey)) {
    return {
      ok: true,
      skipped: true,
      reason: "wait_for_la_poste_fulfillment",
      milestoneKey,
      matchId,
    };
  }

  const event = await prisma.stockXStatusEvent.upsert({
    where: {
      orderMatchId_milestoneKey: { orderMatchId: match.id, milestoneKey },
    },
    create: {
      orderMatchId: match.id,
      milestoneKey,
      milestoneTitle: milestone?.title || milestoneKey,
      statesHash: match.stockxStatesHash || "",
    },
    update: {
      milestoneTitle: milestone?.title || milestoneKey,
      statesHash: match.stockxStatesHash || "",
    },
    select: { id: true, emailedAt: true },
  });

  if (event.emailedAt && !force) {
    return {
      ok: true,
      skipped: true,
      reason: "already_emailed",
      eventId: event.id,
      milestoneKey,
      matchId,
    };
  }

  const mailer = getMailer();
  const overrideTo = (process.env.POSTMARK_OVERRIDE_TO || "").trim();
  const to = overrideTo || (match.shopifyCustomerEmail || "").trim();
  if (!to) {
    return {
      ok: true,
      skipped: true,
      reason: "missing_customer_email",
      eventId: event.id,
      milestoneKey,
      matchId,
    };
  }
  const sendRes = await mailer.sendStockXMilestoneEmail({
    to,
    stockxStates: states,
    match: {
      id: match.id,
      customerTrackingToken: match.customerTrackingToken ?? null,
      shopifyOrderName: match.shopifyOrderName,
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
      stockxTrackingUrl: match.stockxTrackingUrl ?? null,
      stockxAwb: match.stockxAwb ?? null,
      stockxEstimatedDelivery: match.stockxEstimatedDelivery ?? null,
      stockxLatestEstimatedDelivery: match.stockxLatestEstimatedDelivery ?? null,
    },
    milestone: {
      key: milestoneKey,
      title: milestone?.title || milestoneKey,
      description: milestone?.description || "",
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
      data: { lastMilestoneKey: milestoneKey, lastMilestoneAt: new Date() },
    });

    return {
      ok: true,
      sent: true,
      eventId: event.id,
      milestoneKey,
      to: sendRes.to,
      providerMessageId: sendRes.providerMessageId || null,
      matchId,
    };
  }

  await prisma.stockXStatusEvent.update({
    where: { id: event.id },
    data: {
      emailTo: sendRes.to,
      emailProvider: sendRes.provider,
      emailError: sendRes.error.slice(0, 1000),
    },
  });

  return {
    ok: false,
    sent: false,
    eventId: event.id,
    milestoneKey,
    error: sendRes.error,
    matchId,
  };
}
