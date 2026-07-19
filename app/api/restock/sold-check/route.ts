import { NextResponse } from "next/server";
import { runShopifySoldCheck } from "@/shopify/restock/soldCheckCron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/restock/sold-check — Phase 3 cron (call every ~2 days).
 * Query params:
 *   dryRun=1  force dry-run regardless of SHOPIFY_RESTOCK_DRY_RUN
 *   limit=N   cap the number of listings checked
 */
async function handle(request: Request) {
  const { searchParams } = new URL(request.url);
  const dryRunParam = searchParams.get("dryRun");
  const dryRun = dryRunParam === "1" ? true : dryRunParam === "0" ? false : undefined;
  const limitRaw = Number(searchParams.get("limit") ?? "");
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.trunc(limitRaw) : undefined;

  const result = await runShopifySoldCheck({
    dryRun,
    limit,
    origin: new URL(request.url).origin,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET(request: Request) {
  try {
    return await handle(request);
  } catch (error: any) {
    console.error("[RESTOCK][SOLD_CHECK]", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Sold check failed" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  return GET(request);
}
