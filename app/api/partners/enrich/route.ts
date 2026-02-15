import { NextRequest, NextResponse } from "next/server";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { runKickdbEnrich } from "@/galaxus/kickdb/enrichJob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = await getPartnerSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const all = ["1", "true", "yes"].includes((searchParams.get("all") ?? "").toLowerCase());
    const limit = Number(searchParams.get("limit") ?? "50");
    const offset = Number(searchParams.get("offset") ?? "0");
    const debug = searchParams.get("debug") === "1";
    const force = searchParams.get("force") === "1";
    const raw = searchParams.get("raw") === "1";
    const partnerSku = searchParams.get("partnerSku")?.trim() || null;
    const partnerVariantId = searchParams.get("partnerVariantId")?.trim() || null;

    if (all && !partnerSku && !partnerVariantId) {
      const batchSize = 200;
      let currentOffset = 0;
      let totalProcessed = 0;
      let lastBatchCount = 0;
      const collected: any[] = [];
      do {
        const { results } = await runKickdbEnrich({
          limit: batchSize,
          offset: currentOffset,
          debug,
          force,
          raw,
          partnerId: session.partnerId,
        });
        lastBatchCount = results.length;
        totalProcessed += lastBatchCount;
        if (debug) collected.push(...results);
        currentOffset += batchSize;
      } while (lastBatchCount === batchSize);

      return NextResponse.json({
        ok: true,
        mode: "all",
        processed: totalProcessed,
        results: debug ? collected : [],
      });
    }

    const { results } = await runKickdbEnrich({
      limit,
      offset,
      debug,
      force,
      raw,
      partnerId: session.partnerId,
      partnerSku,
      partnerVariantId,
    });

    return NextResponse.json({ ok: true, limit, offset, results });
  } catch (error: any) {
    console.error("[PARTNER][KICKDB][ENRICH] Failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
