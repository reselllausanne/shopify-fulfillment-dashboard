import {
  FEED_SNAPSHOT_REBUILD_JOB,
  getFeedSnapshotMeta,
  isFeedSnapshotReady,
  startFeedSnapshotRebuildAsync,
} from "@/galaxus/exports/feedSnapshot";
import { prisma } from "@/app/lib/prisma";

/**
 * While the Galaxus feed snapshot is invalid (failed/killed nightly rebuild, deploy restart, rules bump),
 * every push falls back to the live full-catalog export: ~0.8 GB read from Supabase per run (egress $) and
 * IO-heavy. Before this watchdog an invalid snapshot stayed dead until the next 02:00 UTC cron.
 *
 * Re-arms a rebuild when ALL hold:
 * - snapshot not ready for stock/offer
 * - invalid for at least GRACE_MS (lets the nightly cron / an in-flight rebuild settle)
 * - no rebuild run in flight (finishedAt === startedAt, started < RUNNING_WINDOW_MS ago)
 * - last rebuild attempt started more than MIN_RETRY_MS ago
 * - fewer than MAX_ATTEMPTS_PER_DAY attempts in the last 24h
 * enqueueOpsBackgroundJob additionally dedupes against an already queued/running job.
 */
export const SNAPSHOT_WATCHDOG_GRACE_MS = 20 * 60 * 1000;
export const SNAPSHOT_WATCHDOG_MIN_RETRY_MS = 30 * 60 * 1000;
export const SNAPSHOT_WATCHDOG_RUNNING_WINDOW_MS = 6 * 60 * 60 * 1000;
export const SNAPSHOT_WATCHDOG_MAX_ATTEMPTS_PER_DAY = 4;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

let lastCheckAtMs = 0;

type RebuildRunRow = { startedAt: Date | string; finishedAt: Date | string | null };

export type SnapshotWatchdogResult =
  | { action: "skipped"; reason: string }
  | { action: "enqueued" }
  | { action: "enqueue_refused"; error?: string };

export async function ensureFeedSnapshotRebuild(options: {
  origin: string;
  nowMs?: number;
  force?: boolean;
}): Promise<SnapshotWatchdogResult> {
  const nowMs = options.nowMs ?? Date.now();
  if (!options.force && nowMs - lastCheckAtMs < CHECK_INTERVAL_MS) {
    return { action: "skipped", reason: "throttled" };
  }
  lastCheckAtMs = nowMs;

  const [stockReady, offerReady] = await Promise.all([
    isFeedSnapshotReady("stock"),
    isFeedSnapshotReady("offer"),
  ]);
  if (stockReady && offerReady) return { action: "skipped", reason: "snapshot_ready" };

  const meta = await getFeedSnapshotMeta();
  const metaUpdatedMs = meta?.updatedAt ? new Date(meta.updatedAt).getTime() : 0;
  if (metaUpdatedMs && nowMs - metaUpdatedMs < SNAPSHOT_WATCHDOG_GRACE_MS) {
    return { action: "skipped", reason: "grace" };
  }

  const since = new Date(nowMs - 24 * 60 * 60 * 1000);
  const runs: RebuildRunRow[] = await (prisma as any).galaxusJobRun.findMany({
    where: { jobName: FEED_SNAPSHOT_REBUILD_JOB, startedAt: { gte: since } },
    orderBy: { startedAt: "desc" },
    select: { startedAt: true, finishedAt: true },
  });

  const latest = runs[0];
  if (latest) {
    const startedMs = new Date(latest.startedAt).getTime();
    const finishedMs = latest.finishedAt ? new Date(latest.finishedAt).getTime() : startedMs;
    const inFlight = finishedMs <= startedMs && nowMs - startedMs < SNAPSHOT_WATCHDOG_RUNNING_WINDOW_MS;
    if (inFlight) return { action: "skipped", reason: "rebuild_in_flight" };
    if (nowMs - startedMs < SNAPSHOT_WATCHDOG_MIN_RETRY_MS) {
      return { action: "skipped", reason: "recent_attempt" };
    }
  }
  if (runs.length >= SNAPSHOT_WATCHDOG_MAX_ATTEMPTS_PER_DAY) {
    return { action: "skipped", reason: "daily_cap" };
  }

  const started = await startFeedSnapshotRebuildAsync(options.origin);
  if (!started.ok) return { action: "enqueue_refused", error: started.error };
  return { action: "enqueued" };
}

/** Test helper. */
export function __resetSnapshotWatchdogThrottle() {
  lastCheckAtMs = 0;
}
