import { NextResponse } from "next/server";
import { runJob } from "@/galaxus/jobs/jobRunner";
import { runPartnerSync } from "@/galaxus/jobs/partnerSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const all = ["1", "true", "yes"].includes((searchParams.get("all") ?? "").toLowerCase());
    const limit = Math.min(Number(searchParams.get("limit") ?? "500"), 2000);
    const offset = Math.max(Number(searchParams.get("offset") ?? "0"), 0);

    if (all) {
      const batchSize = 1000;
      let currentOffset = 0;
      let totalProcessed = 0;
      let totalCreated = 0;
      let totalUpdated = 0;
      let totalSkipped = 0;
      let totalRemovedZeroStock = 0;
      let lastBatch = 0;
      do {
        const result = await runJob("partners-sync", () =>
          runPartnerSync({ limit: batchSize, offset: currentOffset })
        );
        const payload = result.result ?? {
          processed: 0,
          created: 0,
          updated: 0,
          skippedInvalid: 0,
          removedZeroStock: 0,
        };
        totalProcessed += payload.processed ?? 0;
        totalCreated += payload.created ?? 0;
        totalUpdated += payload.updated ?? 0;
        totalSkipped += payload.skippedInvalid ?? 0;
        totalRemovedZeroStock += payload.removedZeroStock ?? 0;
        lastBatch = payload.processed ?? 0;
        currentOffset += batchSize;
      } while (lastBatch === batchSize);

      return NextResponse.json({
        ok: true,
        mode: "all",
        processed: totalProcessed,
        created: totalCreated,
        updated: totalUpdated,
        skippedInvalid: totalSkipped,
        removedZeroStock: totalRemovedZeroStock,
      });
    }

    const result = await runJob("partners-sync", () => runPartnerSync({ limit, offset }));
    return NextResponse.json({ ok: true, limit, offset, result });
  } catch (error: any) {
    console.error("[GALAXUS][PARTNERS][SYNC] Failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
