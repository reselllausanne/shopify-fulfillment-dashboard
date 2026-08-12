import { NextRequest, NextResponse } from "next/server";
import { getStaffRoleFromRequest } from "@/app/lib/staffAuth";
import { getStockxLoginStatus, startInteractiveStockxLogin } from "@/lib/stockxLoginSession";
import { refreshStockxToken } from "@/lib/stockxSessionRefresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin(req: NextRequest) {
  const role = await getStaffRoleFromRequest(req);
  return role === "admin";
}

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ ok: true, ...(await getStockxLoginStatus()) });
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body?.action ?? "start");

  if (action === "refresh") {
    const result = await refreshStockxToken({ force: true });
    return NextResponse.json({
      ok: result.ok,
      reused: result.reused,
      expiresAt: result.expiresAt?.toISOString() ?? null,
      needsManualLogin: result.needsManualLogin,
      error: result.error,
    });
  }

  const login = startInteractiveStockxLogin({ reset: Boolean(body?.reset) });
  return NextResponse.json({ ok: true, login });
}
