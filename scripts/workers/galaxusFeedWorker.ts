#!/usr/bin/env npx tsx
/**
 * Dedicated Galaxus feed executor — full catalog export + SFTP off the web container.
 *
 * Web sets GALAXUS_FEED_RUN_ON=worker and only enqueues triggers. This worker drains
 * the queue, runs exports with a large heap, and finalizes triggers when done.
 *
 * Drains every tick even when a feed is already running: locks are per-scope, so
 * stock/price/master-specs can run in parallel. Gating on "any active run" used to
 * leave PENDING triggers stuck behind a single zombie for hours.
 *
 * Env:
 *   GALAXUS_FEED_WORKER=1            required (marks this process as executor)
 *   GALAXUS_FEED_RUN_ON=worker       same as web
 *   GALAXUS_FEED_WORKER_POLL_MS      default 30000
 *   GALAXUS_FEED_WORKER_ORIGIN       default http://127.0.0.1:3000
 *   GALAXUS_FEED_STALE_MINUTES       default 45 (reap zombie runs each tick)
 */
import { resolveAppOriginForPartnerJobs } from "@/app/lib/partnerJobOrigin";
import {
  activeFeedRunCount,
  awaitActiveFeedRuns,
  coalesceDuplicatePendingTriggers,
  countPendingFeedPushTriggers,
  drainFeedPushQueue,
  getActiveFeedRun,
  reconcileStaleFeedRuns,
  reconcileStaleFeedTriggers,
  recoverFeedRunsAfterExecutorRestart,
} from "@/galaxus/ops/feedPipelineCore";

const POLL_MS = Number(process.env.GALAXUS_FEED_WORKER_POLL_MS ?? 30_000);
const STALE_MINUTES = Number(process.env.GALAXUS_FEED_STALE_MINUTES ?? 45);
// On SIGTERM (deploy recreate) finish the in-flight build before exiting, up to this budget.
// Must be < compose stop_grace_period or docker SIGKILLs us mid-drain. Default 25min.
const DRAIN_MS = Number(process.env.GALAXUS_FEED_WORKER_DRAIN_MS ?? 25 * 60_000);

/** Set by SIGTERM/SIGINT: stop starting new runs, let the current one finish. */
let draining = false;
const ORIGIN =
  resolveAppOriginForPartnerJobs(process.env.GALAXUS_FEED_WORKER_ORIGIN) ??
  "http://127.0.0.1:3000";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tick() {
  // While draining, don't start new pending triggers — just let the active run finish.
  if (draining) return;
  const startedAt = new Date().toISOString();
  if (Number.isFinite(STALE_MINUTES) && STALE_MINUTES > 0) {
    await reconcileStaleFeedRuns(STALE_MINUTES * 60 * 1000);
  } else {
    await reconcileStaleFeedRuns();
  }
  await reconcileStaleFeedTriggers();
  const coalesced = await coalesceDuplicatePendingTriggers().catch(() => 0);
  const pendingBefore = await countPendingFeedPushTriggers();
  // Always drain: tryStartPendingFeedPush skips scopes that already have an active run.
  const drained = await drainFeedPushQueue(ORIGIN);
  const active = await getActiveFeedRun();
  const pendingAfter = await countPendingFeedPushTriggers();
  console.info("[WORKER][GALAXUS_FEED] tick", {
    startedAt,
    origin: ORIGIN,
    activeRunId: active?.runId ?? null,
    activeScope: active?.scope ?? null,
    pendingBefore,
    pendingAfter,
    coalesced,
    drained,
  });
}

async function main() {
  if (process.env.GALAXUS_FEED_WORKER !== "1") {
    console.error("[WORKER][GALAXUS_FEED] GALAXUS_FEED_WORKER=1 required");
    process.exitCode = 1;
    return;
  }

  console.info("[WORKER][GALAXUS_FEED] starting", {
    pollMs: POLL_MS,
    origin: ORIGIN,
    staleMinutes: STALE_MINUTES,
    nodeHeapMb: process.env.NODE_OPTIONS ?? "(default)",
  });

  try {
    const recovered = await recoverFeedRunsAfterExecutorRestart();
    if (recovered.closedRuns > 0) {
      console.warn("[WORKER][GALAXUS_FEED] recovered runs from previous process", recovered);
      if (recovered.hardStoppedScopes.length > 0) {
        console.error(
          "[WORKER][GALAXUS_FEED] crash-loop hard-stop — scopes NOT requeued",
          recovered.hardStoppedScopes
        );
      }
    }
  } catch (err: unknown) {
    console.error(
      "[WORKER][GALAXUS_FEED] crash recovery failed",
      err instanceof Error ? err.message : err
    );
  }

  let shutdown: ((signal: string) => void) | null = null;
  const stopped = new Promise<string>((resolve) => {
    shutdown = (signal: string) => resolve(signal);
  });
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => {
      if (draining) return;
      draining = true;
      console.warn("[WORKER][GALAXUS_FEED] drain requested", {
        signal: sig,
        activeRuns: activeFeedRunCount(),
        drainBudgetMs: DRAIN_MS,
      });
      shutdown?.(sig);
    });
  }

  while (!draining) {
    try {
      await tick();
    } catch (err: unknown) {
      console.error("[WORKER][GALAXUS_FEED] tick failed", err instanceof Error ? err.message : err);
    }
    // Wake early if a shutdown signal arrives mid-sleep.
    await Promise.race([sleep(POLL_MS), stopped]);
  }

  // Graceful drain: let the in-flight build finish (and populate the snapshot) so a deploy's
  // container recreate no longer tears down a half-built feed into the "crash recovery" loop.
  const t0 = Date.now();
  const clean = await awaitActiveFeedRuns(DRAIN_MS);
  console.warn("[WORKER][GALAXUS_FEED] drain complete", {
    clean,
    waitedMs: Date.now() - t0,
    remainingRuns: activeFeedRunCount(),
  });
  process.exit(0);
}

main().catch((err) => {
  console.error("[WORKER][GALAXUS_FEED] fatal", err);
  process.exitCode = 1;
});
