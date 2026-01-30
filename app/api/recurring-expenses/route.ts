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

const computeNextRunDate = (startDate: Date, dayOfMonth: number, intervalMonths: number) => {
  const now = toUtcDateOnly(new Date());
  const ref = startDate > now ? startDate : now;
  let year = startDate.getUTCFullYear();
  let month = startDate.getUTCMonth();

  for (let i = 0; i < 240; i++) {
    const run = getRunDateForMonth(year, month, dayOfMonth);
    if (run >= ref) return run;
    month += intervalMonths;
    year += Math.floor(month / 12);
    month = month % 12;
  }

  return getRunDateForMonth(now.getUTCFullYear(), now.getUTCMonth(), dayOfMonth);
};

export async function GET() {
  try {
    const items = await prisma.recurringExpense.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        category: true,
        account: true,
      },
    });

    const rows = items.map((i: (typeof items)[number]) => ({
      id: i.id,
      name: i.name,
      amount: toNumberSafe(i.amount, 0),
      currencyCode: i.currencyCode,
      categoryId: i.categoryId,
      categoryName: i.category?.name || null,
      accountId: i.accountId,
      accountName: i.account?.name || null,
      isBusiness: i.isBusiness,
      dayOfMonth: i.dayOfMonth,
      intervalMonths: i.intervalMonths,
      startDate: i.startDate,
      nextRunDate: i.nextRunDate,
      lastRunAt: i.lastRunAt,
      active: i.active,
      note: i.note,
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
    }));

    return NextResponse.json({ success: true, items: rows });
  } catch (error: any) {
    console.error("[RECURRING] GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch recurring expenses", details: error.message },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      name,
      amount,
      currencyCode,
      categoryId,
      accountId,
      isBusiness,
      dayOfMonth,
      intervalMonths,
      startDate,
      note,
    } = body;

    if (!name || !amount || !categoryId || !accountId) {
      return NextResponse.json(
        { error: "Missing required fields: name, amount, categoryId, accountId" },
        { status: 400 }
      );
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return NextResponse.json(
        { error: "Amount must be a positive number" },
        { status: 400 }
      );
    }

    const start = startDate ? new Date(startDate) : new Date();
    if (isNaN(start.getTime())) {
      return NextResponse.json({ error: "Invalid startDate" }, { status: 400 });
    }

    const dom = Number(dayOfMonth) || 1;
    const interval = Number(intervalMonths) || 1;
    const nextRunDate = computeNextRunDate(toUtcDateOnly(start), dom, interval);

    const created = await prisma.recurringExpense.create({
      data: {
        name,
        amount: new Prisma.Decimal(amountNum),
        currencyCode: currencyCode || "CHF",
        categoryId,
        accountId,
        isBusiness: !!isBusiness,
        dayOfMonth: dom,
        intervalMonths: interval,
        startDate: toUtcDateOnly(start),
        nextRunDate,
        note: note || null,
      },
    });

    return NextResponse.json({ success: true, item: created }, { status: 201 });
  } catch (error: any) {
    console.error("[RECURRING] POST error:", error);
    return NextResponse.json(
      { error: "Failed to create recurring expense", details: error.message },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { id } = body;
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    const update: any = {};
    if (body.name) update.name = body.name;
    if (body.amount !== undefined) {
      const amountNum = parseFloat(body.amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        return NextResponse.json(
          { error: "Amount must be a positive number" },
          { status: 400 }
        );
      }
      update.amount = new Prisma.Decimal(amountNum);
    }
    if (body.currencyCode) update.currencyCode = body.currencyCode;
    if (body.categoryId) update.categoryId = body.categoryId;
    if (body.accountId) update.accountId = body.accountId;
    if (body.isBusiness !== undefined) update.isBusiness = !!body.isBusiness;
    if (body.dayOfMonth) update.dayOfMonth = Number(body.dayOfMonth);
    if (body.intervalMonths) update.intervalMonths = Number(body.intervalMonths);
    if (body.startDate) {
      const start = new Date(body.startDate);
      if (isNaN(start.getTime())) {
        return NextResponse.json({ error: "Invalid startDate" }, { status: 400 });
      }
      update.startDate = toUtcDateOnly(start);
    }
    if (body.note !== undefined) update.note = body.note || null;
    if (body.active !== undefined) update.active = !!body.active;

    // If timing fields changed, recompute nextRunDate
    if (update.startDate || update.dayOfMonth || update.intervalMonths) {
      const current = await prisma.recurringExpense.findUnique({ where: { id } });
      if (!current) {
        return NextResponse.json({ error: "Recurring expense not found" }, { status: 404 });
      }
      const start = update.startDate || current.startDate;
      const dom = update.dayOfMonth || current.dayOfMonth;
      const interval = update.intervalMonths || current.intervalMonths;
      update.nextRunDate = computeNextRunDate(start, dom, interval);
    }

    const updated = await prisma.recurringExpense.update({
      where: { id },
      data: update,
    });

    return NextResponse.json({ success: true, item: updated });
  } catch (error: any) {
    console.error("[RECURRING] PUT error:", error);
    return NextResponse.json(
      { error: "Failed to update recurring expense", details: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    await prisma.recurringExpense.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[RECURRING] DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to delete recurring expense", details: error.message },
      { status: 500 }
    );
  }
}

