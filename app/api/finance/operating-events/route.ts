import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { MarketplaceChannel, OperatingEventStatus, OperatingEventType, OperatingSourceType } from "@prisma/client";

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
    const eventType = searchParams.get("eventType") as OperatingEventType | null;
    const status = searchParams.get("status") as OperatingEventStatus | null;
    const sourceType = searchParams.get("sourceType") as OperatingSourceType | null;

    const where: any = {};
    if (from || to) {
      where.eventDate = {};
      if (from) where.eventDate.gte = from;
      if (to) where.eventDate.lte = to;
    }
    if (channel) where.channel = channel;
    if (eventType) where.eventType = eventType;
    if (status) where.status = status;
    if (sourceType) where.sourceType = sourceType;

    const items = await prisma.operatingEvent.findMany({
      where,
      orderBy: { eventDate: "desc" },
    });

    return NextResponse.json({ success: true, items });
  } catch (error: any) {
    console.error("[FINANCE][OPERATING] GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch operating events", details: error.message },
      { status: 500 }
    );
  }
}
