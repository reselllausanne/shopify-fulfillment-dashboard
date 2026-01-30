// app/api/db/manual-override/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POC: Manual Override for Refunds/Returns
 * 
 * Updates manual fields without touching auto-sync data
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { 
      matchId, 
      manualCaseStatus, 
      manualRevenueAdjustment, 
      manualNote,
      manualSupplierCost,
      returnReason,
      returnFeePercent,
      returnedStockValueChf,
    } = body;

    if (!matchId) {
      return NextResponse.json(
        { error: "matchId is required" },
        { status: 400 }
      );
    }

    // Validate case status
    const validStatuses = [null, "ACTIVE", "CLOSED_CREDIT", "RETURNED", "EXCHANGE_PENDING"];
    if (manualCaseStatus && !validStatuses.includes(manualCaseStatus)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` },
        { status: 400 }
      );
    }

    const validReturnReasons = [null, "STORE_CREDIT", "EXCHANGE", "DAMAGE"];
    if (returnReason && !validReturnReasons.includes(returnReason)) {
      return NextResponse.json(
        { error: `Invalid returnReason. Must be one of: ${validReturnReasons.join(", ")}` },
        { status: 400 }
      );
    }

    // Get current match
    const existingMatch = await prisma.orderMatch.findUnique({
      where: { id: matchId },
    });

    if (!existingMatch) {
      return NextResponse.json(
        { error: "Match not found" },
        { status: 404 }
      );
    }

    console.log(
      `[MANUAL_OVERRIDE] Updating match ${existingMatch.shopifyOrderName} → ${existingMatch.stockxOrderNumber}`
    );
    console.log(`[MANUAL_OVERRIDE] Status: ${manualCaseStatus || "null"}`);
    console.log(`[MANUAL_OVERRIDE] Revenue Adjustment: CHF ${manualRevenueAdjustment || 0}`);
    console.log(`[MANUAL_OVERRIDE] Manual Cost: CHF ${manualSupplierCost || "null"}`);

    // Calculate new margins if manual cost or revenue adjustment changes
    const revenue = Number(existingMatch.shopifyTotalPrice);
    const defaultFeePercent =
      returnReason === "STORE_CREDIT" ? 25 : returnReason === "EXCHANGE" ? 15 : returnReason === "DAMAGE" ? 0 : null;
    const feePercent =
      returnReason && returnFeePercent !== undefined && returnFeePercent !== null
        ? Number(returnFeePercent)
        : defaultFeePercent;
    const returnFeeAmountChf =
      returnReason && feePercent !== null && !isNaN(feePercent)
        ? Number(((revenue * feePercent) / 100).toFixed(2))
        : null;
    const resolvedRevenueAdjustment =
      manualRevenueAdjustment !== undefined && manualRevenueAdjustment !== null
        ? Number(manualRevenueAdjustment)
        : Number(existingMatch.manualRevenueAdjustment || 0);
    const effectiveRevenue =
      returnReason && returnFeeAmountChf !== null
        ? returnFeeAmountChf
        : revenue + resolvedRevenueAdjustment;
    const supplierCostValue =
      existingMatch.manualCostOverride !== null && existingMatch.manualCostOverride !== undefined
        ? Number(existingMatch.manualCostOverride)
        : Number(existingMatch.supplierCost);
    const resolvedManualCost =
      manualSupplierCost !== undefined && manualSupplierCost !== null
        ? Number(manualSupplierCost)
        : supplierCostValue;
    const effectiveCost = resolvedManualCost;
    const resolvedReturnedStockValue =
      returnedStockValueChf !== undefined && returnedStockValueChf !== null
        ? Number(returnedStockValueChf)
        : returnReason
        ? Number(effectiveCost)
        : null;
    
    const newMarginAmount = effectiveRevenue - effectiveCost;
    const newMarginPercent = effectiveRevenue > 0 
      ? (newMarginAmount / effectiveRevenue) * 100 
      : 0;

    console.log(`[MANUAL_OVERRIDE] 💰 Recalculated: Revenue ${effectiveRevenue.toFixed(2)} - Cost ${effectiveCost.toFixed(2)} = Margin ${newMarginAmount.toFixed(2)} (${newMarginPercent.toFixed(1)}%)`);

    // Update manual fields + recalculate margins
    const updated = await prisma.orderMatch.update({
      where: { id: matchId },
      data: {
        manualCaseStatus: manualCaseStatus || null,
        manualRevenueAdjustment: manualRevenueAdjustment !== undefined ? manualRevenueAdjustment : undefined,
        manualNote: manualNote || null,
        manualCostOverride: manualSupplierCost !== undefined && manualSupplierCost !== null ? manualSupplierCost : undefined,
        returnReason: returnReason || null,
        returnFeePercent: returnReason ? (feePercent !== null ? feePercent : undefined) : null,
        returnFeeAmountChf: returnReason ? (returnFeeAmountChf !== null ? returnFeeAmountChf : undefined) : null,
        returnAppliedAt: returnReason ? new Date() : null,
        returnedStockValueChf: returnReason ? (resolvedReturnedStockValue !== null ? resolvedReturnedStockValue : undefined) : null,
        // Recalculate financial fields
        supplierCost: effectiveCost,
        marginAmount: newMarginAmount,
        marginPercent: newMarginPercent,
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      updatedMatch: updated,
      calculated: {
        effectiveRevenue,
        effectiveCost,
        newMarginAmount,
        newMarginPercent,
      },
    });

  } catch (error: any) {
    console.error("[MANUAL_OVERRIDE] Error:", error);
    return NextResponse.json(
      { 
        error: "Failed to update manual override",
        details: error.message 
      },
      { status: 500 }
    );
  }
}

