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

function parseDateParam(value: string, endOfDay: boolean) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [yearRaw, monthRaw, dayRaw] = value.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!year || !month || !day) return null;
  return new Date(
    Date.UTC(
      year,
      month - 1,
      day,
      endOfDay ? 23 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 999 : 0
    )
  );
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const channel = normalizeChannel(searchParams.get("channel"));
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");

  const where: { channel?: MarketplaceChannel; paidAt?: { gte?: Date; lte?: Date } } = {};
  if (channel) {
    where.channel = channel;
  }

  if (fromParam) {
    const parsed = parseDateParam(fromParam, false);
    if (!parsed) {
      return NextResponse.json(
        { error: "Invalid from parameter. Use YYYY-MM-DD." },
        { status: 400 }
      );
    }
    where.paidAt = { ...(where.paidAt || {}), gte: parsed };
  }

  if (toParam) {
    const parsed = parseDateParam(toParam, true);
    if (!parsed) {
      return NextResponse.json(
        { error: "Invalid to parameter. Use YYYY-MM-DD." },
        { status: 400 }
      );
    }
    where.paidAt = { ...(where.paidAt || {}), lte: parsed };
  }

  const items = await prisma.marketplaceRemittance.findMany({
    where,
    orderBy: { paidAt: "desc" },
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

    const paidAt = payload?.paidAt ? new Date(payload.paidAt) : null;
    if (!paidAt || isNaN(paidAt.getTime())) {
      return NextResponse.json({ error: "Invalid paidAt date." }, { status: 400 });
    }

    const amountChf = toNumberSafe(payload?.amountChf ?? payload?.amount, 0);
    if (!amountChf) {
      return NextResponse.json({ error: "amountChf is required." }, { status: 400 });
    }

    const created = await prisma.marketplaceRemittance.create({
      data: {
        channel,
        paidAt,
        amountChf,
        currencyCode: payload?.currencyCode?.toString() || "CHF",
        reference: payload?.reference?.toString() || null,
        sourceFile: payload?.sourceFile?.toString() || null,
      },
    });

    return NextResponse.json({ item: created });
  } catch (error: any) {
    console.error("[CASHFLOW/REMITTANCES] Error:", error);
    return NextResponse.json(
      { error: "Failed to create remittance", details: error.message },
      { status: 500 }
    );
  }
}
