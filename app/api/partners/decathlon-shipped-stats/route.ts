import { NextRequest, NextResponse } from "next/server";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import { computeDecathlonPartnerShippedMetrics } from "@/galaxus/partners/decathlonShippedMetrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await getPartnerSession(req);
    if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const key = normalizeProviderKey(session.partnerKey);
    if (!key) return NextResponse.json({ ok: false, error: "Partner key missing" }, { status: 400 });
    if (key.toLowerCase() === "ner") {
      return NextResponse.json({
        ok: true,
        excluded: true,
        currency: "CHF",
        partnerCatalogShippedChf: 0,
        decathlonShippedChf: 0,
        spreadChf: 0,
        shippedLineCount: 0,
      });
    }
    const data = await computeDecathlonPartnerShippedMetrics({ onlyPartnerKey: key, maxRows: 25000 });
    return NextResponse.json({
      ok: true,
      excluded: false,
      currency: data.currency,
      partnerCatalogShippedChf: data.partnerCatalogChf,
      decathlonShippedChf: data.decathlonShippedChf,
      spreadChf: data.spreadChf,
      shippedLineCount: data.shippedLineCount,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to load shipped stats" },
      { status: 500 }
    );
  }
}
