import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { toNumberSafe } from "@/app/utils/numbers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHANNELS = ["SHOPIFY", "GALAXUS", "DECATHLON"] as const;
type MarketplaceChannel = (typeof CHANNELS)[number];

function normalizeChannel(value: string | null | undefined): MarketplaceChannel | null {
  if (!value) return null;
  const upper = value.trim().toUpperCase();
  return CHANNELS.includes(upper as MarketplaceChannel) ? (upper as MarketplaceChannel) : null;
}

export async function GET() {
  const items = await prisma.marketplaceCashAssumption.findMany({
    orderBy: [{ channel: "asc" }, { activeFrom: "desc" }],
  });
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    const channel = normalizeChannel(payload?.channel);
    if (!channel) {
      return NextResponse.json(
        { error: "Invalid channel. Use SHOPIFY, GALAXUS, or DECATHLON." },
        { status: 400 }
      );
    }

    const lagDays = Math.max(Number(payload?.lagDays ?? 0), 0);
    const feePercent =
      payload?.feePercent === null || payload?.feePercent === undefined
        ? null
        : toNumberSafe(payload.feePercent, 0);
    const feeFlatChf =
      payload?.feeFlatChf === null || payload?.feeFlatChf === undefined
        ? null
        : toNumberSafe(payload.feeFlatChf, 0);

    const activeFrom = payload?.activeFrom ? new Date(payload.activeFrom) : new Date();
    if (isNaN(activeFrom.getTime())) {
      return NextResponse.json(
        { error: "Invalid activeFrom date." },
        { status: 400 }
      );
    }

    const activeTo = payload?.activeTo ? new Date(payload.activeTo) : null;
    if (activeTo && isNaN(activeTo.getTime())) {
      return NextResponse.json(
        { error: "Invalid activeTo date." },
        { status: 400 }
      );
    }

    const created = await prisma.marketplaceCashAssumption.create({
      data: {
        channel,
        lagDays,
        feePercent,
        feeFlatChf,
        activeFrom,
        activeTo,
        notes: payload?.notes?.toString() || null,
      },
    });

    return NextResponse.json({ item: created });
  } catch (error: any) {
    console.error("[CASHFLOW/ASSUMPTIONS] Error:", error);
    return NextResponse.json(
      { error: "Failed to create assumption", details: error.message },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const payload = await req.json();
    const id = payload?.id?.toString();
    if (!id) {
      return NextResponse.json({ error: "Missing id." }, { status: 400 });
    }

    const channel = normalizeChannel(payload?.channel);
    if (!channel) {
      return NextResponse.json(
        { error: "Invalid channel. Use SHOPIFY, GALAXUS, or DECATHLON." },
        { status: 400 }
      );
    }

    const lagDays = Math.max(Number(payload?.lagDays ?? 0), 0);
    const feePercent =
      payload?.feePercent === null || payload?.feePercent === undefined
        ? null
        : toNumberSafe(payload.feePercent, 0);
    const feeFlatChf =
      payload?.feeFlatChf === null || payload?.feeFlatChf === undefined
        ? null
        : toNumberSafe(payload.feeFlatChf, 0);

    const activeFrom = payload?.activeFrom ? new Date(payload.activeFrom) : new Date();
    if (isNaN(activeFrom.getTime())) {
      return NextResponse.json(
        { error: "Invalid activeFrom date." },
        { status: 400 }
      );
    }

    const activeTo = payload?.activeTo ? new Date(payload.activeTo) : null;
    if (activeTo && isNaN(activeTo.getTime())) {
      return NextResponse.json(
        { error: "Invalid activeTo date." },
        { status: 400 }
      );
    }

    const updated = await prisma.marketplaceCashAssumption.update({
      where: { id },
      data: {
        channel,
        lagDays,
        feePercent,
        feeFlatChf,
        activeFrom,
        activeTo,
        notes: payload?.notes?.toString() || null,
      },
    });

    return NextResponse.json({ item: updated });
  } catch (error: any) {
    console.error("[CASHFLOW/ASSUMPTIONS] Update error:", error);
    return NextResponse.json(
      { error: "Failed to update assumption", details: error.message },
      { status: 500 }
    );
  }
}
