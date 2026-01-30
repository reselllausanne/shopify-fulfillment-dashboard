import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { toNumberSafe } from "@/app/utils/numbers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/variable-costs?year=2026
 * Get monthly variable costs records
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const yearStr = searchParams.get("year");
    
    const where: any = {};
    if (yearStr) {
      const year = parseInt(yearStr);
      if (!isNaN(year)) {
        where.year = year;
      }
    }
    
    const records = await prisma.monthlyVariableCosts.findMany({
      where,
      orderBy: [
        { year: "desc" },
        { month: "desc" },
      ],
    });
    
    // Convert Decimals to numbers for frontend
    const recordsWithNumbers = records.map((r: (typeof records)[number]) => ({
      ...r,
      postageShippingCostChf: toNumberSafe(r.postageShippingCostChf, 0),
      fulfillmentCostChf: toNumberSafe(r.fulfillmentCostChf, 0),
      totalCostChf: toNumberSafe(r.postageShippingCostChf, 0) + toNumberSafe(r.fulfillmentCostChf, 0),
    }));
    
    return NextResponse.json({
      success: true,
      count: records.length,
      records: recordsWithNumbers,
    }, { status: 200 });
    
  } catch (error: any) {
    console.error("[VARIABLE-COSTS] GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch variable costs", details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/variable-costs
 * Create or update (upsert) monthly variable costs
 * Body: { year: number, month: number, postageShippingCostChf: number, fulfillmentCostChf: number, notes?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { year, month, postageShippingCostChf, fulfillmentCostChf, notes } = body;
    
    // Validation
    if (!year || !month) {
      return NextResponse.json(
        { error: "Missing required fields: year, month" },
        { status: 400 }
      );
    }
    
    const yearNum = parseInt(year);
    const monthNum = parseInt(month);
    
    if (isNaN(yearNum) || yearNum < 2020 || yearNum > 2100) {
      return NextResponse.json(
        { error: "Invalid year. Must be between 2020-2100" },
        { status: 400 }
      );
    }
    
    if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
      return NextResponse.json(
        { error: "Invalid month. Must be between 1-12" },
        { status: 400 }
      );
    }
    
    const postage = parseFloat(postageShippingCostChf || 0);
    const fulfillment = parseFloat(fulfillmentCostChf || 0);
    
    if (isNaN(postage) || postage < 0 || isNaN(fulfillment) || fulfillment < 0) {
      return NextResponse.json(
        { error: "Invalid cost amounts. Must be positive numbers" },
        { status: 400 }
      );
    }
    
    // Generate monthKey: "YYYY-MM"
    const monthKey = `${yearNum}-${monthNum.toString().padStart(2, '0')}`;
    
    const record = await prisma.monthlyVariableCosts.upsert({
      where: { monthKey },
      update: {
        postageShippingCostChf: postage,
        fulfillmentCostChf: fulfillment,
        notes: notes || null,
        updatedAt: new Date(),
      },
      create: {
        monthKey,
        year: yearNum,
        month: monthNum,
        postageShippingCostChf: postage,
        fulfillmentCostChf: fulfillment,
        notes: notes || null,
      },
    });
    
    console.log(`[VARIABLE-COSTS] Upserted: ${monthKey} Postage: CHF ${postage}, Fulfillment: CHF ${fulfillment}`);
    
    return NextResponse.json({
      success: true,
      record: {
        ...record,
        postageShippingCostChf: toNumberSafe(record.postageShippingCostChf, 0),
        fulfillmentCostChf: toNumberSafe(record.fulfillmentCostChf, 0),
      },
    }, { status: 200 });
    
  } catch (error: any) {
    console.error("[VARIABLE-COSTS] POST error:", error);
    return NextResponse.json(
      { error: "Failed to save variable costs", details: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/variable-costs?monthKey=YYYY-MM
 * Delete monthly variable costs record
 */
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const monthKey = searchParams.get("monthKey");
    
    if (!monthKey) {
      return NextResponse.json(
        { error: "Missing required parameter: monthKey" },
        { status: 400 }
      );
    }
    
    // Validate format YYYY-MM
    if (!/^\d{4}-\d{2}$/.test(monthKey)) {
      return NextResponse.json(
        { error: "Invalid monthKey format. Use YYYY-MM" },
        { status: 400 }
      );
    }
    
    await prisma.monthlyVariableCosts.delete({
      where: { monthKey },
    });
    
    console.log(`[VARIABLE-COSTS] Deleted: ${monthKey}`);
    
    return NextResponse.json({
      success: true,
      message: `Variable costs for ${monthKey} deleted`,
    }, { status: 200 });
    
  } catch (error: any) {
    console.error("[VARIABLE-COSTS] DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to delete variable costs", details: error.message },
      { status: 500 }
    );
  }
}

