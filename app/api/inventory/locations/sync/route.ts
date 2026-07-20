import { NextResponse } from "next/server";
import { syncAllLocations, syncAllLocationsBulk } from "@/shopify/inventory/locationMirror";
import { checkSharedSecret } from "@/app/api/kickdb/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

/**
 * POST /api/inventory/locations/sync?method=bulk|paginated
 *
 * Mirror Shopify per-location PHYSICAL inventory into
 * ShopifyVariantLocationStock. Read-only against Shopify (never writes stock).
 * Intended for a cron (daily full reconcile). Protected by the shared secret.
 *
 * Default `bulk`: one server-side Bulk Operation export, no throttling, scales
 * regardless of qty-0 level pollution. `paginated`: legacy per-location paging.
 */
export async function POST(req: Request) {
  const authError = checkSharedSecret(req);
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const method = (searchParams.get("method") ?? "bulk").toLowerCase();

  try {
    if (method === "paginated") {
      const delayMs = Number(searchParams.get("delayMs") ?? 700);
      const maxPages = Number(searchParams.get("maxPages") ?? 4000);
      const result = await syncAllLocations({ delayMs, maxPagesPerLocation: maxPages });
      return NextResponse.json(result);
    }
    const result = await syncAllLocationsBulk();
    return NextResponse.json(result);
  } catch (e: any) {
    console.error("[inventory/locations/sync] error", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "sync_failed" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "POST /api/inventory/locations/sync" });
}
