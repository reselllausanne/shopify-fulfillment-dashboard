import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { toNumberSafe } from "@/app/utils/numbers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHANNELS = ["SHOPIFY", "GALAXUS", "DECATHLON"] as const;
type ChannelKey = (typeof CHANNELS)[number];

type ForecastMode = "AUTO" | "MANUAL" | "HYBRID";

const DEFAULT_MODE: ForecastMode = "HYBRID";

function normalizeChannel(value: string | null | undefined): ChannelKey | null {
  if (!value) return null;
  const upper = value.trim().toUpperCase();
  return CHANNELS.includes(upper as ChannelKey) ? (upper as ChannelKey) : null;
}

function normalizeMode(value: string | null | undefined): ForecastMode {
  const upper = value?.toString().toUpperCase() ?? DEFAULT_MODE;
  if (upper === "AUTO" || upper === "MANUAL" || upper === "HYBRID") {
    return upper;
  }
  return DEFAULT_MODE;
}

function serialize(row: any) {
  return {
    ...row,
    expectedDailySales: toNumberSafe(row.expectedDailySales, 0),
    expectedDailyOrders: row.expectedDailyOrders ?? null,
    growthRatePct: toNumberSafe(row.growthRatePct, 0),
    payoutDelayDays:
      row.payoutDelayDays === null || row.payoutDelayDays === undefined
        ? null
        : toNumberSafe(row.payoutDelayDays, 0),
    commissionRatePct: toNumberSafe(row.commissionRatePct, 0),
    refundRatePct: toNumberSafe(row.refundRatePct, 0),
  };
}

async function ensureDefaults() {
  const existing = await prisma.forecastAssumption.findMany();
  const existingChannels = new Set(existing.map((row) => row.channel));

  const missing = CHANNELS.filter((channel) => !existingChannels.has(channel));
  if (!missing.length) return existing;

  await prisma.forecastAssumption.createMany({
    data: missing.map((channel) => ({
      channel,
      mode: DEFAULT_MODE,
      expectedDailySales: 0,
    })),
  });

  return prisma.forecastAssumption.findMany();
}

export async function GET() {
  const rows = await ensureDefaults();
  const items = rows
    .sort((a, b) => a.channel.localeCompare(b.channel))
    .map(serialize);
  return NextResponse.json({ items });
}

export async function PUT(req: NextRequest) {
  try {
    const payload = await req.json().catch(() => ({}));
    const items = Array.isArray(payload?.items) ? payload.items : [payload];
    const updates = [];

    for (const item of items) {
      const channel = normalizeChannel(item?.channel);
      if (!channel) continue;
      updates.push(
        prisma.forecastAssumption.upsert({
          where: { channel },
          create: {
            channel,
            mode: normalizeMode(item?.mode),
            expectedDailySales: toNumberSafe(item?.expectedDailySales, 0),
            expectedDailyOrders: item?.expectedDailyOrders ?? null,
            growthRatePct:
              item?.growthRatePct === null || item?.growthRatePct === undefined
                ? null
                : toNumberSafe(item?.growthRatePct, 0),
            payoutDelayDays:
              item?.payoutDelayDays === null || item?.payoutDelayDays === undefined
                ? null
                : toNumberSafe(item?.payoutDelayDays, 0),
            commissionRatePct:
              item?.commissionRatePct === null || item?.commissionRatePct === undefined
                ? null
                : toNumberSafe(item?.commissionRatePct, 0),
            refundRatePct:
              item?.refundRatePct === null || item?.refundRatePct === undefined
                ? null
                : toNumberSafe(item?.refundRatePct, 0),
          },
          update: {
            mode: normalizeMode(item?.mode),
            expectedDailySales: toNumberSafe(item?.expectedDailySales, 0),
            expectedDailyOrders: item?.expectedDailyOrders ?? null,
            growthRatePct:
              item?.growthRatePct === null || item?.growthRatePct === undefined
                ? null
                : toNumberSafe(item?.growthRatePct, 0),
            payoutDelayDays:
              item?.payoutDelayDays === null || item?.payoutDelayDays === undefined
                ? null
                : toNumberSafe(item?.payoutDelayDays, 0),
            commissionRatePct:
              item?.commissionRatePct === null || item?.commissionRatePct === undefined
                ? null
                : toNumberSafe(item?.commissionRatePct, 0),
            refundRatePct:
              item?.refundRatePct === null || item?.refundRatePct === undefined
                ? null
                : toNumberSafe(item?.refundRatePct, 0),
          },
        })
      );
    }

    await Promise.all(updates);
    const refreshed = await prisma.forecastAssumption.findMany();
    const itemsResponse = refreshed
      .sort((a, b) => a.channel.localeCompare(b.channel))
      .map(serialize);
    return NextResponse.json({ items: itemsResponse });
  } catch (error: any) {
    console.error("[CASHFLOW/ASSUMPTIONS] Error:", error);
    return NextResponse.json(
      { error: "Failed to update assumptions", details: error.message },
      { status: 500 }
    );
  }
}
