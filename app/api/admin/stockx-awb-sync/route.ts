import { NextRequest, NextResponse } from "next/server";
import { getStaffRoleFromRequest } from "@/app/lib/staffAuth";
import { runDecathlonAwbBackfill } from "@/lib/decathlonAwbBackfill";
import { runGalaxusAwbBackfill } from "@/lib/galaxusAwbBackfill";
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

    const shared = { token, days, limit, dryRun, includeFulfilled: false as const };
    const shopify = await runAwbBackfill(shared);
    const galaxus = await runGalaxusAwbBackfill(shared);
    const decathlon = await runDecathlonAwbBackfill(shared);

    const abortedReason =
      shopify.abortedReason || galaxus.abortedReason || decathlon.abortedReason || null;

    return NextResponse.json({
      ok: !abortedReason,
      refresh: {
        ok: refresh.ok,
        reused: refresh.reused,
        expiresAt: refresh.expiresAt?.toISOString() ?? null,
        needsManualLogin: refresh.needsManualLogin,
        error: refresh.error,
      },
      shopify,
      galaxus,
      decathlon,
      scanned: shopify.scanned + galaxus.scanned + decathlon.scanned,
      candidates: shopify.candidates + galaxus.candidates + decathlon.candidates,
      updated: shopify.updated + galaxus.updated + decathlon.updated,
      emailsSent: shopify.emailsSent,
      authFailures: shopify.authFailures + galaxus.authFailures + decathlon.authFailures,
      abortedReason,
      items: [
        ...shopify.items.map((item) => ({ ...item, channel: "shopify" as const })),
        ...galaxus.items,
        ...decathlon.items,
      ],
    });
  } catch (error: any) {
    console.error("[STOCKX-AWB-SYNC] Error:", error?.message || error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Internal error" },
      { status: 500 }
    );
  }
}
