import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { toNumberSafe } from "@/app/utils/numbers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const parseYmdUtc = (value?: string | null): Date | null => {
  if (!value) return null;
  const parts = value.split("-");
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map((p) => Number(p));
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
};

/**
 * GET /api/ads-spend?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Get daily ad spend records
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    
    // Build date filter (UTC, inclusive)
    const dateFilter: any = {};
    const fromDate = parseYmdUtc(from);
    if (fromDate) {
      dateFilter.gte = fromDate;
    }
    const toDateBase = parseYmdUtc(to);
    if (toDateBase) {
      const toDate = new Date(toDateBase);
      toDate.setUTCHours(23, 59, 59, 999);
      dateFilter.lte = toDate;
    }
    
    const where = Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {};
    
    const records = await prisma.dailyAdSpend.findMany({
      where,
      orderBy: {
        date: "desc",
      },
    });
    
    // Convert Decimals to numbers for frontend
    const recordsWithNumbers = records.map((r: any) => ({
      ...r,
      amountChf: toNumberSafe(r.amountChf, 0),
      date: r.date.toISOString().split('T')[0], // YYYY-MM-DD format
    }));
    
    const total = records.reduce((sum: number, r: any) => sum + toNumberSafe(r.amountChf, 0), 0);
    
    return NextResponse.json({
      success: true,
      count: records.length,
      total: Number(total.toFixed(2)),
      records: recordsWithNumbers,
    }, { status: 200 });
    
  } catch (error: any) {
    console.error("[ADS-SPEND] GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch ad spend", details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/ads-spend
 * Create or update (upsert) a daily ad spend record
 * Body: { date: "YYYY-MM-DD", amountChf: number, channel?: string, notes?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { date, amountChf, channel, notes } = body;
    
    if (!date) {
      return NextResponse.json(
        { error: "Missing required field: date" },
        { status: 400 }
      );
    }
    
    if (amountChf === undefined || amountChf === null) {
      return NextResponse.json(
        { error: "Missing required field: amountChf" },
        { status: 400 }
      );
    }
    
    const dateObj = parseYmdUtc(date);
    if (!dateObj || isNaN(dateObj.getTime())) {
      return NextResponse.json(
        { error: "Invalid date format. Use YYYY-MM-DD" },
        { status: 400 }
      );
    }
    
    const amount = parseFloat(amountChf);
    if (isNaN(amount) || amount < 0) {
      return NextResponse.json(
        { error: "Invalid amountChf. Must be a positive number" },
        { status: 400 }
      );
    }
    
    const record = await prisma.dailyAdSpend.upsert({
      where: { date: dateObj },
      update: {
        amountChf: amount,
        channel: channel || "google",
        notes: notes || null,
        updatedAt: new Date(),
      },
      create: {
        date: dateObj,
        amountChf: amount,
        channel: channel || "google",
        notes: notes || null,
      },
    });
    
    console.log(`[ADS-SPEND] Upserted: ${date} = CHF ${amount}`);
    
    return NextResponse.json({
      success: true,
      record: {
        ...record,
        amountChf: toNumberSafe(record.amountChf, 0),
        date: record.date.toISOString().split('T')[0],
      },
    }, { status: 200 });
    
  } catch (error: any) {
    console.error("[ADS-SPEND] POST error:", error);
    return NextResponse.json(
      { error: "Failed to save ad spend", details: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/ads-spend?date=YYYY-MM-DD
 * Delete a daily ad spend record
 */
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const dateStr = searchParams.get("date");
    
    if (!dateStr) {
      return NextResponse.json(
        { error: "Missing required parameter: date" },
        { status: 400 }
      );
    }
    
    const start = parseYmdUtc(dateStr);
    if (!start || isNaN(start.getTime())) {
      return NextResponse.json(
        { error: "Invalid date format. Use YYYY-MM-DD" },
        { status: 400 }
      );
    }
    
    const dayStart = start;
    const dayEnd = new Date(start);
    dayEnd.setUTCHours(23, 59, 59, 999);
    
    // Use deleteMany for idempotent delete, inclusive day range to avoid TZ offsets
    const altStart = new Date(dateStr);
    const altValid = !isNaN(altStart.getTime());
    if (altValid) {
      altStart.setHours(0, 0, 0, 0);
    }
    const altEnd = altValid ? new Date(altStart.getTime()) : null;
    if (altEnd) altEnd.setHours(23, 59, 59, 999);

    const result = await prisma.dailyAdSpend.deleteMany({
      where: {
        OR: [
          {
            date: {
              gte: dayStart,
              lte: dayEnd,
            },
          },
          altValid && altEnd
            ? {
                date: {
                  gte: altStart,
                  lte: altEnd,
                },
              }
            : undefined,
        ].filter(Boolean) as any[],
      },
    });
    
    const deletedCount = result.count;
    console.log(`[ADS-SPEND] Deleted ${deletedCount} record(s) for ${dateStr}`);
    
    return NextResponse.json({
      success: true,
      deletedCount,
      message: deletedCount > 0 
        ? `Ad spend for ${dateStr} deleted` 
        : `No ad spend record found for ${dateStr} (already deleted)`,
    }, { status: 200 });
    
  } catch (error: any) {
    console.error("[ADS-SPEND] DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to delete ad spend", details: error.message },
      { status: 500 }
    );
  }
}

