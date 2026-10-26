import { NextRequest, NextResponse } from "next/server";
import { getStaffRoleFromRequest } from "@/app/lib/staffAuth";
import { runStxAwbResync } from "@/galaxus/jobs/stxAwbResync";
import { runGalaxusStockxAutoLinkSweep } from "@/galaxus/orders/autoLinkSweep";
import { runDecathlonAwbBackfill } from "@/lib/decathlonAwbBackfill";
import { runGalaxusAwbBackfill } from "@/lib/galaxusAwbBackfill";
import { runAwbBackfill } from "@/lib/stockxAwbBackfill";
import { notifyStockxAuthBroken } from "@/lib/stockxAuthAlert";
import { readGalaxusStockxToken } from "@/lib/stockxGalaxusAuth";
import { canRefreshStockxAccount, refreshStockxToken } from "@/lib/stockxSessionRefresh";
import { readServerStockxToken, stockxTokenExpiresAt } from "@/lib/stockxServerToken";
import { listStockxAccountTokens } from "@/lib/stockxToken";
import { runShopifyStockxAutoLinkSweep } from "@/shopify/orders/autoLinkStockxBuys";

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
 * Hourly cron path (scripts/stockx-awb-cron.sh → this route):
 * 1. Refresh StockX session/token (default + Galaxus accounts)
 * 2. Match new StockX buys → Galaxus + Shopify (HIGH-confidence auto-link)
 * 3. Enrich missing chainId + pull AWB/status for Shopify / Galaxus / Decathlon matches
 *
 * Runs inside the web process so Playwright can use the entrypoint Xvfb display.
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
    // Cron splits remint from AWB so a hung backfill cannot starve token refresh.
    const refreshOnly = Boolean(body?.refreshOnly ?? false);
    // Auto-link-only: run the Galaxus + Shopify link sweeps then return, skipping the
    // heavy AWB backfill (which makes the full POST exceed the 780s cron timeout and
    // starves the link step). Lets linking run reliably 2×/day on its own.
    const autoLinkOnly = Boolean(body?.autoLinkOnly ?? false);
    // 30d window: recent matched buys that still need AWB / chainId (cron, not historical dump).
    const days = Number(body?.days ?? 30);
    const limit = Number(body?.limit ?? 60);
    const dryRun = Boolean(body?.dryRun ?? false);

    const remainingBudgetMs = () => Math.max(30_000, 480_000 - (Date.now() - startedAt));

    const runGalaxusAutoLinkRaw = () =>
      dryRun || refreshOnly || body?.skipGalaxusAutoLink === true
        ? Promise.resolve(null)
        : runGalaxusStockxAutoLinkSweep({
            days: Number(body?.galaxusAutoLinkDays ?? 30),
            budgetMs: remainingBudgetMs(),
          }).catch((err: any) => ({ ok: false, error: String(err?.message ?? err) }));
    const runGalaxusAutoLink = async () => {
      const res: any = await runGalaxusAutoLinkRaw();
      if (res && res.ok === false && res.error === "no_stockx_token" && Number(res.candidateOrders ?? 0) > 0) {
        await notifyStockxAuthBroken({
          account: "all",
          error: "Galaxus auto-link sweep found no valid StockX token",
          pendingGalaxusOrders: Number(res.candidateOrders ?? 0),
        }).catch(() => undefined);
      }
      return res;
    };

    const runShopifyAutoLinkRaw = () =>
      dryRun || refreshOnly || body?.skipShopifyAutoLink === true
        ? Promise.resolve(null)
        : runShopifyStockxAutoLinkSweep({
            days: Number(body?.shopifyAutoLinkDays ?? 30),
            maxLines: Number(body?.shopifyAutoLinkLimit ?? 200),
            dryRun,
            budgetMs: remainingBudgetMs(),
          }).catch((err: any) => ({ ok: false, error: String(err?.message ?? err) }));
    const runShopifyAutoLink = async () => {
      const res: any = await runShopifyAutoLinkRaw();
      if (res && res.ok === false && res.error === "no_stockx_token" && Number(res.unmatchedLines ?? 0) > 0) {
        await notifyStockxAuthBroken({
          account: "default",
          error: "Shopify auto-link sweep found no valid StockX token",
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

    if (refreshOnly) {
      const ok = Boolean(refresh.ok || galaxusRefresh?.ok);
      return NextResponse.json(
        {
          ok,
          refreshOnly: true,
          refresh: {
            ok: refresh.ok,
            reused: refresh.reused,
            expiresAt: refresh.expiresAt?.toISOString() ?? null,
            needsManualLogin: refresh.needsManualLogin,
            error: refresh.error,
            reason: refresh.reason ?? null,
          },
          galaxusRefresh: galaxusRefresh
            ? {
                ok: galaxusRefresh.ok,
                reused: galaxusRefresh.reused,
                expiresAt: galaxusRefresh.expiresAt?.toISOString() ?? null,
                error: galaxusRefresh.error,
                reason: galaxusRefresh.reason ?? null,
              }
            : null,
          needsManualLogin: Boolean(refresh.needsManualLogin || (!galaxusRefresh?.ok && galaxusExpiringSoon)),
          error: ok ? null : refresh.error || galaxusRefresh?.error || "StockX refresh failed",
        },
        { status: ok ? 200 : 401 }
      );
    }

    if (!token) {
      // Galaxus sweep can still use Galaxus-file token; Shopify needs default account.
      const galaxusAutoLink = await runGalaxusAutoLink();
      const shopifyAutoLink = await runShopifyAutoLink();
      return NextResponse.json(
        {
          ok: false,
          error: refresh.error || "No valid StockX token",
          needsManualLogin: refresh.needsManualLogin,
          refresh,
          galaxusAutoLink,
          shopifyAutoLink,
        },
        { status: 401 }
      );
    }

    // Match new STX buys first so AWB pass can fill them same hour.
    const galaxusAutoLink = await runGalaxusAutoLink();
    const shopifyAutoLink = await runShopifyAutoLink();

    if (autoLinkOnly) {
      return NextResponse.json({
        ok: true,
        autoLinkOnly: true,
        refresh: { ok: refresh.ok, reused: refresh.reused, error: refresh.error },
        galaxusRefresh: galaxusRefresh
          ? { ok: galaxusRefresh.ok, reused: galaxusRefresh.reused, error: galaxusRefresh.error }
          : null,
        galaxusAutoLink,
        shopifyAutoLink,
      });
    }

    const shared = { token, days, limit, dryRun, includeFulfilled: false as const };
    // Shopify: newly linked OrderMatches (above) + enrich missing chainId + AWB/status.
    const shopify = await runAwbBackfill(shared);
    // Galaxus buys live on a separate StockX account; without its bearer their AWBs never fill.
    const extraTokens = (await listStockxAccountTokens())
      .map((account) => account.token)
      .filter((t) => t !== token);
    const galaxus = await runGalaxusAwbBackfill({ ...shared, extraTokens });
    const decathlon = await runDecathlonAwbBackfill(shared);

    let stxResync: Awaited<ReturnType<typeof runStxAwbResync>> | null = null;
    if (!dryRun) {
      try {
        stxResync = await runStxAwbResync({ token, tokens: extraTokens });
      } catch (error: any) {
        console.warn("[STOCKX-AWB-SYNC] stx-resync failed:", error?.message ?? error);
      }
    }

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
      shopifyAutoLink,
      stxResync,
      scanned: shopify.scanned + galaxus.scanned + decathlon.scanned,
      candidates: shopify.candidates + galaxus.candidates + decathlon.candidates,
      updated: shopify.updated + galaxus.updated + decathlon.updated,
      emailsSent: shopify.emailsSent,
      enrichHealed: shopify.enrichHealed,
      enrichFailed: shopify.enrichFailed,
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
