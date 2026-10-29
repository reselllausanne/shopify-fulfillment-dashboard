import { NextRequest, NextResponse } from "next/server";
import { getStaffRoleFromRequest } from "@/app/lib/staffAuth";
import { runStxAwbResync } from "@/galaxus/jobs/stxAwbResync";
import { runGalaxusStockxAutoLinkSweep } from "@/galaxus/orders/autoLinkSweep";
import { runDecathlonAwbBackfill } from "@/lib/decathlonAwbBackfill";
import { runGalaxusAwbBackfill } from "@/lib/galaxusAwbBackfill";
import { AWB_BUDGET_EXHAUSTED, runAwbBackfill } from "@/lib/stockxAwbBackfill";
import { notifyStockxAuthBroken } from "@/lib/stockxAuthAlert";
import { runStockxOrderOpsAlerts } from "@/lib/stockxOpsAlerts";
import { readGalaxusStockxToken } from "@/lib/stockxGalaxusAuth";
import { canRefreshStockxAccount, refreshStockxToken } from "@/lib/stockxSessionRefresh";
import { readServerStockxToken, stockxTokenExpiresAt } from "@/lib/stockxServerToken";
import { listStockxAccountTokens } from "@/lib/stockxToken";
import { runShopifyStockxAutoLinkSweep } from "@/shopify/orders/autoLinkStockxBuys";

const GALAXUS_EXPIRY_WARN_MS = 2 * 60 * 60 * 1000;
/** Cron curl --max-time 780; leave headroom so JSON always lands before kill. */
const AWB_ONLY_BUDGET_MS = 600_000;
/** Cap second-pass unit resync so it cannot eat the whole AWB budget alone. */
const AWB_CRON_RESYNC_LIMIT_UNITS = 80;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

function isLocalCron(req: NextRequest): boolean {
  const host = (req.headers.get("host") || "").toLowerCase();
  // Cron curls the container/host port directly — never the public nginx host.
  return host.startsWith("127.0.0.1") || host.startsWith("localhost");
}

function isAuthAbort(reason: string | null | undefined): boolean {
  return Boolean(reason && reason !== AWB_BUDGET_EXHAUSTED);
}

/**
 * Hourly cron path (scripts/stockx-awb-cron.sh → this route):
 * 1. refreshOnly — remint StockX session/token (default + Galaxus)
 * 2. autoLinkOnly — match new StockX buys → Galaxus + Shopify
 * 3. awbOnly — enrich chainId + pull AWB/status (no remint/autolink redo)
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
    // AWB-only: skip remint + autoLink (cron already ran those). Bound wall-clock so
    // curl --max-time 780 always gets a fresh JSON body instead of hanging 13m.
    const awbOnly = Boolean(body?.awbOnly ?? false);
    // 30d window: recent matched buys that still need AWB / chainId (cron, not historical dump).
    const days = Number(body?.days ?? 30);
    const limit = Number(body?.limit ?? 60);
    const dryRun = Boolean(body?.dryRun ?? false);

    const remainingBudgetMs = () => Math.max(30_000, 480_000 - (Date.now() - startedAt));

    const runGalaxusAutoLinkRaw = () =>
      dryRun || refreshOnly || awbOnly || body?.skipGalaxusAutoLink === true
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
      dryRun || refreshOnly || awbOnly || body?.skipShopifyAutoLink === true
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

    const runAwbPasses = async (token: string, deadlineAt: number) => {
      const remaining = () => Math.max(0, deadlineAt - Date.now());
      const sharedBase = { token, days, limit, dryRun, includeFulfilled: false as const };

      console.log(
        `[STOCKX-AWB-SYNC] awb passes start budgetMs=${remaining()} limit=${limit} days=${days}`
      );

      const shopify = await runAwbBackfill({ ...sharedBase, budgetMs: remaining() });
      const extraTokens = (await listStockxAccountTokens())
        .map((account) => account.token)
        .filter((t) => t !== token);
      const galaxus = await runGalaxusAwbBackfill({
        ...sharedBase,
        extraTokens,
        budgetMs: remaining(),
      });
      const decathlon = await runDecathlonAwbBackfill({
        ...sharedBase,
        budgetMs: remaining(),
      });

      let stxResync: Awaited<ReturnType<typeof runStxAwbResync>> | null = null;
      if (!dryRun && remaining() > 15_000) {
        try {
          stxResync = await runStxAwbResync({
            token,
            tokens: extraTokens,
            limitUnits: AWB_CRON_RESYNC_LIMIT_UNITS,
            budgetMs: remaining(),
          });
        } catch (error: any) {
          console.warn("[STOCKX-AWB-SYNC] stx-resync failed:", error?.message ?? error);
        }
      } else if (!dryRun) {
        stxResync = {
          scannedUnits: 0,
          uniqueOrders: 0,
          updatedUnits: 0,
          updatedOrders: 0,
          budgetExhausted: true,
        };
      }

      const channelAbort =
        shopify.abortedReason || galaxus.abortedReason || decathlon.abortedReason || null;
      const budgetExhausted =
        channelAbort === AWB_BUDGET_EXHAUSTED || Boolean(stxResync?.budgetExhausted);
      const authAborted =
        isAuthAbort(shopify.abortedReason) ||
        isAuthAbort(galaxus.abortedReason) ||
        isAuthAbort(decathlon.abortedReason);
      const abortedReason = authAborted
        ? shopify.abortedReason && isAuthAbort(shopify.abortedReason)
          ? shopify.abortedReason
          : galaxus.abortedReason && isAuthAbort(galaxus.abortedReason)
            ? galaxus.abortedReason
            : decathlon.abortedReason
        : budgetExhausted
          ? AWB_BUDGET_EXHAUSTED
          : null;

      console.log(
        `[STOCKX-AWB-SYNC] awb passes done elapsedMs=${Date.now() - startedAt} updated=${
          shopify.updated + galaxus.updated + decathlon.updated
        } abortedReason=${abortedReason ?? "none"}`
      );

      return {
        shopify,
        galaxus,
        decathlon,
        stxResync,
        abortedReason,
        // Partial OK when only budget ran out — operator sees drained counts, cron gets JSON.
        ok: !authAborted,
        budgetExhausted,
      };
    };

    // Cron step 3: tokens already reminted; do not reopen Chromium / redo autoLink.
    if (awbOnly) {
      const token = (await readServerStockxToken())?.token ?? null;
      if (!token) {
        return NextResponse.json(
          { ok: false, awbOnly: true, error: "No valid StockX token" },
          { status: 401 }
        );
      }
      const budgetMs = Math.min(
        Math.max(Number(body?.budgetMs ?? AWB_ONLY_BUDGET_MS) || AWB_ONLY_BUDGET_MS, 60_000),
        700_000
      );
      const passes = await runAwbPasses(token, Date.now() + budgetMs);
      return NextResponse.json({
        ok: passes.ok,
        awbOnly: true,
        elapsedMs: Date.now() - startedAt,
        shopify: passes.shopify,
        galaxus: passes.galaxus,
        decathlon: passes.decathlon,
        stxResync: passes.stxResync,
        scanned: passes.shopify.scanned + passes.galaxus.scanned + passes.decathlon.scanned,
        candidates:
          passes.shopify.candidates + passes.galaxus.candidates + passes.decathlon.candidates,
        updated: passes.shopify.updated + passes.galaxus.updated + passes.decathlon.updated,
        emailsSent: passes.shopify.emailsSent,
        enrichHealed: passes.shopify.enrichHealed,
        enrichFailed: passes.shopify.enrichFailed,
        authFailures:
          passes.shopify.authFailures + passes.galaxus.authFailures + passes.decathlon.authFailures,
        abortedReason: passes.abortedReason,
        budgetExhausted: passes.budgetExhausted,
        items: [
          ...passes.shopify.items.map((item) => ({ ...item, channel: "shopify" as const })),
          ...passes.galaxus.items,
          ...passes.decathlon.items,
        ],
      });
    }

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
      // BOTH accounts must be healthy. OR-ok previously returned HTTP 200 when default
      // reused a live JWT while galaxus remint was dead (CF/Turnstile) — cron treated
      // refresh as success and the operator saw no failure signal.
      const ok = Boolean(refresh.ok && (galaxusRefresh == null || galaxusRefresh.ok));
      const error = ok
        ? null
        : refresh.error || galaxusRefresh?.error || "StockX refresh failed";
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
          error,
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
    // Orders with a plausible buy candidate (buyable-in-progress / medium email) — the
    // hard-unlinked Shopify UNLINKED alert must skip these to avoid double-alerting.
    const excludeShopifyOrderNames = Array.isArray((shopifyAutoLink as any)?.candidateOrderNames)
      ? ((shopifyAutoLink as any).candidateOrderNames as string[])
      : [];

    if (autoLinkOnly) {
      // Operator alerts (cancel/refund/delay/not-purchased/unlinked) fire here — this
      // lightweight path always completes, so the operator is notified reliably every run
      // (to me first; customer milestone flow already skips cancelled/delayed).
      const opsAlerts = dryRun
        ? null
        : await runStockxOrderOpsAlerts({ days, excludeShopifyOrderNames }).catch((err: any) => ({
            ok: false,
            error: String(err?.message ?? err),
          }));
      return NextResponse.json({
        ok: true,
        autoLinkOnly: true,
        refresh: { ok: refresh.ok, reused: refresh.reused, error: refresh.error },
        galaxusRefresh: galaxusRefresh
          ? { ok: galaxusRefresh.ok, reused: galaxusRefresh.reused, error: galaxusRefresh.error }
          : null,
        galaxusAutoLink,
        shopifyAutoLink,
        opsAlerts,
      });
    }

    // Dashboard / manual full path: still bound so a runaway resync cannot hang forever.
    const fullDeadline = Date.now() + Math.max(60_000, remainingBudgetMs() + 120_000);
    const passes = await runAwbPasses(token, fullDeadline);

    const opsAlerts = dryRun
      ? null
      : await runStockxOrderOpsAlerts({ days, excludeShopifyOrderNames }).catch((err: any) => ({
          ok: false,
          error: String(err?.message ?? err),
        }));

    return NextResponse.json({
      ok: passes.ok,
      elapsedMs: Date.now() - startedAt,
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
      shopify: passes.shopify,
      galaxus: passes.galaxus,
      decathlon: passes.decathlon,
      galaxusAutoLink,
      shopifyAutoLink,
      stxResync: passes.stxResync,
      opsAlerts,
      scanned: passes.shopify.scanned + passes.galaxus.scanned + passes.decathlon.scanned,
      candidates:
        passes.shopify.candidates + passes.galaxus.candidates + passes.decathlon.candidates,
      updated: passes.shopify.updated + passes.galaxus.updated + passes.decathlon.updated,
      emailsSent: passes.shopify.emailsSent,
      enrichHealed: passes.shopify.enrichHealed,
      enrichFailed: passes.shopify.enrichFailed,
      authFailures:
        passes.shopify.authFailures + passes.galaxus.authFailures + passes.decathlon.authFailures,
      abortedReason: passes.abortedReason,
      budgetExhausted: passes.budgetExhausted,
      items: [
        ...passes.shopify.items.map((item) => ({ ...item, channel: "shopify" as const })),
        ...passes.galaxus.items,
        ...passes.decathlon.items,
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
