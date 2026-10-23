import { NextRequest, NextResponse } from "next/server";
import { getStaffRoleFromRequest } from "@/app/lib/staffAuth";
import {
  getStockxLoginStatus,
  startInteractiveStockxLogin,
  stopInteractiveStockxLogin,
} from "@/lib/stockxLoginSession";
import { parseStockxRefreshAccount, refreshStockxToken } from "@/lib/stockxSessionRefresh";

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
  const account = parseStockxRefreshAccount(req.nextUrl.searchParams.get("account"));
  return NextResponse.json({ ok: true, ...(await getStockxLoginStatus(account)) });
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body?.action ?? "start");
  const account = parseStockxRefreshAccount(body?.account);

  if (action === "refresh") {
    const result = await refreshStockxToken({ force: true, account });
    return NextResponse.json({
      ok: result.ok,
      reused: result.reused,
      expiresAt: result.expiresAt?.toISOString() ?? null,
      needsManualLogin: result.needsManualLogin,
      error: result.error,
    });
  }

  if (action === "stop") {
    const scope = body?.all === true || body?.account === "all" ? "all" : account;
    const result = await stopInteractiveStockxLogin({ account: scope });
    return NextResponse.json({
      ok: true,
      ...result,
      ...(await getStockxLoginStatus(account)),
    });
  }

  const login = await startInteractiveStockxLogin({
    reset: Boolean(body?.reset),
    account,
    force: Boolean(body?.force),
  });

  if (login.blockedBy) {
    const status = await getStockxLoginStatus(account);
    return NextResponse.json(
      {
        ok: false,
        error: login.error,
        ...status,
        login, // prefer start() payload (includes blockedBy)
      },
      { status: 409 }
    );
  }

  return NextResponse.json({ ok: true, login });
}
