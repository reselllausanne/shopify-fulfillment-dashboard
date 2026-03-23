import { withAdvisoryLock } from "@/galaxus/jobs/advisoryLock";
import { runOpsJob } from "./jobRunner";
import { listJobDefinitions, updateJobDefinition } from "./jobDefinitions";
import { runPartnerSync } from "@/galaxus/jobs/partnerSync";
import { runStxPriceStockRefresh } from "@/galaxus/jobs/stxSync";
import { runFeedPipeline } from "./feedPipeline";
import { runEdiInPipeline } from "./orderPipeline";
import { runImageSync } from "@/galaxus/jobs/imageSync";
import type { OpsJobKey } from "./types";

type TickJobResult = {
  due: boolean;
  ran: boolean;
  skipped?: "disabled" | "not_due" | "locked";
  lastError?: string | null;
  result?: unknown;
  nextAt?: string | null;
};

const buildNextAt = (lastRunAt: Date | null, intervalMs: number) => {
  const base = lastRunAt ?? new Date();
  return new Date(base.getTime() + intervalMs);
};

async function runPartnerSyncAll() {
  const batchSize = 1000;
  let offset = 0;
  let lastProcessed = 0;
  let totals = {
    processed: 0,
    created: 0,
    updated: 0,
    skippedInvalid: 0,
    removedZeroStock: 0,
    mappingInserted: 0,
    mappingUpdated: 0,
  };

  do {
    const res = await runPartnerSync({ limit: batchSize, offset });
    lastProcessed = res.processed ?? 0;
    totals = {
      processed: totals.processed + (res.processed ?? 0),
      created: totals.created + (res.created ?? 0),
      updated: totals.updated + (res.updated ?? 0),
      skippedInvalid: totals.skippedInvalid + (res.skippedInvalid ?? 0),
      removedZeroStock: totals.removedZeroStock + (res.removedZeroStock ?? 0),
      mappingInserted: totals.mappingInserted + (res.mappingInserted ?? 0),
      mappingUpdated: totals.mappingUpdated + (res.mappingUpdated ?? 0),
    };
    offset += batchSize;
  } while (lastProcessed === batchSize);

  return totals;
}

async function executeJob(jobKey: OpsJobKey, origin: string) {
  if (jobKey === "partner-stock-sync") {
    const result = await runOpsJob(jobKey, async () => runPartnerSyncAll());
    if (result.success) {
      await runFeedPipeline({ origin, scope: "stock-price", triggerSource: "partner-sync" });
    }
    return result;
  }
  if (jobKey === "stx-refresh") {
    const result = await runOpsJob(jobKey, async () => runStxPriceStockRefresh());
    if (result.success) {
      await runFeedPipeline({ origin, scope: "stock-price", triggerSource: "stx-refresh" });
    }
    return result;
  }
  if (jobKey === "edi-in") {
    return runOpsJob(jobKey, async () => runEdiInPipeline());
  }
  if (jobKey === "image-sync") {
    const result = await runOpsJob(jobKey, async () =>
      runImageSync({
        limit: 2000,
        concurrency: 8,
      })
    );
    const summary = result.result as { synced?: number; updatedSource?: number } | undefined;
    if (result.success && ((summary?.synced ?? 0) > 0 || (summary?.updatedSource ?? 0) > 0)) {
      await runFeedPipeline({ origin, scope: "full", triggerSource: "image-sync" });
    }
    return result;
  }
  throw new Error(`Unknown jobKey ${jobKey}`);
}

export async function runOpsTick(origin: string, options?: { force?: boolean; only?: string[] }) {
  const now = new Date();
  const only = new Set((options?.only ?? []).map((s) => s.trim()).filter(Boolean));
  const isOnly = only.size > 0;
  const force = Boolean(options?.force);
  const defs = await listJobDefinitions();
  const results: Record<string, TickJobResult> = {};

  for (const def of defs) {
    const jobKey = def.jobKey as OpsJobKey;
    const shouldConsider = isOnly ? only.has(jobKey) : true;
    if (!shouldConsider) continue;

    if (!def.enabled) {
      results[jobKey] = { due: false, ran: false, skipped: "disabled", nextAt: def.nextRunAt ?? null };
      continue;
    }

    const nextAt = def.nextRunAt ? new Date(def.nextRunAt) : buildNextAt(def.lastRunAt, def.intervalMs);
    const due = force || now >= nextAt;
    if (!due) {
      results[jobKey] = { due: false, ran: false, skipped: "not_due", nextAt: nextAt.toISOString() };
      continue;
    }

    const locked = await withAdvisoryLock(`galaxus:ops:${jobKey}`, async () => {
      const res = await executeJob(jobKey, origin);
      const nextRunAt = buildNextAt(now, def.intervalMs);
      await updateJobDefinition(jobKey, {
        lastRunAt: now,
        nextRunAt,
        lastError: res.success ? null : res.error ?? null,
      });
      return res;
    });

    if (!locked.locked) {
      results[jobKey] = { due: true, ran: false, skipped: "locked", nextAt: nextAt.toISOString() };
      continue;
    }

    results[jobKey] = {
      due: true,
      ran: true,
      lastError: locked.result?.success ? null : locked.result?.error ?? null,
      result: locked.result?.result ?? locked.result,
      nextAt: buildNextAt(now, def.intervalMs).toISOString(),
    };
  }

  return { ok: true, now: now.toISOString(), jobs: results };
}
