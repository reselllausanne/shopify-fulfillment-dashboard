import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { formatInTimeZone } from "date-fns-tz";
import { hashStockXStates, StockXState } from "@/app/lib/stockxTracking";
import { detectMilestone } from "@/app/lib/stockxStatus";
import { getMailer } from "@/app/lib/mailer";

const TIMEZONE = "Europe/Zurich";
// Auto-send is disabled by default; only manual send should deliver emails.
const AUTO_SEND_EMAILS = false;
// Date handling helpers live in this file
export const runtime = "nodejs";

type EmailMatch = {
  id: string;
  shopifyOrderName: string;
  shopifyProductTitle: string;
  shopifySku: string | null;
  shopifySizeEU: string | null;
  shopifyTotalPriceChf: number | null;
  shopifyCustomerEmail: string | null;
  shopifyCustomerFirstName: string | null;
  shopifyCustomerLastName: string | null;
  shopifyLineItemImageUrl: string | null;
  stockxCheckoutType: string | null;
  stockxOrderNumber: string | null;
  stockxSkuKey: string | null;
  stockxSizeEU: string | null;
  stockxTrackingUrl: string | null;
  stockxAwb: string | null;
  stockxEstimatedDelivery: Date | null;
  stockxLatestEstimatedDelivery: Date | null;
};

function pickEmailMatch(m: any): EmailMatch {
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

  return {
    id: m.id,
    shopifyOrderName: m.shopifyOrderName,
    shopifyProductTitle: m.shopifyProductTitle,
    shopifySku: m.shopifySku ?? null,
    shopifySizeEU: m.shopifySizeEU ?? null,
    shopifyTotalPriceChf: toNumberMaybe(m.shopifyTotalPrice ?? null),
    shopifyCustomerEmail: m.shopifyCustomerEmail ?? null,
    shopifyCustomerFirstName: m.shopifyCustomerFirstName ?? null,
    shopifyCustomerLastName: m.shopifyCustomerLastName ?? null,
    shopifyLineItemImageUrl: m.shopifyLineItemImageUrl ?? null,
    stockxCheckoutType: m.stockxCheckoutType ?? null,
    stockxOrderNumber: m.stockxOrderNumber ?? null,
    stockxSkuKey: m.stockxSkuKey ?? null,
    stockxSizeEU: m.stockxSizeEU ?? null,
    stockxTrackingUrl: m.stockxTrackingUrl ?? null,
    stockxAwb: m.stockxAwb ?? null,
    stockxEstimatedDelivery: m.stockxEstimatedDelivery ?? null,
    stockxLatestEstimatedDelivery: m.stockxLatestEstimatedDelivery ?? null,
  };
}

async function upsertMilestoneEventAndMaybeEmail(opts: {
  match: EmailMatch;
  previousLastMilestoneKey: string | null;
  checkoutType: string | null;
  states: StockXState[] | null;
  statesHash: string | null;
}) {
  const milestone = detectMilestone(opts.checkoutType, opts.states);
  const milestoneKey = milestone?.key || null;

  if (!milestoneKey || milestoneKey === opts.previousLastMilestoneKey) {
    return;
  }

  // Ensure match.lastMilestoneKey stays in sync
  await prisma.orderMatch.update({
    where: { id: opts.match.id },
    data: { lastMilestoneKey: milestoneKey, lastMilestoneAt: new Date() },
  });

  // Upsert event so we can retry sending if needed (no dupes)
  const event = await prisma.stockXStatusEvent.upsert({
    where: {
      orderMatchId_milestoneKey: { orderMatchId: opts.match.id, milestoneKey },
    },
    create: {
      orderMatchId: opts.match.id,
      milestoneKey,
      milestoneTitle: milestone?.title || milestoneKey,
      statesHash: opts.statesHash || "",
    },
    update: {
      milestoneTitle: milestone?.title || milestoneKey,
      statesHash: opts.statesHash || "",
    },
    select: {
      id: true,
      emailedAt: true,
    },
  });

  if (event.emailedAt) return;
  if (!AUTO_SEND_EMAILS) {
    console.log("[EMAIL] Auto send disabled; event recorded but not delivered");
    return;
  }

  const mailer = getMailer();
  const to = opts.match.shopifyCustomerEmail || "unknown@example.com";
  const sendRes = await mailer.sendStockXMilestoneEmail({
    to,
    stockxStates: opts.states,
    match: opts.match,
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
    return;
  }

  await prisma.stockXStatusEvent.update({
    where: { id: event.id },
    data: {
      emailTo: sendRes.to,
      emailProvider: sendRes.provider,
      emailError: sendRes.error.slice(0, 1000),
    },
  });
}

/**
 * POST /api/db/save-match
 * 
 * Saves or updates a Shopify-StockX order match in the database.
 * If a match for this lineItemId already exists, it will be updated (upsert).
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();

    const parseFlexibleDate = (value: any): Date | null => {
      if (!value) return null;
      const direct = new Date(value);
      if (!isNaN(direct.getTime())) return direct;
      if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
        const patched = new Date(`${value}:00`);
        if (!isNaN(patched.getTime())) return patched;
      }
      return null;
    };

    const toDateOnlyUtc = (d: Date | null): Date | null => {
      if (!d) return null;
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    };

    const {
      stockxChainId,
      stockxOrderId,
      shopifyOrderId,
      shopifyOrderName,
      shopifyCreatedAt,
      shopifyLineItemId,
      shopifyProductTitle,
      shopifySku,
      shopifySizeEU,
      shopifyTotalPrice,
      shopifyCurrencyCode,
      shopifyCustomerEmail,
      shopifyCustomerFirstName,
      shopifyCustomerLastName,
      shopifyLineItemImageUrl,
      stockxOrderNumber,
      stockxProductName,
      stockxSizeEU,
      stockxSkuKey,
      stockxPurchaseDate,
      matchConfidence,
      matchScore,
      matchType,
      matchReasons,
      timeDiffHours,
      stockxStatus,
      stockxEstimatedDelivery,
      stockxLatestEstimatedDelivery,
      supplierCost,
      marginAmount,
      marginPercent,
      manualCostOverride,
      shopifyMetafieldsSynced,
      supplierSource, // NEW: STOCKX | MANUAL | OTHER
      supplierPurchaseDate, // NEW: Alias for stockxPurchaseDate
      supplierOrderRef, // NEW: Manual supplier reference (friend, local, etc.)
      estimatedDeliveryDate, // NEW: ETA for manual suppliers
      stockxAwb, // NEW: Air Waybill / tracking number (extracted from trackingUrl)
      stockxTrackingUrl, // NEW: Full tracking URL from shipping.shipment
      stockxCheckoutType, // NEW: StockX checkoutType (STANDARD / EXPRESS_*)
      stockxStates, // NEW: StockX states array (raw)
      updateTrackingOnly, // NEW: only update tracking/status fields
    } = body;
    
    // 🔍 DEBUG: Log received chainId/orderId
    if (stockxOrderNumber) {
      console.log(`[SAVE-MATCH] Received for ${stockxOrderNumber}:`, {
        chainId: stockxChainId,
        orderId: stockxOrderId,
        hasChainId: !!stockxChainId,
        hasOrderId: !!stockxOrderId
      });
    }

    // Validation
    if (!shopifyLineItemId) {
      return NextResponse.json(
        { error: "Missing required field: shopifyLineItemId" },
        { status: 400 }
      );
    }

    const existingMatch = await prisma.orderMatch.findUnique({
      where: { shopifyLineItemId },
      select: {
        stockxOrderNumber: true,
        stockxChainId: true,
        stockxOrderId: true,
        stockxStatus: true,
        stockxTrackingUrl: true,
        stockxAwb: true,
        stockxEstimatedDelivery: true,
        stockxLatestEstimatedDelivery: true,
        stockxPurchaseDate: true,
        stockxCheckoutType: true,
        stockxStates: true,
        stockxStatesHash: true,
        lastMilestoneKey: true,
        shopifyMetafieldsSynced: true,
        manualCaseStatus: true,
        manualRevenueAdjustment: true,
        manualCostOverride: true,
        returnReason: true,
        returnFeePercent: true,
        returnFeeAmountChf: true,
        returnedStockValueChf: true,
      },
    });

    // Determine supplier source
    const finalSupplierSource = supplierSource || (stockxOrderNumber ? "STOCKX" : "MANUAL");
    const isManualSupplier = finalSupplierSource === "MANUAL" || finalSupplierSource === "OTHER";
    
    // Manual suppliers don't need StockX order number
    const isManualCostEntry = matchType === "MANUAL_COST" || (!stockxOrderNumber && manualCostOverride);
    
    if (!isManualCostEntry && !isManualSupplier && !stockxOrderNumber) {
      return NextResponse.json(
        { error: "Missing required field: stockxOrderNumber (unless manual supplier)" },
        { status: 400 }
      );
    }

    console.log(`[DB] Upserting match: ${shopifyOrderName} → ${stockxOrderNumber || supplierOrderRef || "MANUAL"} [Source: ${finalSupplierSource}]`);

    // Determine final values based on supplier source
    const finalStockxOrderNumber = stockxOrderNumber || supplierOrderRef || `MANUAL-${shopifyLineItemId.slice(-8)}`;
    const finalStockxProductName = stockxProductName || shopifyProductTitle;
    let resolvedStockxStatus: string | null = stockxStatus || null;
    const finalMatchType = isManualCostEntry ? "MANUAL_COST" : matchType;
    let finalPurchaseDate = supplierPurchaseDate || stockxPurchaseDate;
    let finalEstimatedDelivery = estimatedDeliveryDate || stockxEstimatedDelivery;
    let finalLatestEstimatedDelivery = stockxLatestEstimatedDelivery || null;
    let resolvedTrackingUrl = stockxTrackingUrl || null;
    let resolvedAwb = stockxAwb || null;
    let resolvedCheckoutType = stockxCheckoutType || null;
    let resolvedStates = stockxStates || null;
    let resolvedStatesHash = hashStockXStates(resolvedStates as any);

    // NOTE: We no longer fetch StockX details here.
    // All tracking/checkoutType/states must come from the enriched StockX order payload.

    const finalStockxStatus =
      resolvedStockxStatus || (isManualSupplier ? "MANUAL_SUPPLIER" : "MANUAL_COST_ONLY");
    const parsedPurchaseDate = toDateOnlyUtc(parseFlexibleDate(finalPurchaseDate));
    const parsedEstimatedDelivery = toDateOnlyUtc(parseFlexibleDate(finalEstimatedDelivery));
    const parsedLatestEstimatedDelivery = toDateOnlyUtc(parseFlexibleDate(finalLatestEstimatedDelivery));

    const parsedShopifyCreatedAt = (() => {
      const raw = parseFlexibleDate(shopifyCreatedAt);
      if (!raw) return null;
      // Store Zurich-local wall time as UTC (no extra offset on display/grouping)
      const localStr = formatInTimeZone(raw, TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
      return new Date(`${localStr}.000Z`);
    })();
    const shouldUpdateStates =
      resolvedStatesHash != null && resolvedStatesHash !== existingMatch?.stockxStatesHash;

    if (updateTrackingOnly && existingMatch) {
      const trackingUpdate: Record<string, any> = {};
      if (finalStockxStatus && finalStockxStatus !== existingMatch.stockxStatus) {
        trackingUpdate.stockxStatus = finalStockxStatus;
      }
      if (resolvedAwb && resolvedAwb !== existingMatch.stockxAwb) {
        trackingUpdate.stockxAwb = resolvedAwb;
      }
      if (resolvedTrackingUrl && resolvedTrackingUrl !== existingMatch.stockxTrackingUrl) {
        trackingUpdate.stockxTrackingUrl = resolvedTrackingUrl;
      }
      if (resolvedCheckoutType && resolvedCheckoutType !== existingMatch.stockxCheckoutType) {
        trackingUpdate.stockxCheckoutType = resolvedCheckoutType;
      }
      if (
        parsedEstimatedDelivery &&
        (!existingMatch.stockxEstimatedDelivery ||
          parsedEstimatedDelivery.getTime() !== new Date(existingMatch.stockxEstimatedDelivery).getTime())
      ) {
        trackingUpdate.stockxEstimatedDelivery = parsedEstimatedDelivery;
      }
      if (
        parsedLatestEstimatedDelivery &&
        (!existingMatch.stockxLatestEstimatedDelivery ||
          parsedLatestEstimatedDelivery.getTime() !==
            new Date(existingMatch.stockxLatestEstimatedDelivery).getTime())
      ) {
        trackingUpdate.stockxLatestEstimatedDelivery = parsedLatestEstimatedDelivery;
      }
      if (
        resolvedStates &&
        resolvedStatesHash &&
        resolvedStatesHash !== existingMatch.stockxStatesHash
      ) {
        trackingUpdate.stockxStates = resolvedStates;
        trackingUpdate.stockxStatesHash = resolvedStatesHash;
        trackingUpdate.stockxStatesUpdatedAt = new Date();
      }
      if (Object.keys(trackingUpdate).length > 0) {
        trackingUpdate.updatedAt = new Date();
        await prisma.orderMatch.update({
          where: { shopifyLineItemId },
          data: trackingUpdate,
        });
      }

      // Milestone detection + mailer (tracking-only updates can advance milestones too)
      const updated = await prisma.orderMatch.findUnique({
        where: { shopifyLineItemId },
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

      if (updated) {
        await upsertMilestoneEventAndMaybeEmail({
          match: pickEmailMatch(updated),
          previousLastMilestoneKey: existingMatch.lastMilestoneKey || null,
          checkoutType: updated.stockxCheckoutType || null,
          states: (updated.stockxStates as StockXState[]) || null,
          statesHash: updated.stockxStatesHash || null,
        });
      }

      return NextResponse.json(
        { success: true, match: { ...existingMatch, ...trackingUpdate } },
        { status: 200 }
      );
    }

    const hasNewStockxData = (() => {
      if (!existingMatch) return true;
      const diff = (incoming: any, current: any) => {
        if (incoming === null || incoming === undefined || incoming === "") return false;
        return String(incoming) !== String(current ?? "");
      };
      const dateDiff = (incoming: Date | null, current: Date | null) => {
        if (!incoming) return false;
        if (!current) return true;
        return incoming.getTime() !== current.getTime();
      };

      return (
        diff(finalStockxOrderNumber, existingMatch.stockxOrderNumber) ||
        diff(stockxChainId, existingMatch.stockxChainId) ||
        diff(stockxOrderId, existingMatch.stockxOrderId) ||
        diff(finalStockxStatus, existingMatch.stockxStatus) ||
        diff(resolvedTrackingUrl, existingMatch.stockxTrackingUrl) ||
        diff(resolvedAwb, existingMatch.stockxAwb) ||
        diff(resolvedCheckoutType, existingMatch.stockxCheckoutType) ||
        (resolvedStatesHash != null && resolvedStatesHash !== existingMatch.stockxStatesHash) ||
        dateDiff(parsedEstimatedDelivery, existingMatch.stockxEstimatedDelivery) ||
        dateDiff(parsedLatestEstimatedDelivery, (existingMatch as any).stockxLatestEstimatedDelivery ?? null) ||
        dateDiff(parsedPurchaseDate, existingMatch.stockxPurchaseDate)
      );
    })();

    const resolvedMetafieldsSynced =
      typeof shopifyMetafieldsSynced === "boolean" ? shopifyMetafieldsSynced : undefined;
    const resolvedMetafieldsSetAt =
      typeof shopifyMetafieldsSynced === "boolean"
        ? shopifyMetafieldsSynced
          ? new Date()
          : null
        : undefined;

    const hasManualOverrides =
      !!existingMatch?.manualCaseStatus ||
      existingMatch?.manualRevenueAdjustment != null ||
      existingMatch?.manualCostOverride != null ||
      existingMatch?.returnReason != null ||
      existingMatch?.returnFeePercent != null ||
      existingMatch?.returnFeeAmountChf != null ||
      existingMatch?.returnedStockValueChf != null;

    // Upsert (create or update)
    const match = await prisma.orderMatch.upsert({
      where: { shopifyLineItemId },
      update: {
        supplierSource: finalSupplierSource,
        stockxOrderNumber: finalStockxOrderNumber,
        stockxChainId: stockxChainId || undefined, // Preserve if not provided
        stockxOrderId: stockxOrderId || undefined, // Preserve if not provided
        stockxProductName: finalStockxProductName,
        stockxSizeEU,
        stockxSkuKey,
        stockxPurchaseDate: parsedPurchaseDate || undefined,
        shopifyCreatedAt: parsedShopifyCreatedAt || undefined,
        shopifyCustomerEmail: shopifyCustomerEmail ?? undefined,
        shopifyCustomerFirstName: shopifyCustomerFirstName ?? undefined,
        shopifyCustomerLastName: shopifyCustomerLastName ?? undefined,
        shopifyLineItemImageUrl: shopifyLineItemImageUrl ?? undefined,
        matchConfidence,
        matchScore,
        matchType: finalMatchType,
        matchReasons: JSON.stringify(matchReasons || []),
        timeDiffHours,
        stockxStatus: finalStockxStatus,
        stockxAwb: resolvedAwb || undefined,
        stockxTrackingUrl: resolvedTrackingUrl || undefined,
        stockxEstimatedDelivery: parsedEstimatedDelivery || undefined,
        stockxLatestEstimatedDelivery: parsedLatestEstimatedDelivery || undefined,
        stockxCheckoutType: resolvedCheckoutType || undefined,
        stockxStates: shouldUpdateStates ? resolvedStates : undefined,
        stockxStatesHash: shouldUpdateStates ? resolvedStatesHash : undefined,
        stockxStatesUpdatedAt: shouldUpdateStates ? new Date() : undefined,
        supplierCost: hasManualOverrides ? undefined : supplierCost,
        marginAmount: hasManualOverrides ? undefined : marginAmount,
        marginPercent: hasManualOverrides ? undefined : marginPercent,
        manualCostOverride: hasManualOverrides ? undefined : manualCostOverride,
        shopifyMetafieldsSynced: resolvedMetafieldsSynced,
        shopifyMetafieldsSetAt: resolvedMetafieldsSetAt,
        updatedAt: new Date(),
      },
      create: {
        shopifyOrderId,
        shopifyOrderName,
        shopifyCreatedAt: parsedShopifyCreatedAt || null,
        shopifyLineItemId,
        shopifyProductTitle,
        shopifySku: shopifySku || null,
        shopifySizeEU: shopifySizeEU || null,
        shopifyTotalPrice,
        shopifyCurrencyCode: shopifyCurrencyCode || "CHF",
        shopifyCustomerEmail: shopifyCustomerEmail ?? null,
        shopifyCustomerFirstName: shopifyCustomerFirstName ?? null,
        shopifyCustomerLastName: shopifyCustomerLastName ?? null,
        shopifyLineItemImageUrl: shopifyLineItemImageUrl ?? null,
        supplierSource: finalSupplierSource,
        stockxChainId: stockxChainId || null,
        stockxOrderNumber: finalStockxOrderNumber,
        stockxOrderId: stockxOrderId || null,
        stockxProductName: finalStockxProductName,
        stockxSizeEU: stockxSizeEU || null,
        stockxSkuKey: stockxSkuKey || null,
        stockxPurchaseDate: parsedPurchaseDate || null,
        matchConfidence: matchConfidence ?? (isManualSupplier ? "HIGH" : "MEDIUM"),
        matchScore: matchScore ?? (isManualSupplier ? 1.0 : 0.0),
        matchType: finalMatchType || "MANUAL",
        matchReasons: JSON.stringify(matchReasons || []),
        timeDiffHours: timeDiffHours ?? null,
        stockxStatus: finalStockxStatus,
        stockxAwb: resolvedAwb || null,
        stockxTrackingUrl: resolvedTrackingUrl || null,
        stockxEstimatedDelivery: parsedEstimatedDelivery || null,
        stockxLatestEstimatedDelivery: parsedLatestEstimatedDelivery || null,
        stockxCheckoutType: resolvedCheckoutType || null,
        stockxStates: resolvedStates || null,
        stockxStatesHash: resolvedStatesHash || null,
        stockxStatesUpdatedAt: resolvedStatesHash ? new Date() : null,
        supplierCost: supplierCost ?? 0,
        marginAmount: marginAmount ?? 0,
        marginPercent: marginPercent ?? 0,
        manualCostOverride: manualCostOverride || null,
        shopifyMetafieldsSynced: shopifyMetafieldsSynced || false,
        shopifyMetafieldsSetAt: shopifyMetafieldsSynced ? new Date() : null,
      },
    });

    console.log(`[DB] Match saved: ${match.id}`);
    
    // 🔍 VALIDATION: Verify chainId/orderId were persisted
    if (stockxOrderNumber && (stockxChainId || stockxOrderId)) {
      console.log(`[DB] ✅ Verification - chainId/orderId persisted:`, {
        stockxChainId: match.stockxChainId,
        stockxOrderId: match.stockxOrderId,
        stockxOrderNumber: match.stockxOrderNumber
      });
      
      if (!match.stockxChainId && stockxChainId) {
        console.error(`[DB] ❌ WARNING: chainId was sent but not persisted!`, {
          sent: stockxChainId,
          persisted: match.stockxChainId
        });
      }
      if (!match.stockxOrderId && stockxOrderId) {
        console.error(`[DB] ❌ WARNING: orderId was sent but not persisted!`, {
          sent: stockxOrderId,
          persisted: match.stockxOrderId
        });
      }
    }

    await upsertMilestoneEventAndMaybeEmail({
      match: pickEmailMatch(match),
      previousLastMilestoneKey: existingMatch?.lastMilestoneKey || null,
      checkoutType: (match.stockxCheckoutType as string | null) || null,
      states: (match.stockxStates as StockXState[]) || null,
      statesHash: (match.stockxStatesHash as string | null) || null,
    });

    return NextResponse.json({ success: true, match }, { status: 200 });
  } catch (error: any) {
    console.error("[DB] Error saving match:", error);
    return NextResponse.json(
      { error: "Failed to save match", details: error.message },
      { status: 500 }
    );
  }
}


