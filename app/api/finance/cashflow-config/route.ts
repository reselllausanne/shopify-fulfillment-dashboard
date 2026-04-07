import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@prisma/client";
import { toNumberSafe } from "@/app/utils/numbers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    let config = await prisma.cashFlowConfig.findFirst({
      orderBy: { updatedAt: "desc" },
    });
    if (!config) {
      config = await prisma.cashFlowConfig.create({
        data: {
          initialBalanceChf: new Prisma.Decimal(0),
          currencyCode: "CHF",
        },
      });
    }
    return NextResponse.json({ success: true, config });
  } catch (error: any) {
    console.error("[FINANCE][CASHFLOW_CONFIG] GET:", error);
    return NextResponse.json(
      { error: "Failed to load cashflow config", details: error.message },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const initialBalanceChf = toNumberSafe(body.initialBalanceChf, 0);
    const currencyCode =
      typeof body.currencyCode === "string" && body.currencyCode.trim()
        ? body.currencyCode.trim().toUpperCase()
        : "CHF";

    let config = await prisma.cashFlowConfig.findFirst({
      orderBy: { updatedAt: "desc" },
    });

    if (!config) {
      config = await prisma.cashFlowConfig.create({
        data: {
          initialBalanceChf: new Prisma.Decimal(initialBalanceChf),
          currencyCode,
        },
      });
    } else {
      config = await prisma.cashFlowConfig.update({
        where: { id: config.id },
        data: {
          initialBalanceChf: new Prisma.Decimal(initialBalanceChf),
          currencyCode,
        },
      });
    }

    return NextResponse.json({ success: true, config });
  } catch (error: any) {
    console.error("[FINANCE][CASHFLOW_CONFIG] PUT:", error);
    return NextResponse.json(
      { error: "Failed to update cashflow config", details: error.message },
      { status: 500 }
    );
  }
}
