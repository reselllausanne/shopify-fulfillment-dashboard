import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { ExpectedCashStatus, ExpectedCashSourceType, FinanceCategory, FinanceDirection, MarketplaceChannel } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const parseDate = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const from = parseDate(searchParams.get("from"));
    const to = parseDate(searchParams.get("to"));
    const channel = searchParams.get("channel") as MarketplaceChannel | null;
    const status = searchParams.get("status") as ExpectedCashStatus | null;
    const sourceType = searchParams.get("sourceType") as ExpectedCashSourceType | null;
    const category = searchParams.get("category") as FinanceCategory | null;
    const direction = searchParams.get("direction") as FinanceDirection | null;

    const where: any = {};
    if (from || to) {
      where.expectedDate = {};
      if (from) where.expectedDate.gte = from;
      if (to) where.expectedDate.lte = to;
    }
    if (channel) where.channel = channel;
    if (status) where.status = status;
    if (sourceType) where.sourceType = sourceType;
    if (category) where.category = category;
    if (direction) where.direction = direction;

    const items = await prisma.expectedCashEvent.findMany({
      where,
      orderBy: { expectedDate: "desc" },
    });

    return NextResponse.json({ success: true, items });
  } catch (error: any) {
    console.error("[FINANCE][EXPECTED_CASH] GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch expected cash events", details: error.message },
      { status: 500 }
    );
  }
}
