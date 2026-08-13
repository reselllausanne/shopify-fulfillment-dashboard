import { NextRequest, NextResponse } from "next/server";
import { getStaffRoleFromRequest } from "@/app/lib/staffAuth";
import { runAwbBackfill } from "@/lib/stockxAwbBackfill";
import { refreshStockxToken } from "@/lib/stockxSessionRefresh";
import { readServerStockxToken } from "@/lib/stockxServerToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

function isLocalCron(req: NextRequest): boolean {
  const host = (req.headers.get("host") || "").toLowerCase();
  // Cron curls the container/host port directly — never the public nginx host.
  return host.startsWith("127.0.0.1") || host.startsWith("localhost");
}

/**
 * Runs inside the web process so Playwright can use the entrypoint Xvfb display.
 * Cron should hit this over localhost instead of `docker compose exec npx tsx …`.
 */
export async function POST(req: NextRequest) {
  try {
    const role = await getStaffRoleFromRequest(req);
    if (role !== "admin" && !isLocalCron(req)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const forceRefresh = Boolean(body?.forceRefresh ?? false);
    const days = Number(body?.days ?? 21);
    const limit = Number(body?.limit ?? 60);
    const dryRun = Boolean(body?.dryRun ?? false);

    const refresh = await refreshStockxToken({ force: forceRefresh });
    const token = refresh.token ?? (await readServerStockxToken())?.token ?? null;

    if (!token) {
      return NextResponse.json(
        {
          ok: false,
          error: refresh.error || "No valid StockX token",
          needsManualLogin: refresh.needsManualLogin,
          refresh,
        },
        { status: 401 }
      );
    }

    const result = await runAwbBackfill({
      token,
      days,
      limit,
      dryRun,
      includeFulfilled: false,
    });

    return NextResponse.json({
      ok: !result.abortedReason,
      refresh: {
        ok: refresh.ok,
        reused: refresh.reused,
        expiresAt: refresh.expiresAt?.toISOString() ?? null,
        needsManualLogin: refresh.needsManualLogin,
        error: refresh.error,
      },
      ...result,
    });
  } catch (error: any) {
    console.error("[STOCKX-AWB-SYNC] Error:", error?.message || error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Internal error" },
      { status: 500 }
    );
  }
}
