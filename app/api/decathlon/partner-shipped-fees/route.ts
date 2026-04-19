import { NextResponse } from "next/server";
import { computeDecathlonPartnerShippedMetrics } from "@/galaxus/partners/decathlonShippedMetrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin / internal: aggregate shipped Mirakl revenue vs partner catalog buy (NER excluded). */
export async function GET() {
  try {
    const data = await computeDecathlonPartnerShippedMetrics({ onlyPartnerKey: null, maxRows: 25000 });
    return NextResponse.json({
      ok: true,
      currency: data.currency,
      decathlonShippedChf: data.decathlonShippedChf,
      partnerCatalogChf: data.partnerCatalogChf,
      spreadChf: data.spreadChf,
      shippedLineCount: data.shippedLineCount,
      byPartner: data.byPartner,
      note:
        "Reference only: Decathlon line unitPrice × shipped qty vs SupplierVariant.price from partner feed. NER excluded.",
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to compute partner fees" },
      { status: 500 }
    );
  }
}
