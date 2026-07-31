import { NextRequest, NextResponse } from "next/server";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { createPartnerKeyedCache, getPartnerStatsWithRevalidate } from "@/app/lib/partnerStatsCache";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import { computeDecathlonPartnerFulfilledOrderStats } from "@/galaxus/partners/decathlonPartnerFulfilledTotals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const statsCache = createPartnerKeyedCache<Record<string, unknown>>();

export async function GET(req: NextRequest) {
  try {
    const session = await getPartnerSession(req);
    if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const key = normalizeProviderKey(session.partnerKey);
    if (!key) return NextResponse.json({ ok: false, error: "Partner key missing" }, { status: 400 });

    const { body } = await getPartnerStatsWithRevalidate(statsCache, key, async () => {
      const data = await computeDecathlonPartnerFulfilledOrderStats(key);
      return {
        ok: true,
        variant: key === "NER" ? "ner" : "partner",
        currency: data.currency,
        totalSaleFeedChf: data.totalSellChf,
        shippedLineCount: data.shippedLineCount,
        fulfilledOrderCount: data.fulfilledOrderCount,
        fulfilledPartnerLineUnits: data.fulfilledPartnerLineUnits,
        totalSellChf: data.totalSellChf,
        legacyPayoutOrSellChf: data.totalChf,
      };
    });
    return NextResponse.json(body);
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to load shipped stats" },
      { status: 500 }
    );
  }
}
