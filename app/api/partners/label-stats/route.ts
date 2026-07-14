import { NextRequest, NextResponse } from "next/server";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import { countPartnerSwissPostLabels } from "@/galaxus/partners/partnerSwissPostLabelStats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/partners/label-stats — Swiss Post labels generated for this partner. */
export async function GET(req: NextRequest) {
  try {
    const session = await getPartnerSession(req);
    if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const key = normalizeProviderKey(session.partnerKey);
    if (!key) return NextResponse.json({ ok: false, error: "Partner key missing" }, { status: 400 });

    const postLabelCount = await countPartnerSwissPostLabels(key);
    return NextResponse.json({ ok: true, postLabelCount });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load label stats";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
