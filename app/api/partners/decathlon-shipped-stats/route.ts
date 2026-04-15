import { NextRequest, NextResponse } from "next/server";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import { computeDecathlonPartnerFulfilledOrderStats } from "@/galaxus/partners/decathlonPartnerFulfilledTotals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await getPartnerSession(req);
    if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const key = normalizeProviderKey(session.partnerKey);
    if (!key) return NextResponse.json({ ok: false, error: "Partner key missing" }, { status: 400 });

    const data = await computeDecathlonPartnerFulfilledOrderStats(key);

    if (key === "NER") {
      return NextResponse.json({
        ok: true,
        variant: "ner_mirakl",
        excluded: false,
        currency: data.currency,
        fulfilledOrderCount: data.fulfilledOrderCount,
        fulfilledPartnerLineUnits: data.fulfilledPartnerLineUnits,
        miraklPayoutChf: data.totalChf,
        miraklPayoutLineMisses: data.miraklPayoutLineMisses,
        catalogShippedExcluded: true,
        partnerCatalogShippedChf: 0,
        shippedLineCount: 0,
      });
    }

    return NextResponse.json({
      ok: true,
      variant: "partner_sell_fulfilled",
      excluded: false,
      currency: data.currency,
      fulfilledOrderCount: data.fulfilledOrderCount,
      fulfilledPartnerLineUnits: data.fulfilledPartnerLineUnits,
      sellTotalChf: data.totalChf,
      catalogShippedExcluded: false,
      partnerCatalogShippedChf: data.partnerCatalogShippedChf,
      shippedLineCount: data.shippedLineCount,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to load shipped stats" },
      { status: 500 }
    );
  }
}
