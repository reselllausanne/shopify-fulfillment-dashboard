import { NextResponse } from "next/server";
import { syncAllLocations } from "@/shopify/inventory/locationMirror";
import { checkSharedSecret } from "@/app/api/kickdb/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/inventory/locations/sync
 *
 * Mirror Shopify per-location PHYSICAL inventory into
 * ShopifyVariantLocationStock. Read-only against Shopify (never writes stock).
 * Intended for a cron (daily full reconcile). Protected by the shared secret.
 */
export async function POST(req: Request) {
  const authError = checkSharedSecret(req);
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const delayMs = Number(searchParams.get("delayMs") ?? 150);
  const maxPages = Number(searchParams.get("maxPages") ?? 2000);

  try {
    const result = await syncAllLocations({ delayMs, maxPagesPerLocation: maxPages });
    return NextResponse.json(result);
  } catch (e: any) {
    console.error("[inventory/locations/sync] error", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "sync_failed" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "POST /api/inventory/locations/sync" });
}
