import { NextRequest, NextResponse } from "next/server";
import { generateExpectedCashEvents } from "@/app/lib/finance/expected-cash/generate";
import { MarketplaceChannel, OperatingSourceType } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const parseDate = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const from = parseDate(body.from);
    const to = parseDate(body.to);
    const sourceTypes = Array.isArray(body.sourceTypes)
      ? (body.sourceTypes as OperatingSourceType[])
      : undefined;
    const channels = Array.isArray(body.channels)
      ? (body.channels as MarketplaceChannel[])
      : undefined;
    const dryRun = Boolean(body.dryRun);

    const result = await generateExpectedCashEvents({
      from,
      to,
      sourceTypes,
      channels,
      dryRun,
    });

    return NextResponse.json({ success: true, result });
  } catch (error: any) {
    console.error("[FINANCE][EXPECTED_CASH][GENERATE] Error:", error);
    return NextResponse.json(
      { error: "Failed to generate expected cash events", details: error.message },
      { status: 500 }
    );
  }
}
