import { NextRequest, NextResponse } from "next/server";
import { runEdiInPipeline } from "@/galaxus/ops/orderPipeline";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Optional VPS / cron hardening:
 * - Set `GALAXUS_EDI_POLL_API_KEY` → caller must send header `x-galaxus-edi-poll-key` with the same value.
 * - Optionally set `GALAXUS_EDI_POLL_PARTNER_KEY` (e.g. `NER`) → caller must also send `x-partner-key`
 *   matching that partner code (same normalization as elsewhere).
 * If `GALAXUS_EDI_POLL_API_KEY` is unset, the route stays open (legacy behaviour).
 */
function authorizeGalaxusEdiPoll(req: NextRequest): NextResponse | null {
  const apiKey = process.env.GALAXUS_EDI_POLL_API_KEY?.trim();
  if (!apiKey) return null;

  const provided = req.headers.get("x-galaxus-edi-poll-key")?.trim();
  if (provided !== apiKey) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const partnerGate = process.env.GALAXUS_EDI_POLL_PARTNER_KEY?.trim();
  if (partnerGate) {
    const expected = normalizeProviderKey(partnerGate);
    const fromHeader = normalizeProviderKey(req.headers.get("x-partner-key"));
    if (!expected || fromHeader !== expected) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
  }

  return null;
}

export async function POST(request: NextRequest) {
  const denied = authorizeGalaxusEdiPoll(request);
  if (denied) return denied;

  try {
    const pipeline = await runEdiInPipeline();
    return NextResponse.json({ ok: true, pipeline });
  } catch (error: any) {
    console.error("[GALAXUS][EDI][POLL] Failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
