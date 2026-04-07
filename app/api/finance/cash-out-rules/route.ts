import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@prisma/client";
import { toNumberSafe } from "@/app/utils/numbers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rules = await prisma.cashOutRule.findMany({
      orderBy: [{ category: "asc" }, { cadence: "asc" }],
    });
    return NextResponse.json({ success: true, rules });
  } catch (error: any) {
    console.error("[FINANCE][CASH_OUT_RULES] GET:", error);
    return NextResponse.json(
      { error: "Failed to load cash-out rules", details: error.message },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const category = body.category as Prisma.CashOutRuleCreateInput["category"];
    const cadence = body.cadence as Prisma.CashOutRuleCreateInput["cadence"];
    if (!category || !cadence) {
      return NextResponse.json(
        { error: "category and cadence required" },
        { status: 400 }
      );
    }

    const rule = await prisma.cashOutRule.create({
      data: {
        category,
        cadence,
        amountChf:
          body.amountChf === null || body.amountChf === undefined
            ? null
            : new Prisma.Decimal(toNumberSafe(body.amountChf, 0)),
        dayOfWeek:
          body.dayOfWeek === null || body.dayOfWeek === undefined
            ? null
            : Number(body.dayOfWeek),
        dayOfMonth:
          body.dayOfMonth === null || body.dayOfMonth === undefined
            ? null
            : Number(body.dayOfMonth),
        offsetDays:
          body.offsetDays === null || body.offsetDays === undefined
            ? null
            : Number(body.offsetDays),
        startDate: body.startDate ? new Date(body.startDate) : null,
        endDate: body.endDate ? new Date(body.endDate) : null,
        active: body.active !== false,
        notes: body.notes?.toString() || null,
      },
    });
    return NextResponse.json({ success: true, rule }, { status: 201 });
  } catch (error: any) {
    console.error("[FINANCE][CASH_OUT_RULES] POST:", error);
    return NextResponse.json(
      { error: "Failed to create rule", details: error.message },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const id = body.id?.toString();
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    const data: Prisma.CashOutRuleUpdateInput = {};
    if (body.category) data.category = body.category;
    if (body.cadence) data.cadence = body.cadence;
    if (body.amountChf !== undefined) {
      data.amountChf =
        body.amountChf === null
          ? null
          : new Prisma.Decimal(toNumberSafe(body.amountChf, 0));
    }
    if (body.dayOfWeek !== undefined) {
      data.dayOfWeek = body.dayOfWeek === null ? null : Number(body.dayOfWeek);
    }
    if (body.dayOfMonth !== undefined) {
      data.dayOfMonth = body.dayOfMonth === null ? null : Number(body.dayOfMonth);
    }
    if (body.offsetDays !== undefined) {
      data.offsetDays = body.offsetDays === null ? null : Number(body.offsetDays);
    }
    if (body.startDate !== undefined) {
      data.startDate = body.startDate ? new Date(body.startDate) : null;
    }
    if (body.endDate !== undefined) {
      data.endDate = body.endDate ? new Date(body.endDate) : null;
    }
    if (body.active !== undefined) data.active = Boolean(body.active);
    if (body.notes !== undefined) data.notes = body.notes?.toString() || null;

    const rule = await prisma.cashOutRule.update({ where: { id }, data });
    return NextResponse.json({ success: true, rule });
  } catch (error: any) {
    console.error("[FINANCE][CASH_OUT_RULES] PUT:", error);
    return NextResponse.json(
      { error: "Failed to update rule", details: error.message },
      { status: 500 }
    );
  }
}
