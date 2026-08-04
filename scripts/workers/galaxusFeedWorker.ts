#!/usr/bin/env npx tsx
/**
 * Dedicated Galaxus feed executor — full catalog export + SFTP off the web container.
 *
 * Web sets GALAXUS_FEED_RUN_ON=worker and only enqueues triggers. This worker drains
 * the queue, runs exports with a large heap, and finalizes triggers when done.
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
  coalesceDuplicatePendingTriggers,
  countPendingFeedPushTriggers,
  drainFeedPushQueue,
  getActiveFeedRun,
  reconcileStaleFeedRuns,
  reconcileStaleFeedTriggers,
} from "@/galaxus/ops/feedPipelineCore";

const POLL_MS = Number(process.env.GALAXUS_FEED_WORKER_POLL_MS ?? 30_000);
const STALE_MINUTES = Number(process.env.GALAXUS_FEED_STALE_MINUTES ?? 45);
const ORIGIN =
  resolveAppOriginForPartnerJobs(process.env.GALAXUS_FEED_WORKER_ORIGIN) ??
  "http://127.0.0.1:3000";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tick() {
  const startedAt = new Date().toISOString();
  if (Number.isFinite(STALE_MINUTES) && STALE_MINUTES > 0) {
    await reconcileStaleFeedRuns(STALE_MINUTES * 60 * 1000);
  } else {
    await reconcileStaleFeedRuns();
  }
  await reconcileStaleFeedTriggers();
  const coalesced = await coalesceDuplicatePendingTriggers().catch(() => 0);
  const pendingBefore = await countPendingFeedPushTriggers();
  const active = await getActiveFeedRun();
  let drained: Awaited<ReturnType<typeof drainFeedPushQueue>> | null = null;

  if (!active) {
    drained = await drainFeedPushQueue(ORIGIN);
  }

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

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await tick();
    } catch (err: unknown) {
      console.error("[WORKER][GALAXUS_FEED] tick failed", err instanceof Error ? err.message : err);
    }
    await sleep(POLL_MS);
  }
}

main().catch((err) => {
  console.error("[WORKER][GALAXUS_FEED] fatal", err);
  process.exitCode = 1;
});
