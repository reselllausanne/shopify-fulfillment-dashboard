import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { ManualEventSourceType, Prisma } from "@prisma/client";
import { toNumberSafe } from "@/app/utils/numbers";
import {
  getRunDateForMonth,
  parseYmdUtc,
  recurringMarker,
  toUtcDateOnly,
} from "@/app/lib/recurring-schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/recurring-expenses/backfill
 * Body: { from: "YYYY-MM-DD", to: "YYYY-MM-DD", id?: recurring template id, dryRun?: boolean }
 * Creates PersonalExpense rows (with [RECURRING:id] marker) and syncs ManualFinanceEvent for past dates.
 * Does not change nextRunDate / lastRunAt on the template.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { id, from, to, dryRun } = body;

    if (!from || !to) {
      return NextResponse.json({ error: "Missing required fields: from, to" }, { status: 400 });
    }

    const fromBound = parseYmdUtc(from);
    const toBound = parseYmdUtc(to);
    if (!fromBound || !toBound) {
      return NextResponse.json({ error: "Invalid from/to. Use YYYY-MM-DD" }, { status: 400 });
    }
    if (fromBound > toBound) {
      return NextResponse.json({ error: "from must be on or before to" }, { status: 400 });
    }

    const items = id
      ? await prisma.recurringExpense.findMany({ where: { id } })
      : await prisma.recurringExpense.findMany();

    if (id && !items.length) {
      return NextResponse.json({ error: "Recurring expense not found" }, { status: 404 });
    }

    let createdExpenses = 0;
    let upsertedManual = 0;
    let skippedExistingExpense = 0;

    for (const item of items) {
      const start = toUtcDateOnly(item.startDate);
      const end = item.endDate ? toUtcDateOnly(item.endDate) : null;
      const interval = Math.max(Number(item.intervalMonths) || 1, 1);
      const dayOfMonth = Number(item.dayOfMonth) || 1;
      const startMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
      const fromMonth = new Date(Date.UTC(fromBound.getUTCFullYear(), fromBound.getUTCMonth(), 1));
      const toMonth = new Date(Date.UTC(toBound.getUTCFullYear(), toBound.getUTCMonth(), 1));

      const marker = recurringMarker(item.id);

      for (
        let cursor = new Date(fromMonth);
        cursor <= toMonth;
        cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))
      ) {
        const monthsDiff =
          (cursor.getUTCFullYear() - startMonth.getUTCFullYear()) * 12 +
          (cursor.getUTCMonth() - startMonth.getUTCMonth());
        if (monthsDiff < 0 || monthsDiff % interval !== 0) continue;

        const runDate = getRunDateForMonth(cursor.getUTCFullYear(), cursor.getUTCMonth(), dayOfMonth);
        if (runDate < start) continue;
        if (end && runDate > end) continue;
        if (runDate < fromBound || runDate > toBound) continue;

        if (dryRun) {
          const existing = await prisma.personalExpense.findFirst({
            where: { date: runDate, note: { contains: marker } },
          });
          if (!existing) createdExpenses += 1;
          upsertedManual += 1;
          continue;
        }

        const existing = await prisma.personalExpense.findFirst({
          where: { date: runDate, note: { contains: marker } },
        });

        if (!existing) {
          await prisma.personalExpense.create({
            data: {
              date: runDate,
              amount: new Prisma.Decimal(toNumberSafe(item.amount, 0)),
              currencyCode: item.currencyCode,
              categoryId: item.categoryId,
              accountId: item.accountId,
              note: `${marker} ${item.name}`.trim(),
              isBusiness: item.isBusiness,
            },
          });
          createdExpenses += 1;
        } else {
          skippedExistingExpense += 1;
        }

        await prisma.manualFinanceEvent.upsert({
          where: {
            sourceType_sourceId_eventDate: {
              sourceType: ManualEventSourceType.RECURRING,
              sourceId: item.id,
              eventDate: runDate,
            },
          },
          update: {
            amount: new Prisma.Decimal(toNumberSafe(item.amount, 0)),
            currencyCode: item.currencyCode,
            direction: "OUT",
            category: "OTHER",
            expenseCategoryId: item.categoryId,
            description: item.name,
          },
          create: {
            eventDate: runDate,
            amount: new Prisma.Decimal(toNumberSafe(item.amount, 0)),
            currencyCode: item.currencyCode,
            direction: "OUT",
            category: "OTHER",
            expenseCategoryId: item.categoryId,
            sourceType: ManualEventSourceType.RECURRING,
            sourceId: item.id,
            description: item.name,
          },
        });
        upsertedManual += 1;
      }
    }

    return NextResponse.json({
      success: true,
      dryRun: !!dryRun,
      createdExpenses,
      upsertedManualEvents: upsertedManual,
      skippedExistingExpense: dryRun ? undefined : skippedExistingExpense,
    });
  } catch (error: any) {
    console.error("[RECURRING/BACKFILL] Error:", error);
    return NextResponse.json(
      { error: "Failed to backfill recurring expenses", details: error.message },
      { status: 500 }
    );
  }
}
