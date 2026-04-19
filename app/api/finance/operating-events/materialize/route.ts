import { NextRequest, NextResponse } from "next/server";
import { materializeOperatingEvents } from "@/app/lib/finance/operating-events/materialize";
import { OperatingSourceType } from "@prisma/client";

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
    const dryRun = Boolean(body.dryRun);

    const result = await materializeOperatingEvents({
      from,
      to,
      sourceTypes,
      dryRun,
    });

    return NextResponse.json({ success: true, result });
  } catch (error: any) {
    console.error("[FINANCE][OPERATING][MATERIALIZE] Error:", error);
    return NextResponse.json(
      { error: "Failed to materialize operating events", details: error.message },
      { status: 500 }
    );
  }
}
