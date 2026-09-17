import { NextRequest, NextResponse } from "next/server";
import { getStaffRoleFromRequest } from "@/app/lib/staffAuth";
import { autoLinkUnclaimedStockxBuysForShopifyOrders } from "@/shopify/orders/autoLinkStockxBuys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

function isLocalCron(req: NextRequest): boolean {
  const host = (req.headers.get("host") || "").toLowerCase();
  return host.startsWith("127.0.0.1") || host.startsWith("localhost");
}

export async function POST(req: NextRequest) {
  try {
    const role = await getStaffRoleFromRequest(req);
    if (role !== "admin" && !isLocalCron(req)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await autoLinkUnclaimedStockxBuysForShopifyOrders({
      days: Number(body?.days ?? 21),
      limit: Number(body?.limit ?? 200),
      apply: body?.dryRun ? false : true,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "shopify stockx autolink failed" },
      { status: 500 }
    );
  }
}
