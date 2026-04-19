import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@prisma/client";
import { toNumberSafe } from "@/app/utils/numbers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const toUtcDateOnly = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

const getRunDateForMonth = (year: number, monthIndex: number, dayOfMonth: number) => {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const day = Math.min(Math.max(dayOfMonth, 1), lastDay);
  return new Date(Date.UTC(year, monthIndex, day, 0, 0, 0, 0));
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { id } = body;

    const items = id
      ? await prisma.recurringExpense.findMany({ where: { id, active: true } })
      : await prisma.recurringExpense.findMany({
          where: { active: true, nextRunDate: { lte: toUtcDateOnly(new Date()) } },
        });

    if (!items.length) {
      return NextResponse.json({ success: true, created: 0 });
    }

    let created = 0;
    const today = toUtcDateOnly(new Date());

    for (const item of items) {
      let runDate = toUtcDateOnly(item.nextRunDate);
      let ranAny = false;
      let guard = 0;
      const marker = `[RECURRING:${item.id}]`;

      while (runDate <= today) {
        guard += 1;
        if (guard > 240) break;
        if (item.endDate && runDate > item.endDate) break;

        const existing = await prisma.personalExpense.findFirst({
          where: {
            date: runDate,
            note: { contains: marker },
          },
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
          created += 1;
        }

        await prisma.manualFinanceEvent.upsert({
          where: {
            sourceType_sourceId_eventDate: {
              sourceType: "RECURRING",
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
            sourceType: "RECURRING",
            sourceId: item.id,
            description: item.name,
          },
        });

        ranAny = true;

        const nextMonthIndex = runDate.getUTCMonth() + item.intervalMonths;
        const nextYear = runDate.getUTCFullYear() + Math.floor(nextMonthIndex / 12);
        const nextMonth = nextMonthIndex % 12;
        runDate = getRunDateForMonth(nextYear, nextMonth, item.dayOfMonth);
      }

      if (item.endDate && runDate > item.endDate) {
        await prisma.recurringExpense.update({
          where: { id: item.id },
          data: {
            lastRunAt: ranAny ? new Date() : item.lastRunAt,
            nextRunDate: runDate,
            active: false,
          },
        });
        continue;
      }

      await prisma.recurringExpense.update({
        where: { id: item.id },
        data: {
          lastRunAt: ranAny ? new Date() : item.lastRunAt,
          nextRunDate: runDate,
        },
      });
    }

    return NextResponse.json({ success: true, created });
  } catch (error: any) {
    console.error("[RECURRING/RUN] Error:", error);
    return NextResponse.json(
      { error: "Failed to run recurring expenses", details: error.message },
      { status: 500 }
    );
  }
}

