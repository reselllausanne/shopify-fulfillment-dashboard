import { NextRequest, NextResponse } from "next/server";
import { getStaffRoleFromRequest } from "@/app/lib/staffAuth";
import { runDecathlonAwbBackfill } from "@/lib/decathlonAwbBackfill";
import { runGalaxusAwbBackfill } from "@/lib/galaxusAwbBackfill";
import { runGalaxusStockxAutoLinkSweep } from "@/galaxus/orders/autoLinkSweep";
import { runAwbBackfill } from "@/lib/stockxAwbBackfill";
import { canRefreshStockxAccount, refreshStockxToken } from "@/lib/stockxSessionRefresh";
import { notifyStockxAuthBroken } from "@/lib/stockxAuthAlert";
import { readServerStockxToken, stockxTokenExpiresAt } from "@/lib/stockxServerToken";
import { readGalaxusStockxToken } from "@/lib/stockxGalaxusAuth";
import { listStockxAccountTokens } from "@/lib/stockxToken";

const GALAXUS_EXPIRY_WARN_MS = 2 * 60 * 60 * 1000;

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
  const startedAt = Date.now();
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

    const runAutoLinkSweepRaw = () =>
      dryRun || body?.skipGalaxusAutoLink === true
        ? Promise.resolve(null)
        : runGalaxusStockxAutoLinkSweep({
            days: Number(body?.galaxusAutoLinkDays ?? 30),
            budgetMs: Math.max(30_000, 600_000 - (Date.now() - startedAt)),
          }).catch((err: any) => ({ ok: false, error: String(err?.message ?? err) }));
    const runAutoLinkSweep = async () => {
      const res: any = await runAutoLinkSweepRaw();
      if (res && res.ok === false && res.error === "no_stockx_token" && Number(res.candidateOrders ?? 0) > 0) {
        await notifyStockxAuthBroken({
          account: "all",
          error: "Galaxus auto-link sweep found no valid StockX token",
          pendingGalaxusOrders: Number(res.candidateOrders ?? 0),
        }).catch(() => undefined);
      }
      return res;
    };

    // Sequential: both accounts drive a headed Chromium on the same Xvfb display.
    const refresh = await refreshStockxToken({ force: forceRefresh });
    const galaxusRefresh = (await canRefreshStockxAccount("galaxus"))
      ? await refreshStockxToken({ force: forceRefresh, account: "galaxus" })
      : null;
    if (!refresh.ok) {
      await notifyStockxAuthBroken({ account: "default", error: refresh.error }).catch(() => undefined);
    }
    const galaxusToken = galaxusRefresh?.token ?? (await readGalaxusStockxToken());
    const galaxusExpiresAt = galaxusToken ? stockxTokenExpiresAt(galaxusToken) : null;
    const galaxusExpiringSoon =
      !galaxusExpiresAt || galaxusExpiresAt.getTime() - Date.now() < GALAXUS_EXPIRY_WARN_MS;
    if ((galaxusRefresh && !galaxusRefresh.ok) || (!galaxusRefresh && galaxusExpiringSoon)) {
      await notifyStockxAuthBroken({
        account: "galaxus",
        error:
          galaxusRefresh?.error ??
          (galaxusExpiresAt
            ? `token expires ${galaxusExpiresAt.toISOString()}; no profile/credentials for auto-refresh`
            : "token missing or expired; no profile/credentials for auto-refresh"),
      }).catch(() => undefined);
    }
    const token = refresh.token ?? (await readServerStockxToken())?.token ?? null;

    if (!token) {
      // Sweep uses every valid account token (e.g. Galaxus file), not only the dashboard one.
      const galaxusAutoLink = await runAutoLinkSweep();
      return NextResponse.json(
        {
          ok: false,
          error: refresh.error || "No valid StockX token",
          needsManualLogin: refresh.needsManualLogin,
          refresh,
          galaxusAutoLink,
        },
        { status: 401 }
      );
    }

    const shared = { token, days, limit, dryRun, includeFulfilled: false as const };
    const shopify = await runAwbBackfill(shared);
    // Galaxus buys live on a separate StockX account; without its bearer their AWBs never fill.
    const extraTokens = (await listStockxAccountTokens())
      .map((account) => account.token)
      .filter((t) => t !== token);
    const galaxus = await runGalaxusAwbBackfill({ ...shared, extraTokens });
    const decathlon = await runDecathlonAwbBackfill(shared);

    const galaxusAutoLink = await runAutoLinkSweep();

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
      galaxusRefresh: galaxusRefresh
        ? {
            ok: galaxusRefresh.ok,
            reused: galaxusRefresh.reused,
            expiresAt: galaxusRefresh.expiresAt?.toISOString() ?? null,
            error: galaxusRefresh.error,
          }
        : null,
      shopify,
      galaxus,
      decathlon,
      galaxusAutoLink,
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
