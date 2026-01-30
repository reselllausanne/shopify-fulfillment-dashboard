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
    for (const item of items) {
      const runDate = item.nextRunDate;
      const marker = `[RECURRING:${item.id}]`;

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

      // Compute next run date based on interval
      const nextMonthIndex = item.nextRunDate.getUTCMonth() + item.intervalMonths;
      const nextYear = item.nextRunDate.getUTCFullYear() + Math.floor(nextMonthIndex / 12);
      const nextMonth = nextMonthIndex % 12;
      const nextRunDate = getRunDateForMonth(nextYear, nextMonth, item.dayOfMonth);

      await prisma.recurringExpense.update({
        where: { id: item.id },
        data: {
          lastRunAt: new Date(),
          nextRunDate,
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

