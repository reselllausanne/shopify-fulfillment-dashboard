import { NextRequest, NextResponse } from "next/server";
import {
  findStockxInboundHomeRouteByCode,
  listStockxInboundHomeRoutes,
  upsertStockxInboundHomeRoute,
} from "@/app/lib/stockxInboundHomeRoutes";
import { getStaffRoleFromRequest } from "@/app/lib/staffAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const staffRole = await getStaffRoleFromRequest(req);
  if (!staffRole) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const routes = await listStockxInboundHomeRoutes();
  return NextResponse.json({ ok: true, routes });
}

export async function POST(req: NextRequest) {
  try {
    const staffRole = await getStaffRoleFromRequest(req);
    if (!staffRole) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const stockxOrderNumber = String(body?.stockxOrderNumber ?? "").trim();
    const stockxAwb = String(body?.stockxAwb ?? "").trim() || null;
    const stockxTrackingUrl = String(body?.stockxTrackingUrl ?? "").trim() || null;
    const notes = String(body?.notes ?? "").trim() || null;

    if (!stockxOrderNumber) {
      return NextResponse.json({ ok: false, error: "Missing stockxOrderNumber" }, { status: 400 });
    }

    const route = await upsertStockxInboundHomeRoute({
      stockxOrderNumber,
      stockxAwb,
      stockxTrackingUrl,
      notes,
    });

    return NextResponse.json({ ok: true, route });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to save route" },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  return POST(req);
}

/** Quick lookup for scan UI (no label generation). */
export async function HEAD(req: NextRequest) {
  const code = new URL(req.url).searchParams.get("code");
  if (!code) return new NextResponse(null, { status: 400 });
  const route = await findStockxInboundHomeRouteByCode(code);
  return new NextResponse(null, { status: route ? 200 : 404 });
}
