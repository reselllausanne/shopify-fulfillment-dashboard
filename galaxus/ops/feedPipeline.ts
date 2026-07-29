import { prisma } from "@/app/lib/prisma";
import { randomUUID } from "crypto";
import { withAdvisoryXactLock } from "@/galaxus/jobs/advisoryLock";
import { GALAXUS_FEED_UPLOADS_DISABLED } from "@/galaxus/config";
import type { FeedScope, FeedTriggerSource } from "./types";

type FeedRunResult = {
  ok: boolean;
  runId: string;
  scope: FeedScope;
  triggerSource?: FeedTriggerSource;
  counts?: Record<string, number | null>;
  uploaded?: Array<{ name: string; path: string; size: number }>;
  error?: string;
};

export type FeedPushStartResult = {
  ok: boolean;
  accepted?: boolean;
  queued?: boolean;
  runId?: string;
  triggerId?: string;
  error?: string;
  status?: number;
  drained?: boolean;
};

/** After container kill/redeploy, finishedAt stays null — keep short so night cron recovers. */
const STALE_FEED_RUN_MS = 90 * 60 * 1000;
/** Master+specs export/upload can run 2–3h on large catalogs; do not reap mid-flight. */
const STALE_MASTER_SPECS_RUN_MS = 6 * 60 * 60 * 1000;
/** Stock/price full-catalog export+SFTP can exceed 90m on ~300k rows. */
const STALE_STOCK_PRICE_RUN_MS = 4 * 60 * 60 * 1000;

/** Triggers that may upload even when GALAXUS_FEED_UPLOADS_MANUAL_ONLY is on. */
function feedTriggerAllowsUpload(triggerSource?: FeedTriggerSource): boolean {
  return (
    triggerSource === "manual" ||
    triggerSource === "manual-pricing" ||
    triggerSource === "order-ingest" ||
    triggerSource === "shopify-post-sale" ||
    triggerSource === "admin" ||
    triggerSource === "partner-admin" ||
    triggerSource === "partner-order-fulfilled" ||
    triggerSource === "partner-shipment-fulfilled" ||
    triggerSource === "decathlon-partner-ship" ||
    triggerSource === "decathlon-partner-ship-reconciled" ||
    triggerSource === "partner-sync" ||
    triggerSource === "inventory-sync" ||
    triggerSource === "scraper"
  );
}

async function callFeedUpload(
  origin: string,
  scope: FeedScope,
  manual: boolean,
  providerKeys?: string[]
) {
  const type =
    scope === "full"
      ? "all"
      : scope === "master-specs"
        ? "master-specs"
        : scope === "stock"
          ? "stock"
          : scope === "price"
            ? "offer"
            : "offer-stock";
  const manualParam = manual ? "&manual=1" : "";
  const keysParam =
    providerKeys && providerKeys.length > 0
      ? `&providerKeys=${encodeURIComponent(providerKeys.join(","))}`
      : "";
  const url = `${origin}/api/galaxus/feeds/upload?type=${type}${manualParam}${keysParam}`;
  const routeModule = await import("@/app/api/galaxus/feeds/upload/route");
  const req = new Request(url, { method: "POST" });
  const res = await routeModule.POST(req);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error ?? `Feed upload failed (HTTP ${res.status})`);
  }
  return data;
}

async function collectManifestIds(runId: string) {
  const rows = await (prisma as any).galaxusExportManifest.findMany({
    where: { runId },
    select: { id: true },
  });
  return rows.map((row: any) => row.id);
}

export async function reconcileStaleFeedRuns(maxAgeMs = STALE_FEED_RUN_MS) {
  const prismaAny = prisma as any;
  const defaultCutoff = new Date(Date.now() - maxAgeMs);
  const masterCutoff = new Date(Date.now() - STALE_MASTER_SPECS_RUN_MS);
  const stockPriceCutoff = new Date(Date.now() - STALE_STOCK_PRICE_RUN_MS);
  await prismaAny.galaxusFeedRun.updateMany({
    where: {
      finishedAt: null,
      scope: "master-specs",
      startedAt: { lt: masterCutoff },
    },
    data: {
      finishedAt: new Date(),
      success: false,
      errorMessage: "Stale master-specs feed run timed out",
    },
  });
  await prismaAny.galaxusFeedRun.updateMany({
    where: {
      finishedAt: null,
      scope: { in: ["stock", "price", "stock-price", "full"] },
      startedAt: { lt: stockPriceCutoff },
    },
    data: {
      finishedAt: new Date(),
      success: false,
      errorMessage: "Stale stock/price feed run timed out",
    },
  });
  await prismaAny.galaxusFeedRun.updateMany({
    where: {
      finishedAt: null,
      scope: { notIn: ["master-specs", "stock", "price", "stock-price", "full"] },
      startedAt: { lt: defaultCutoff },
    },
    data: {
      finishedAt: new Date(),
      success: false,
      errorMessage: "Stale feed run timed out",
    },
  });
}

const STALE_FEED_TRIGGER_MS = 2 * 60 * 60 * 1000;

/** Reset zombie RUNNING triggers; re-queue recent ones if no active feed. */
export async function reconcileStaleFeedTriggers() {
  const prismaAny = prisma as any;
  const cutoff = new Date(Date.now() - STALE_FEED_TRIGGER_MS);
  const failed = await prismaAny.galaxusFeedTrigger.updateMany({
    where: { status: "RUNNING", requestedAt: { lt: cutoff } },
    data: { status: "FAILED" },
  });

  const active = await prismaAny.galaxusFeedRun.findFirst({
    where: { finishedAt: null },
    select: { id: true },
  });
  if (active) return failed?.count ?? 0;

  const reset = await prismaAny.galaxusFeedTrigger.updateMany({
    where: { status: "RUNNING", requestedAt: { gte: cutoff } },
    data: { status: "PENDING", consumedAt: null },
  });
  return (failed?.count ?? 0) + (reset?.count ?? 0);
}

function feedPushLockKey(scope: FeedScope) {
  return `galaxus:feed-push:${scope}`;
}

/** Active run for one scope — feeds no longer block each other globally. */
export async function getActiveFeedRun(scope?: FeedScope) {
  await reconcileStaleFeedRuns();
  await reconcileStaleFeedTriggers();
  return (prisma as any).galaxusFeedRun.findFirst({
    where: {
      finishedAt: null,
      ...(scope ? { scope } : {}),
    },
    orderBy: { startedAt: "desc" },
  });
}

export async function countPendingFeedPushTriggers(scope?: FeedScope) {
  const prismaAny = prisma as any;
  return prismaAny.galaxusFeedTrigger.count({
    where: {
      status: "PENDING",
      ...(scope ? { scope } : {}),
    },
  });
}

/** One pending row per scope — bursts coalesce instead of flooding SFTP. */
export async function enqueueFeedPushTrigger(params: {
  scope: FeedScope;
  triggerSource?: FeedTriggerSource;
}): Promise<{ triggerId: string; created: boolean }> {
  const prismaAny = prisma as any;
  const existing = await prismaAny.galaxusFeedTrigger.findFirst({
    where: { scope: params.scope, status: "PENDING" },
    orderBy: { requestedAt: "asc" },
  });
  if (existing) {
    return { triggerId: String(existing.id), created: false };
  }
  const row = await prismaAny.galaxusFeedTrigger.create({
    data: {
      scope: params.scope,
      triggerSource: params.triggerSource ?? null,
    },
  });
  return { triggerId: String(row.id), created: true };
}

async function finalizeFeedTrigger(params: {
  feedTriggerId?: string;
  success: boolean;
  origin: string;
  scope: FeedScope;
  triggerSource?: FeedTriggerSource;
}) {
  const prismaAny = prisma as any;
  if (params.feedTriggerId) {
    await prismaAny.galaxusFeedTrigger
      .update({
        where: { id: params.feedTriggerId },
        data: {
          status: params.success ? "DONE" : "PENDING",
          consumedAt: params.success ? new Date() : null,
        },
      })
      .catch((err: unknown) => {
        console.warn("[GALAXUS][FEED][QUEUE] trigger finalize failed", {
          feedTriggerId: params.feedTriggerId,
          error: err,
        });
      });
  } else if (!params.success) {
    await enqueueFeedPushTrigger({
      scope: params.scope,
      triggerSource: params.triggerSource,
    });
  }

  void drainFeedPushQueue(params.origin).catch((err) => {
    console.error("[GALAXUS][FEED][QUEUE] drain failed:", err);
  });
}

function scheduleAsyncFeedRun(params: {
  feedRunId: string;
  runId: string;
  origin: string;
  scope: FeedScope;
  triggerSource?: FeedTriggerSource;
  providerKeys?: string[];
  feedTriggerId?: string;
}) {
  const start = () =>
    executeFeedRun({
      feedRunId: params.feedRunId,
      runId: params.runId,
      origin: params.origin,
      scope: params.scope,
      triggerSource: params.triggerSource,
      providerKeys: params.providerKeys,
    })
      .then((result) =>
        finalizeFeedTrigger({
          feedTriggerId: params.feedTriggerId,
          success: result.ok,
          origin: params.origin,
          scope: params.scope,
          triggerSource: params.triggerSource,
        })
      )
      .catch((err) => {
        console.error("[GALAXUS][FEED][ASYNC] Background push failed:", err);
        return finalizeFeedTrigger({
          feedTriggerId: params.feedTriggerId,
          success: false,
          origin: params.origin,
          scope: params.scope,
          triggerSource: params.triggerSource,
        });
      });

  // Start immediately. after()/unref'd setTimeout silently drop work after ops/run returns 202,
  // leaving galaxusFeedRun rows stuck with finishedAt=null (countsJson=null) until stale reaper kills them.
  void start();
}

async function beginAsyncFeedRun(params: {
  origin: string;
  scope: FeedScope;
  triggerSource?: FeedTriggerSource;
  providerKeys?: string[];
  feedTriggerId?: string;
}): Promise<FeedPushStartResult> {
  const runId = randomUUID();
  const feedRun = await (prisma as any).galaxusFeedRun.create({
    data: {
      runId,
      scope: params.scope,
      triggerSource: params.triggerSource ?? null,
      startedAt: new Date(),
      finishedAt: null,
      success: false,
      errorMessage: null,
      countsJson: null,
      manifestIds: [],
    },
  });

  scheduleAsyncFeedRun({
    feedRunId: feedRun.id,
    runId,
    origin: params.origin,
    scope: params.scope,
    triggerSource: params.triggerSource,
    providerKeys: params.providerKeys,
    feedTriggerId: params.feedTriggerId,
  });

  return {
    ok: true,
    accepted: true,
    runId,
    triggerId: params.feedTriggerId,
    status: 202,
  };
}

async function executeFeedRun(params: {
  feedRunId: string;
  runId: string;
  origin: string;
  scope: FeedScope;
  triggerSource?: FeedTriggerSource;
  providerKeys?: string[];
}): Promise<FeedRunResult> {
  const { feedRunId, origin, scope, triggerSource, providerKeys } = params;
  let effectiveRunId = params.runId;
  let counts: Record<string, number | null> | undefined;
  let uploaded: Array<{ name: string; path: string; size: number }> | undefined;
  let error: string | undefined;

  if (GALAXUS_FEED_UPLOADS_DISABLED) {
    error = "Feed uploads are disabled";
  } else {
    try {
      const data = await callFeedUpload(
        origin,
        scope,
        feedTriggerAllowsUpload(triggerSource),
        providerKeys
      );
      counts = data?.counts ?? undefined;
      uploaded = Array.isArray(data?.uploaded) ? data.uploaded : undefined;
      if (data?.runId) {
        await (prisma as any).galaxusFeedRun.update({
          where: { id: feedRunId },
          data: { runId: String(data.runId) },
        });
        effectiveRunId = String(data.runId);
      }
    } catch (err: any) {
      error = err?.message ?? "Feed upload failed";
    }
  }

  const manifestIds = await collectManifestIds(effectiveRunId);
  await (prisma as any).galaxusFeedRun.update({
    where: { id: feedRunId },
    data: {
      runId: effectiveRunId,
      finishedAt: new Date(),
      success: !error,
      errorMessage: error ?? null,
      countsJson: counts ?? null,
      manifestIds,
    },
  });

  return {
    ok: !error,
    runId: effectiveRunId,
    scope,
    triggerSource,
    counts,
    uploaded,
    error,
  };
}

export async function runFeedPipeline(params: {
  origin: string;
  scope: FeedScope;
  triggerSource?: FeedTriggerSource;
  providerKeys?: string[];
}): Promise<FeedRunResult> {
  const { origin, scope, triggerSource, providerKeys } = params;
  const runId = randomUUID();
  const feedRun = await (prisma as any).galaxusFeedRun.create({
    data: {
      runId,
      scope,
      triggerSource: triggerSource ?? null,
      startedAt: new Date(),
      finishedAt: null,
      success: false,
      errorMessage: null,
      countsJson: null,
      manifestIds: [],
    },
  });
  return executeFeedRun({
    feedRunId: feedRun.id,
    runId,
    origin,
    scope,
    triggerSource,
    providerKeys,
  });
}

export async function startFeedPushAsync(params: {
  origin: string;
  scope: FeedScope;
  triggerSource?: FeedTriggerSource;
  providerKeys?: string[];
}): Promise<FeedPushStartResult> {
  // Per-scope lock: stock/price/master can run in parallel (Galaxus accepts all 4 SFTP files).
  const locked = await withAdvisoryXactLock(feedPushLockKey(params.scope), async () => {
    const active = await getActiveFeedRun(params.scope);
    if (active) {
      const queued = await enqueueFeedPushTrigger({
        scope: params.scope,
        triggerSource: params.triggerSource,
      });
      return {
        ok: true,
        queued: true,
        runId: active.runId,
        triggerId: queued.triggerId,
        status: 202,
      };
    }

    return beginAsyncFeedRun(params);
  });

  if (!locked.locked) {
    const queued = await enqueueFeedPushTrigger({
      scope: params.scope,
      triggerSource: params.triggerSource,
    });
    return {
      ok: true,
      queued: true,
      triggerId: queued.triggerId,
      status: 202,
    };
  }
  return locked.result;
}

/**
 * Start the oldest pending feed push when no run is active.
 * Called after each async feed completes and safe to invoke from cron/tick.
 */
async function tryStartPendingFeedPush(
  origin: string,
  pending: { id: string; scope: string; triggerSource: string | null }
): Promise<FeedPushStartResult | null> {
  const scope = pending.scope as FeedScope;
  const locked = await withAdvisoryXactLock(feedPushLockKey(scope), async () => {
    const active = await getActiveFeedRun(scope);
    if (active) return null;

    const prismaAny = prisma as any;
    const row = await prismaAny.galaxusFeedTrigger.findUnique({
      where: { id: pending.id },
      select: { status: true },
    });
    if (!row || row.status !== "PENDING") return null;

    await prismaAny.galaxusFeedTrigger.update({
      where: { id: pending.id },
      data: { status: "RUNNING", consumedAt: new Date() },
    });

    return beginAsyncFeedRun({
      origin,
      scope,
      triggerSource: (pending.triggerSource as FeedTriggerSource) ?? "unknown",
      feedTriggerId: pending.id,
    });
  });

  if (!locked.locked) return null;
  return locked.result ?? null;
}

export async function drainFeedPushQueue(
  origin: string
): Promise<FeedPushStartResult | { ok: true; drained: false }> {
  const prismaAny = prisma as any;
  const pendingRows: Array<{ id: string; scope: string; triggerSource: string | null }> =
    await prismaAny.galaxusFeedTrigger.findMany({
      where: { status: "PENDING" },
      orderBy: { requestedAt: "asc" },
    });
  if (!pendingRows.length) return { ok: true, drained: false };

  pendingRows.sort((a, b) => {
    if (a.scope === "master-specs" && b.scope !== "master-specs") return -1;
    if (b.scope === "master-specs" && a.scope !== "master-specs") return 1;
    return 0;
  });

  const seenScopes = new Set<string>();
  let lastStarted: FeedPushStartResult | null = null;
  for (const pending of pendingRows) {
    if (seenScopes.has(pending.scope)) continue;
    seenScopes.add(pending.scope);
    const started = await tryStartPendingFeedPush(origin, pending);
    if (started) lastStarted = started;
  }

  if (!lastStarted) return { ok: true, drained: false };
  return { ...lastStarted, drained: true };
}

/**
 * Partner catalog edits used to call this with scope=full + runNow in the same HTTP
 * request. That path dynamic-imports the SFTP upload route mid-request and dies with
 * "cannot be imported from a Client Component module" in ~300ms.
 *
 * Partner/admin side-effects → async stock-price push (same path as manual ops buttons).
 */
export async function requestFeedPush(params: {
  origin: string;
  scope: FeedScope;
  triggerSource: FeedTriggerSource;
  runNow?: boolean;
}) {
  const { origin, triggerSource, runNow = true } = params;
  const isPartnerSideEffect =
    triggerSource === "partner-admin" ||
    triggerSource === "partner-order-fulfilled" ||
    triggerSource === "partner-shipment-fulfilled" ||
    triggerSource === "partner-sync";

  // Heavy full catalog rebuild must not run inline on partner API requests.
  const scope: FeedScope =
    isPartnerSideEffect && params.scope === "full" ? "stock-price" : params.scope;

  if (runNow && isPartnerSideEffect) {
    return startFeedPushAsync({ origin, scope, triggerSource });
  }

  const queued = await enqueueFeedPushTrigger({ scope, triggerSource });
  if (runNow) {
    const drained = await drainFeedPushQueue(origin);
    if ("accepted" in drained && drained.accepted) return drained;
    if ("queued" in drained && drained.queued) return drained;
    return { ok: true, queued: true, triggerId: queued.triggerId };
  }
  return { ok: true, queued: true, triggerId: queued.triggerId };
}

/** @deprecated Prefer {@link drainFeedPushQueue} — kept for legacy callers. */
export async function runPendingFeedTriggers(params: { origin: string; scope: FeedScope }) {
  const drained = await drainFeedPushQueue(params.origin);
  if ("drained" in drained && !drained.drained) {
    return { ok: true, skipped: "no_pending_or_busy" as const };
  }
  return drained;
}
