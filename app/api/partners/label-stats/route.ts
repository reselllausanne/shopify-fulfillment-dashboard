import { NextRequest, NextResponse } from "next/server";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { createPartnerKeyedCache } from "@/app/lib/partnerStatsCache";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import { countPartnerSwissPostLabels } from "@/galaxus/partners/partnerSwissPostLabelStats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const statsCache = createPartnerKeyedCache<Record<string, unknown>>();

/** GET /api/partners/label-stats — Swiss Post labels generated for this partner. */
export async function GET(req: NextRequest) {
  try {
    const session = await getPartnerSession(req);
    if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const key = normalizeProviderKey(session.partnerKey);
    if (!key) return NextResponse.json({ ok: false, error: "Partner key missing" }, { status: 400 });

    const cached = statsCache.get(key);
    if (cached) return NextResponse.json(cached);

    const postLabelCount = await countPartnerSwissPostLabels(key);
    const body = { ok: true, postLabelCount };
    statsCache.set(key, body);
    return NextResponse.json(body);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load label stats";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
