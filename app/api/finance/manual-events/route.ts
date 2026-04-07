import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { toNumberSafe } from "@/app/utils/numbers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const parseDateParam = (value: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const from = parseDateParam(searchParams.get("from"));
    const to = parseDateParam(searchParams.get("to"));
    const category = searchParams.get("category");
    const bankAccountId = searchParams.get("bankAccountId");

    const where: any = {};
    if (from || to) {
      where.eventDate = {};
      if (from) where.eventDate.gte = from;
      if (to) where.eventDate.lte = to;
    }
    if (category) where.category = category;
    if (bankAccountId) where.bankAccountId = bankAccountId;

    const items = await prisma.manualFinanceEvent.findMany({
      where,
      orderBy: { eventDate: "desc" },
      include: { expenseCategory: true, bankAccount: true },
    });

    return NextResponse.json({ success: true, items });
  } catch (error: any) {
    console.error("[FINANCE][MANUAL] GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch manual finance events", details: error.message },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      eventDate,
      amount,
      currencyCode,
      direction,
      category,
      description,
      expenseCategoryId,
      bankAccountId,
      sourceType,
      sourceId,
      metadataJson,
    } = body;

    if (!eventDate || amount === undefined) {
      return NextResponse.json(
        { error: "Missing required fields: eventDate, amount" },
        { status: 400 }
      );
    }

    const parsedDate = new Date(eventDate);
    if (Number.isNaN(parsedDate.getTime())) {
      return NextResponse.json({ error: "Invalid eventDate" }, { status: 400 });
    }

    const rawAmount = toNumberSafe(amount, 0);
    if (!rawAmount) {
      return NextResponse.json({ error: "Amount must be non-zero" }, { status: 400 });
    }

    const inferredDirection = rawAmount < 0 ? "OUT" : "IN";

    const created = await prisma.manualFinanceEvent.create({
      data: {
        eventDate: parsedDate,
        amount: new Prisma.Decimal(Math.abs(rawAmount)),
        currencyCode: currencyCode || "CHF",
        direction: direction || inferredDirection,
        category: category || "OTHER",
        description: description || null,
        expenseCategoryId: expenseCategoryId || null,
        bankAccountId: bankAccountId || null,
        sourceType: sourceType || "MANUAL",
        sourceId: sourceId || null,
        metadataJson: metadataJson || null,
      },
    });

    return NextResponse.json({ success: true, item: created }, { status: 201 });
  } catch (error: any) {
    console.error("[FINANCE][MANUAL] POST error:", error);
    return NextResponse.json(
      { error: "Failed to create manual finance event", details: error.message },
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
    if (body.eventDate) {
      const parsedDate = new Date(body.eventDate);
      if (Number.isNaN(parsedDate.getTime())) {
        return NextResponse.json({ error: "Invalid eventDate" }, { status: 400 });
      }
      update.eventDate = parsedDate;
    }
    if (body.amount !== undefined) {
      const rawAmount = toNumberSafe(body.amount, 0);
      if (!rawAmount) {
        return NextResponse.json({ error: "Amount must be non-zero" }, { status: 400 });
      }
      update.amount = new Prisma.Decimal(Math.abs(rawAmount));
      update.direction = body.direction || (rawAmount < 0 ? "OUT" : "IN");
    }
    if (body.currencyCode) update.currencyCode = body.currencyCode;
    if (body.direction) update.direction = body.direction;
    if (body.category) update.category = body.category;
    if (body.description !== undefined) update.description = body.description || null;
    if (body.expenseCategoryId !== undefined)
      update.expenseCategoryId = body.expenseCategoryId || null;
    if (body.bankAccountId !== undefined) update.bankAccountId = body.bankAccountId || null;
    if (body.sourceType) update.sourceType = body.sourceType;
    if (body.sourceId !== undefined) update.sourceId = body.sourceId || null;
    if (body.metadataJson !== undefined) update.metadataJson = body.metadataJson || null;

    const updated = await prisma.manualFinanceEvent.update({
      where: { id },
      data: update,
    });

    return NextResponse.json({ success: true, item: updated });
  } catch (error: any) {
    console.error("[FINANCE][MANUAL] PUT error:", error);
    return NextResponse.json(
      { error: "Failed to update manual finance event", details: error.message },
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
    await prisma.manualFinanceEvent.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[FINANCE][MANUAL] DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to delete manual finance event", details: error.message },
      { status: 500 }
    );
  }
}
