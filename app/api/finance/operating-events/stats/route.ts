import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  try {
    const [total, byType, bySource, byConfidence, byStatus, lastMaterialized] =
      await Promise.all([
        prisma.operatingEvent.count(),
        prisma.operatingEvent.groupBy({ by: ["eventType"], _count: { _all: true } }),
        prisma.operatingEvent.groupBy({ by: ["sourceType"], _count: { _all: true } }),
        prisma.operatingEvent.groupBy({ by: ["confidence"], _count: { _all: true } }),
        prisma.operatingEvent.groupBy({ by: ["status"], _count: { _all: true } }),
        prisma.operatingEvent.aggregate({ _max: { materializedAt: true } }),
      ]);

    return NextResponse.json({
      success: true,
      total,
      byType,
      bySource,
      byConfidence,
      byStatus,
      lastMaterializedAt: lastMaterialized._max.materializedAt,
    });
  } catch (error: any) {
    console.error("[FINANCE][OPERATING][STATS] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch operating stats", details: error.message },
      { status: 500 }
    );
  }
}
