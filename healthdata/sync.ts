import { TRANSFORM_VERSION } from "@/healthdata/config";
import type { HealthProvider } from "@/healthdata/providers/types";
import {
  mergeDailyFromHealth,
  recomputeDailyWindow,
  touchAccountSync,
  upsertActivity,
  upsertBody,
  upsertRawEvent,
  upsertSleep,
} from "@/healthdata/repository";
import type { DateRange, IntegrationAccountRef, RawProviderBatch } from "@/healthdata/types";

export type SyncStats = {
  received: number;
  upserted: number;
  ignored: number;
  normalized: number;
  errors: number;
  minDate: string | null;
  maxDate: string | null;
};

function emptyStats(): SyncStats {
  return {
    received: 0,
    upserted: 0,
    ignored: 0,
    normalized: 0,
    errors: 0,
    minDate: null,
    maxDate: null,
  };
}

function noteDate(stats: SyncStats, iso: string | null | undefined): void {
  if (!iso) return;
  const d = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
  if (!stats.minDate || d < stats.minDate) stats.minDate = d;
  if (!stats.maxDate || d > stats.maxDate) stats.maxDate = d;
}

async function ingestBatch(
  provider: HealthProvider,
  account: IntegrationAccountRef,
  batch: RawProviderBatch,
  syncRunId: string | null,
  stats: SyncStats
): Promise<void> {
  for (const rec of batch.records) {
    stats.received += 1;
    try {
      const rawResult = await upsertRawEvent({
        provider: provider.id,
        providerUserId: account.providerUserId,
        providerRecordId: rec.providerRecordId,
        resourceType: batch.resourceType,
        sourceUpdatedAt: rec.sourceUpdatedAt,
        occurredAt: rec.occurredAt,
        payload: rec.payload,
        transformVersion: TRANSFORM_VERSION,
        syncRunId,
      });
      if (rawResult === "ignored") {
        stats.ignored += 1;
        continue;
      }
      stats.upserted += 1;

      const base = {
        resourceType: batch.resourceType,
        payload: rec.payload,
        providerUserId: account.providerUserId,
        providerRecordId: rec.providerRecordId,
        sourceUpdatedAt: rec.sourceUpdatedAt,
      };

      if (provider.normalizeSleep) {
        for (const sleep of provider.normalizeSleep(base)) {
          await upsertSleep(sleep);
          stats.normalized += 1;
          noteDate(stats, sleep.localDate);
        }
      }

      for (const act of provider.normalizeActivities(base)) {
        await upsertActivity(act);
        stats.normalized += 1;
        noteDate(stats, act.localDate);
      }

      for (const health of provider.normalizeHealthData(base)) {
        await mergeDailyFromHealth(health);
        stats.normalized += 1;
        noteDate(stats, health.localDate);
      }

      if (provider.normalizeBody) {
        for (const body of provider.normalizeBody(base)) {
          await upsertBody(body);
          stats.normalized += 1;
          noteDate(stats, body.localDate);
        }
      }

      if (rec.occurredAt) noteDate(stats, rec.occurredAt.toISOString());
    } catch {
      stats.errors += 1;
    }
  }
}

export async function runProviderSync(input: {
  provider: HealthProvider;
  account: IntegrationAccountRef;
  mode: "backfill" | "incremental";
  range: DateRange;
  syncRunId: string | null;
}): Promise<SyncStats> {
  const stats = emptyStats();
  const iter =
    input.mode === "backfill"
      ? input.provider.backfill(input.account, input.range)
      : input.provider.incrementalSync(input.account, input.range.from);

  for await (const batch of iter) {
    await ingestBatch(input.provider, input.account, batch, input.syncRunId, stats);
  }

  if (stats.minDate && stats.maxDate) {
    await recomputeDailyWindow(stats.minDate, stats.maxDate);
  }

  await touchAccountSync(
    input.account.id,
    input.range.to,
    stats.errors > 0 ? `${stats.errors} record errors` : null
  );

  return stats;
}
