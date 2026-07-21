import { NextResponse } from "next/server";
import { PHYSICAL_LOCATIONS } from "@/shopify/inventory/locationConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/restock/locations
 *
 * Public list (behind the same auth as /restock) of PHYSICAL Shopify locations
 * the scan page can write to. Ordered by selling priority (Bussigny first).
 * Dropship / online is intentionally excluded — the scan page must not push
 * physical stock into the dropship location.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    locations: PHYSICAL_LOCATIONS.map((l) => ({
      id: l.id,
      name: l.name,
      priority: l.priority,
    })),
  });
}
