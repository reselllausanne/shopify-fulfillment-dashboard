import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@prisma/client";
import { toNumberSafe } from "@/app/utils/numbers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHANNELS = ["SHOPIFY", "GALAXUS", "DECATHLON"] as const;

export async function GET() {
  try {
    const rules = await prisma.cashInRule.findMany({
      orderBy: [{ priority: "desc" }, { channel: "asc" }],
    });
    return NextResponse.json({ success: true, rules });
  } catch (error: any) {
    console.error("[FINANCE][CASH_IN_RULES] GET:", error);
    return NextResponse.json(
      { error: "Failed to load cash-in rules", details: error.message },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const channel = String(body.channel || "").toUpperCase();
    if (!CHANNELS.includes(channel as any)) {
      return NextResponse.json({ error: "Invalid channel" }, { status: 400 });
    }
    const delayType = body.delayType as Prisma.CashInRuleCreateInput["delayType"];
    if (!delayType) {
      return NextResponse.json({ error: "delayType required" }, { status: 400 });
    }

    const rule = await prisma.cashInRule.create({
      data: {
        channel: channel as (typeof CHANNELS)[number],
        paymentMethod: body.paymentMethod?.toString().trim() || null,
        delayType,
        delayValueDays:
          body.delayValueDays === null || body.delayValueDays === undefined
            ? null
            : new Prisma.Decimal(toNumberSafe(body.delayValueDays, 0)),
        priority: Math.max(0, Number(body.priority) || 100),
        active: body.active !== false,
        notes: body.notes?.toString() || null,
      },
    });
    return NextResponse.json({ success: true, rule }, { status: 201 });
  } catch (error: any) {
    console.error("[FINANCE][CASH_IN_RULES] POST:", error);
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

    const data: Prisma.CashInRuleUpdateInput = {};
    if (body.channel) {
      const channel = String(body.channel).toUpperCase();
      if (!CHANNELS.includes(channel as any)) {
        return NextResponse.json({ error: "Invalid channel" }, { status: 400 });
      }
      data.channel = channel as (typeof CHANNELS)[number];
    }
    if (body.paymentMethod !== undefined) {
      data.paymentMethod = body.paymentMethod?.toString().trim() || null;
    }
    if (body.delayType) data.delayType = body.delayType;
    if (body.delayValueDays !== undefined) {
      data.delayValueDays =
        body.delayValueDays === null
          ? null
          : new Prisma.Decimal(toNumberSafe(body.delayValueDays, 0));
    }
    if (body.priority !== undefined) data.priority = Math.max(0, Number(body.priority) || 100);
    if (body.active !== undefined) data.active = Boolean(body.active);
    if (body.notes !== undefined) data.notes = body.notes?.toString() || null;

    const rule = await prisma.cashInRule.update({ where: { id }, data });
    return NextResponse.json({ success: true, rule });
  } catch (error: any) {
    console.error("[FINANCE][CASH_IN_RULES] PUT:", error);
    return NextResponse.json(
      { error: "Failed to update rule", details: error.message },
      { status: 500 }
    );
  }
}
