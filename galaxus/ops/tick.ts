import { withAdvisoryLock } from "@/galaxus/jobs/advisoryLock";
import { runOpsJob } from "./jobRunner";
import { listJobDefinitions, updateJobDefinition } from "./jobDefinitions";
import { runPartnerSync } from "@/galaxus/jobs/partnerSync";
import { runStxPriceStockRefresh, runStxSync } from "@/galaxus/jobs/stxSync";
import { runEdiInPipeline } from "./orderPipeline";
import { runImageSync } from "@/galaxus/jobs/imageSync";
import type { OpsJobKey } from "./types";
import { runInventoryReconciliation, runMultiChannelStockSync } from "@/inventory/sync";
import { runShopifyOrdersSync } from "@/shopify/orders/sync";

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

async function runPartnerSyncAll(partnerKey?: string) {
  const batchSize = 1000;
  let offset = 0;
  let lastScanned = 0;
  let totals = {
    scanned: 0,
    processed: 0,
    created: 0,
    updated: 0,
    skippedInvalid: 0,
    removedZeroStock: 0,
    mappingInserted: 0,
    mappingUpdated: 0,
  };

  do {
    const res = await runPartnerSync({ limit: batchSize, offset, partnerKey });
    lastScanned = res.scanned ?? 0;
    totals = {
      scanned: totals.scanned + (res.scanned ?? 0),
      processed: totals.processed + (res.processed ?? 0),
      created: totals.created + (res.created ?? 0),
      updated: totals.updated + (res.updated ?? 0),
      skippedInvalid: totals.skippedInvalid + (res.skippedInvalid ?? 0),
      removedZeroStock: totals.removedZeroStock + (res.removedZeroStock ?? 0),
      mappingInserted: totals.mappingInserted + (res.mappingInserted ?? 0),
      mappingUpdated: totals.mappingUpdated + (res.mappingUpdated ?? 0),
    };
    offset += batchSize;
  } while (lastScanned === batchSize);

  return totals;
}

export type OpsTickOptions = {
  force?: boolean;
  only?: string[];
  /** `price` = KickDB fetch + bulk price/stock update (default). `full` = runStxSync (inserts + mappings + cleanup). */
  stxRefreshMode?: "price" | "full";
  /** `full` = loop image batches until backlog empty. Default = single 2000-row batch. */
  imageSyncMode?: "batch" | "full";
  partnerKey?: string;
};

async function executeJob(jobKey: OpsJobKey, origin: string, tickOptions?: OpsTickOptions) {
  if (jobKey === "partner-stock-sync") {
    return runOpsJob(jobKey, async () => runPartnerSyncAll(tickOptions?.partnerKey));
  }
  if (jobKey === "stx-refresh") {
    const mode = tickOptions?.stxRefreshMode === "full" ? "full" : "price";
    return runOpsJob(jobKey, async () =>
      mode === "full" ? runStxSync() : runStxPriceStockRefresh()
    );
  }
  if (jobKey === "edi-in") {
    return runOpsJob(jobKey, async () => runEdiInPipeline());
  }
  if (jobKey === "image-sync") {
    const full = tickOptions?.imageSyncMode === "full";
    return runOpsJob(jobKey, async () =>
      runImageSync({
        limit: 2000,
        concurrency: 8,
        supplierKeys: ["stx", "the"],
        ...(full ? { full: true } : {}),
      })
    );
  }
  if (jobKey === "shopify-order-sync") {
    return runOpsJob(jobKey, async () => runShopifyOrdersSync({ pageSize: 100 }));
  }
  if (jobKey === "multichannel-stock-sync") {
    return runOpsJob(jobKey, async () =>
      runMultiChannelStockSync({
        origin,
        dryRun: false,
      })
    );
  }
  if (jobKey === "inventory-reconcile") {
    return runOpsJob(jobKey, async () =>
      runInventoryReconciliation({
        limit: 3000,
      })
    );
  }
  throw new Error(`Unknown jobKey ${jobKey}`);
}

export async function runOpsTick(origin: string, options?: OpsTickOptions) {
  const now = new Date();
  const only = new Set((options?.only ?? []).map((s) => s.trim()).filter(Boolean));
  const isOnly = only.size > 0;
  const force = Boolean(options?.force);
  /** Manual “run this job only” from ops UI: skip pg advisory lock so a second run the same day is not blocked. */
  const skipAdvisoryLock = force && isOnly && only.size === 1;
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

    // Important: do NOT update job definition inside the advisory-lock transaction.
    // With low `connection_limit` in local dev, the transaction can keep the single
    // connection busy and cause pool timeouts on the later UPDATE.
    let res: Awaited<ReturnType<typeof executeJob>>;
    if (skipAdvisoryLock) {
      res = await executeJob(jobKey, origin, options);
    } else {
      const locked = await withAdvisoryLock(`galaxus:ops:${jobKey}`, async () =>
        executeJob(jobKey, origin, options)
      );

      if (!locked.locked) {
        results[jobKey] = { due: true, ran: false, skipped: "locked", nextAt: nextAt.toISOString() };
        continue;
      }
      res = locked.result;
    }
    const nextRunAt = buildNextAt(now, def.intervalMs);
    try {
      await updateJobDefinition(jobKey, {
        lastRunAt: now,
        nextRunAt,
        lastError: res.success ? null : res.error ?? null,
      });
    } catch (e) {
      console.error(`[galaxus][ops][tick] failed to update job definition`, { jobKey, error: e });
      // Don't fail the whole tick if we can't persist audit data.
    }

    results[jobKey] = {
      due: true,
      ran: true,
      lastError: res?.success ? null : res?.error ?? null,
      result: res?.result ?? res,
      nextAt: buildNextAt(now, def.intervalMs).toISOString(),
    };
  }

  return { ok: true, now: now.toISOString(), jobs: results };
}
