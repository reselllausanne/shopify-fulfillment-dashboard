import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { detectMilestone } from "@/app/lib/stockxStatus";
import { StockXState } from "@/app/lib/stockxTracking";
import { getMailer } from "@/app/lib/mailer";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const matchId = String(body.matchId || "");
    const force = Boolean(body.force);

    if (!matchId) {
      return NextResponse.json({ ok: false, error: "Missing matchId" }, { status: 400 });
    }

    const match = await prisma.orderMatch.findUnique({
      where: { id: matchId },
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
        stockxChainId: true,
        stockxOrderNumber: true,
        stockxTrackingUrl: true,
        stockxAwb: true,
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
      return NextResponse.json({ ok: false, error: "Match not found" }, { status: 404 });
    }

    // Fallback: if tracking URL is missing on OrderMatch, try SupplierOrderTracking
    let resolvedTrackingUrl = match.stockxTrackingUrl ?? null;
    let resolvedAwb = match.stockxAwb ?? null;
    if (!resolvedTrackingUrl && match.stockxChainId && match.stockxOrderNumber) {
      const trackingRecord = await prisma.supplierOrderTracking.findUnique({
        where: {
          chainId_orderNumber: {
            chainId: match.stockxChainId,
            orderNumber: match.stockxOrderNumber,
          },
        },
        select: {
          trackingUrl: true,
          awb: true,
        },
      });
      if (trackingRecord?.trackingUrl) {
        resolvedTrackingUrl = trackingRecord.trackingUrl;
      }
      if (!resolvedAwb && trackingRecord?.awb) {
        resolvedAwb = trackingRecord.awb;
      }
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

    const checkoutType = match.stockxCheckoutType || null;

    const states = (match.stockxStates as StockXState[]) || null;
    const milestone = detectMilestone(checkoutType, states);
    const milestoneKey = milestone?.key || null;

    if (!milestoneKey) {
      return NextResponse.json(
        { ok: false, error: "No milestone detected (missing stockxStates / not completed yet)" },
        { status: 400 }
      );
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
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "already_emailed",
        eventId: event.id,
        milestoneKey,
      });
    }

    const mailer = getMailer();
    const to = match.shopifyCustomerEmail || "unknown@example.com";
    const sendRes = await mailer.sendStockXMilestoneEmail({
      to,
      stockxStates: states,
      match: {
        id: match.id,
        shopifyOrderName: match.shopifyOrderName,
        shopifyProductTitle: match.shopifyProductTitle,
        shopifySku: match.shopifySku ?? null,
        shopifySizeEU: match.shopifySizeEU ?? null,
        shopifyTotalPriceChf: toNumberMaybe(match.shopifyTotalPrice),
        shopifyLineItemImageUrl: match.shopifyLineItemImageUrl ?? null,
        shopifyCustomerFirstName: match.shopifyCustomerFirstName ?? null,
        shopifyCustomerLastName: match.shopifyCustomerLastName ?? null,
        stockxCheckoutType: match.stockxCheckoutType ?? null,
        stockxSkuKey: match.stockxSkuKey ?? null,
        stockxSizeEU: match.stockxSizeEU ?? null,
        stockxTrackingUrl: resolvedTrackingUrl,
        stockxAwb: resolvedAwb,
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

      return NextResponse.json({
        ok: true,
        sent: true,
        eventId: event.id,
        milestoneKey,
        to: sendRes.to,
        providerMessageId: sendRes.providerMessageId || null,
      });
    }

    await prisma.stockXStatusEvent.update({
      where: { id: event.id },
      data: {
        emailTo: sendRes.to,
        emailProvider: sendRes.provider,
        emailError: sendRes.error.slice(0, 1000),
      },
    });

    return NextResponse.json(
      {
        ok: false,
        sent: false,
        eventId: event.id,
        milestoneKey,
        error: sendRes.error,
      },
      { status: 500 }
    );
  } catch (error: any) {
    console.error("[SEND-ONE] Failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to send" },
      { status: 500 }
    );
  }
}

