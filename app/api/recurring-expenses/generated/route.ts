import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { ManualEventSourceType } from "@prisma/client";
import { parseYmdUtc, recurringMarker } from "@/app/lib/recurring-schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/recurring-expenses/generated?recurringId=UUID&from=YYYY-MM-DD&to=YYYY-MM-DD
 * Removes PersonalExpense rows created from a recurring template (note contains [RECURRING:id])
 * and matching ManualFinanceEvent rows. Safe reset before re-backfill.
 */
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const recurringId = searchParams.get("recurringId");
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    if (!recurringId) {
      return NextResponse.json({ error: "Missing required query: recurringId" }, { status: 400 });
    }

    const marker = recurringMarker(recurringId);

    const dateFilter: { gte?: Date; lte?: Date } = {};
    const fromD = parseYmdUtc(from);
    const toD = parseYmdUtc(to);
    if (fromD) dateFilter.gte = fromD;
    if (toD) {
      const end = new Date(toD);
      end.setUTCHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }

    const expenseWhere = {
      note: { contains: marker },
      ...(Object.keys(dateFilter).length ? { date: dateFilter } : {}),
    };

    const manualWhere = {
      sourceType: ManualEventSourceType.RECURRING,
      sourceId: recurringId,
      ...(Object.keys(dateFilter).length ? { eventDate: dateFilter } : {}),
    };

    const [expRes, manRes] = await prisma.$transaction([
      prisma.personalExpense.deleteMany({ where: expenseWhere }),
      prisma.manualFinanceEvent.deleteMany({ where: manualWhere }),
    ]);

    return NextResponse.json({
      success: true,
      deletedPersonalExpenses: expRes.count,
      deletedManualFinanceEvents: manRes.count,
    });
  } catch (error: any) {
    console.error("[RECURRING/GENERATED] DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to delete generated recurring rows", details: error.message },
      { status: 500 }
    );
  }
}
