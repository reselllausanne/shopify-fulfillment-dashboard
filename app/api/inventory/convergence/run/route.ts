import { NextResponse } from "next/server";
import { checkSharedSecret } from "@/app/api/kickdb/auth";
import { convergeAll, convergeVariant } from "@/shopify/inventory/convergence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

/**
 * POST /api/inventory/convergence/run
 *
 * Phase 4 convergence trigger. Idempotent. Called by the 15-min VPS cron.
 * Optional single-GTIN override for the Shopify order webhook / marketplace
 * sale hook.
 *
 * Body (optional): { gtin?: string, sampleSize?: number }
 * Query alternative: ?gtin=... (for easy manual curl)
 */
export async function POST(req: Request) {
  const authError = checkSharedSecret(req);
  if (authError) return authError;

  const url = new URL(req.url);
  const gtinFromQs = (url.searchParams.get("gtin") ?? "").trim();

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const gtin = String(body?.gtin ?? gtinFromQs ?? "").trim();

  try {
    if (gtin) {
      const res = await convergeVariant(gtin);
      return NextResponse.json({ ok: !res.error, mode: "single", result: res });
    }
    const sampleSize = Number.isFinite(Number(body?.sampleSize)) ? Number(body.sampleSize) : undefined;
    const res = await convergeAll({ sampleSize });
    return NextResponse.json({ mode: "all", ...res });
  } catch (err: any) {
    console.error("[convergence/run] error", err);
    return NextResponse.json({ ok: false, error: err?.message ?? "convergence_failed" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "POST /api/inventory/convergence/run",
    body: "{ gtin?, sampleSize? }",
  });
}
