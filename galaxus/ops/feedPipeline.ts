import { prisma } from "@/app/lib/prisma";
import { randomUUID } from "crypto";
import { withAdvisoryLock } from "@/galaxus/jobs/advisoryLock";
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

const STALE_FEED_RUN_MS = 4 * 60 * 60 * 1000;

async function callFeedUpload(origin: string, scope: FeedScope, manual: boolean) {
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
  const url = `${origin}/api/galaxus/feeds/upload?type=${type}${manualParam}`;
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
  const cutoff = new Date(Date.now() - maxAgeMs);
  await (prisma as any).galaxusFeedRun.updateMany({
    where: { finishedAt: null, startedAt: { lt: cutoff } },
    data: {
      finishedAt: new Date(),
      success: false,
      errorMessage: "Stale feed run timed out",
    },
  });
}

export async function getActiveFeedRun() {
  await reconcileStaleFeedRuns();
  return (prisma as any).galaxusFeedRun.findFirst({
    where: { finishedAt: null },
    orderBy: { startedAt: "desc" },
  });
}

async function executeFeedRun(params: {
  feedRunId: string;
  runId: string;
  origin: string;
  scope: FeedScope;
  triggerSource?: FeedTriggerSource;
}): Promise<FeedRunResult> {
  const { feedRunId, origin, scope, triggerSource } = params;
  let effectiveRunId = params.runId;
  let counts: Record<string, number | null> | undefined;
  let uploaded: Array<{ name: string; path: string; size: number }> | undefined;
  let error: string | undefined;

  if (GALAXUS_FEED_UPLOADS_DISABLED) {
    error = "Feed uploads are disabled";
  } else {
    try {
      const data = await callFeedUpload(origin, scope, triggerSource === "manual");
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
}): Promise<FeedRunResult> {
  const { origin, scope, triggerSource } = params;
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
  });
}

export async function startFeedPushAsync(params: {
  origin: string;
  scope: FeedScope;
  triggerSource?: FeedTriggerSource;
}): Promise<{ ok: boolean; accepted?: boolean; runId?: string; error?: string; status?: number }> {
  const locked = await withAdvisoryLock("galaxus:feed-push", async () => {
    const active = await getActiveFeedRun();
    if (active) {
      return {
        ok: false,
        error: "A feed push is already running",
        runId: active.runId,
        status: 409,
      };
    }

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

    void executeFeedRun({
      feedRunId: feedRun.id,
      runId,
      origin: params.origin,
      scope: params.scope,
      triggerSource: params.triggerSource,
    }).catch((err) => {
      console.error("[GALAXUS][FEED][ASYNC] Background push failed:", err);
    });

    return { ok: true, accepted: true, runId };
  });

  if (!locked.locked) {
    return { ok: false, error: "Feed push lock busy — try again", status: 409 };
  }
  return locked.result;
}

export async function requestFeedPush(params: {
  origin: string;
  scope: FeedScope;
  triggerSource: FeedTriggerSource;
  runNow?: boolean;
}) {
  const { origin, scope, triggerSource, runNow = true } = params;
  const prismaAny = prisma as any;
  const existing = await prismaAny.galaxusFeedTrigger.findFirst({
    where: { scope, status: "PENDING" },
    orderBy: { requestedAt: "asc" },
  });
  if (!existing) {
    await prismaAny.galaxusFeedTrigger.create({
      data: { scope, triggerSource },
    });
  }
  if (runNow) {
    return runPendingFeedTriggers({ origin, scope });
  }
  return { ok: true, queued: true };
}

export async function runPendingFeedTriggers(params: { origin: string; scope: FeedScope }) {
  const { origin, scope } = params;
  const lockName = `galaxus:ops:feed:${scope}`;
  const locked = await withAdvisoryLock(lockName, async () => {
    const prismaAny = prisma as any;
    const pending: Array<{ id: string; triggerSource: string | null }> = await prismaAny.$queryRaw`
      SELECT "id", "triggerSource"
      FROM "public"."GalaxusFeedTrigger"
      WHERE "scope" = ${scope} AND "status" = 'PENDING'
      ORDER BY "requestedAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;
    if (!pending || pending.length === 0) {
      return { ok: true, skipped: "no_pending" };
    }
    const trigger = pending[0];
    await prismaAny.galaxusFeedTrigger.update({
      where: { id: trigger.id },
      data: { status: "RUNNING", consumedAt: new Date() },
    });
    const result = await runFeedPipeline({
      origin,
      scope,
      triggerSource: (trigger.triggerSource as FeedTriggerSource) ?? "unknown",
    });
    await prismaAny.galaxusFeedTrigger.update({
      where: { id: trigger.id },
      data: { status: result.ok ? "DONE" : "FAILED" },
    });
    return result;
  });

  if (!locked.locked) {
    return { ok: true, skipped: "locked" };
  }
  return locked.result;
}
