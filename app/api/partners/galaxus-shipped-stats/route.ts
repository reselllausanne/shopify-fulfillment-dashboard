import { NextRequest, NextResponse } from "next/server";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import { computeGalaxusPartnerFulfilledOrderStats } from "@/galaxus/partners/galaxusPartnerFulfilledTotals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await getPartnerSession(req);
    if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const key = normalizeProviderKey(session.partnerKey);
    if (!key) return NextResponse.json({ ok: false, error: "Partner key missing" }, { status: 400 });

    const data = await computeGalaxusPartnerFulfilledOrderStats(key);

    return NextResponse.json({
      ok: true,
      currency: data.currency,
      totalSaleFeedChf: data.totalChf,
      fulfilledOrderCount: data.fulfilledOrderCount,
      fulfilledPartnerLineUnits: data.fulfilledPartnerLineUnits,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to load Galaxus shipped stats" },
      { status: 500 }
    );
  }
}
