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
import { startFeedSnapshotRebuildAsync } from "@/galaxus/exports/feedSnapshot";
import { startImageSyncFullAsync } from "@/galaxus/ops/imageSyncPush";
import { GALAXUS_FEED_UPLOADS_DISABLED } from "@/galaxus/config";
import { gatePartnerSyncForTheSupplier } from "@/galaxus/supplier/theSupplierPolicy";

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
    if (action === "rebuild-feed-snapshots") {
      const started = await startFeedSnapshotRebuildAsync(origin);
      if (!started.ok) {
        return NextResponse.json(
          { ok: false, error: started.error ?? "Feed snapshot rebuild rejected" },
          { status: started.status ?? 409 }
        );
      }
      return NextResponse.json({ ok: true, accepted: true }, { status: 202 });
    }

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
      const partnerScope = partnerKey.trim();
      if (!partnerScope) {
        return NextResponse.json(
          { ok: false, error: "partnerKey is required (THE supplier sync is disabled)" },
          { status: 400 }
        );
      }
      const partnerGate = gatePartnerSyncForTheSupplier(partnerScope);
      if (!partnerGate.allowed) {
        return NextResponse.json({ ok: false, error: partnerGate.reason }, { status: 400 });
      }
      const data = await runOpsTick(origin, {
        force: true,
        only: ["partner-stock-sync"],
        partnerKey: partnerScope,
      });
      // Never auto-create Shopify products from partner-sync. That path used
      // providerKey as title when KickDB/name missing → junk THE_<gtin> products
      // with 0 sales channels. Catalog create stays on restock / explicit catalog sync.
      return NextResponse.json({ ok: true, partnerKey: partnerScope, data });
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

    if (action === "gld-refresh") {
      // Enqueues ops-background worker (see tick executeJob) — never runs Golden fetch on web.
      const data = await runOpsTick(origin, {
        force: true,
        only: ["gld-refresh"],
      });
      const gld = (data as any)?.results?.["gld-refresh"] ?? (data as any)?.["gld-refresh"];
      const err = gld?.lastError ?? null;
      if (err && !String(err).includes("already")) {
        return NextResponse.json({ ok: false, error: err, data }, { status: 500 });
      }
      return NextResponse.json({ ok: true, accepted: true, data }, { status: 202 });
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
