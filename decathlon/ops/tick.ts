import { withAdvisoryLock } from "@/galaxus/jobs/advisoryLock";
import { runDecathlonOpsJob } from "./jobRunner";
import { listDecathlonJobDefinitions, updateDecathlonJobDefinition } from "./jobDefinitions";
import type { DecathlonOpsJobKey } from "./types";
import { runDecathlonOfferSync, runDecathlonPriceSync, runDecathlonStockSync } from "@/decathlon/mirakl/sync";

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

async function executeJob(jobKey: DecathlonOpsJobKey) {
  if (jobKey === "decathlon-offer-sync") {
    return runDecathlonOpsJob(jobKey, async () => runDecathlonOfferSync());
  }
  if (jobKey === "decathlon-stock-sync") {
    return runDecathlonOpsJob(jobKey, async () => runDecathlonStockSync());
  }
  if (jobKey === "decathlon-price-sync") {
    return runDecathlonOpsJob(jobKey, async () => runDecathlonPriceSync());
  }
  throw new Error(`Unknown jobKey ${jobKey}`);
}

export async function runDecathlonOpsTick(origin: string, options?: { force?: boolean; only?: string[] }) {
  const now = new Date();
  const only = new Set((options?.only ?? []).map((s) => s.trim()).filter(Boolean));
  const isOnly = only.size > 0;
  const force = Boolean(options?.force);
  const defs = await listDecathlonJobDefinitions();
  const results: Record<string, TickJobResult> = {};

  for (const def of defs) {
    const jobKey = def.jobKey as DecathlonOpsJobKey;
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

    const locked = await withAdvisoryLock(`decathlon:ops:${jobKey}`, async () => {
      const res = await executeJob(jobKey);
      const nextRunAt = buildNextAt(now, def.intervalMs);
      await updateDecathlonJobDefinition(jobKey, {
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

  return { ok: true, origin, now: now.toISOString(), jobs: results };
}
