import { NextRequest, NextResponse } from "next/server";
import { getStaffRoleFromRequest } from "@/app/lib/staffAuth";
import { autoLinkGoatBuysForShopifyOrders } from "@/shopify/orders/autoLinkGoatBuys";

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
    const result = await autoLinkGoatBuysForShopifyOrders({
      days: Number(body?.days ?? 21),
      limit: Number(body?.limit ?? 200),
      apply: body?.dryRun ? false : true,
      cookie: typeof body?.cookie === "string" ? body.cookie : null,
      csrfToken: typeof body?.csrfToken === "string" ? body.csrfToken : null,
    });
    return NextResponse.json({ ok: !result.error, ...result });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "goat awb sync failed" },
      { status: 500 }
    );
  }
}
