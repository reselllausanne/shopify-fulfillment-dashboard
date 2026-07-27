import { NextResponse } from "next/server";
import { runOpsTick } from "@/galaxus/ops/tick";
import {
  countPendingFeedPushTriggers,
  drainFeedPushQueue,
  getActiveFeedRun,
  reconcileStaleFeedRuns,
  reconcileStaleFeedTriggers,
  startFeedPushAsync,
} from "@/galaxus/ops/feedPipeline";
import { startImageSyncFullAsync } from "@/galaxus/ops/imageSyncPush";
import { GALAXUS_FEED_UPLOADS_DISABLED } from "@/galaxus/config";
import { syncShopifyCatalog } from "@/shopify/catalog/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ASYNC_PUSH_ACTIONS = new Set([
  "push-stock-price",
  "push-stock",
  "push-price",
  "push-full",
  "push-master-specs",
]);

export async function POST(request: Request) {
  try {
    const origin = new URL(request.url).origin;
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      stxMode?: string;
      imageMode?: string;
      partnerKey?: string;
      staleMinutes?: number;
    };
    const action = String(body?.action ?? "").trim().toLowerCase();
    const partnerKey = String(body?.partnerKey ?? "").trim();

    if (!action) {
      return NextResponse.json({ ok: false, error: "Missing action" }, { status: 400 });
    }

    // Cron-safe: reap zombie runs and start the oldest pending push. Keeps post-sale
    // price files flowing within minutes instead of waiting for the nightly full-flow.
    if (action === "drain-queue") {
      const staleMinutes = Number(body?.staleMinutes);
      if (Number.isFinite(staleMinutes) && staleMinutes > 0) {
        await reconcileStaleFeedRuns(staleMinutes * 60 * 1000);
      }
      await reconcileStaleFeedTriggers();
      const before = await countPendingFeedPushTriggers();
      const drained = await drainFeedPushQueue(origin);
      const active = await getActiveFeedRun();
      return NextResponse.json({
        ok: true,
        pendingBefore: before,
        pendingAfter: await countPendingFeedPushTriggers(),
        drained,
        activeRunId: active?.runId ?? null,
      });
    }

    if (action === "tick") {
      const data = await runOpsTick(origin, { force: true });
      return NextResponse.json({ ok: true, data });
    }

    if (action === "partner-sync") {
      const partnerScope = partnerKey || "THE";
      const data = await runOpsTick(origin, {
        force: true,
        only: ["partner-stock-sync"],
        partnerKey: partnerScope,
      });
      const shopifyCatalog = await syncShopifyCatalog({
        limit: 5000,
        supplierKey: partnerScope.toLowerCase(),
        inStockOnly: true,
        missingOnly: false,
        dryRun: false,
      });
      return NextResponse.json({ ok: true, partnerKey: partnerScope, data, shopifyCatalog });
    }

    if (action === "stx-refresh") {
      const stxMode = String(body?.stxMode ?? "price").toLowerCase() === "full" ? "full" : "price";
      const data = await runOpsTick(origin, {
        force: true,
        only: ["stx-refresh"],
        stxRefreshMode: stxMode,
      });
      return NextResponse.json({ ok: true, data, stxMode });
    }

    if (action === "edi-in") {
      const data = await runOpsTick(origin, { force: true, only: ["edi-in"] });
      return NextResponse.json({ ok: true, data });
    }
    if (action === "image-sync") {
      const imageMode = String(body?.imageMode ?? "full").toLowerCase() === "batch" ? "batch" : "full";
      if (imageMode === "full") {
        const started = await startImageSyncFullAsync();
        if (!started.ok) {
          return NextResponse.json(
            { ok: false, error: started.error ?? "Image sync rejected" },
            { status: started.status ?? 409 }
          );
        }
        return NextResponse.json(
          { ok: true, accepted: true, imageMode: "full" },
          { status: 202 }
        );
      }
      const data = await runOpsTick(origin, {
        force: true,
        only: ["image-sync"],
        imageSyncMode: "batch",
      });
      return NextResponse.json({ ok: true, data, imageMode: "batch" });
    }

    if (action.startsWith("push-") && GALAXUS_FEED_UPLOADS_DISABLED) {
      return NextResponse.json(
        { ok: false, error: "Feed uploads are disabled" },
        { status: 403 }
      );
    }

    const pushScope =
      action === "push-stock-price"
        ? "stock-price"
        : action === "push-stock"
          ? "stock"
          : action === "push-price"
            ? "price"
            : action === "push-full"
              ? "full"
              : action === "push-master-specs"
                ? "master-specs"
                : null;

    if (pushScope && ASYNC_PUSH_ACTIONS.has(action)) {
      const started = await startFeedPushAsync({
        origin,
        scope: pushScope,
        triggerSource: "manual",
      });
      if (!started.ok) {
        return NextResponse.json(
          { ok: false, error: started.error ?? "Feed push rejected", runId: started.runId ?? null },
          { status: started.status ?? 500 }
        );
      }
      return NextResponse.json(
        {
          ok: true,
          accepted: Boolean(started.accepted),
          queued: Boolean(started.queued),
          runId: started.runId,
          triggerId: started.triggerId ?? null,
          scope: pushScope,
        },
        { status: 202 }
      );
    }

    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (error: any) {
    console.error("[GALAXUS][OPS][RUN] Failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Run failed" },
      { status: 500 }
    );
  }
}
