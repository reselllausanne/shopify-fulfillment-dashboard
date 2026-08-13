import { Prisma } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import { resolveAdsConfig, type AdsConfig } from "@/adsanalytics/config";
import {
  addDays,
  defaultEndDate,
  monthKey,
  resolveDateRange,
  splitIntoMonths,
  type DateRange,
} from "@/adsanalytics/dates";
import { searchRows } from "@/adsanalytics/google/adsClient";
import { campaignDailyQuery, productDailyQuery } from "@/adsanalytics/google/queries";
import { upsertCampaignDaily, upsertProductDaily } from "@/adsanalytics/repository";
import { log, logError, withSyncRun, type SyncRun } from "@/adsanalytics/run";
import { syncDailyAdSpend } from "@/adsanalytics/syncDailyAdSpend";
import { ProductAggregator, mapCampaignRow, mapProductRow } from "@/adsanalytics/transform";

/**
 * Conversions keep landing for days after the click, so a month is only
 * considered settled once its last day is older than this. Anything inside the
 * window is always re-fetched, which is what makes `backfill --days=14` the
 * daily refresh.
 */
const CONVERSION_LAG_DAYS = 14;

export type BackfillOptions = {
  days?: number;
  from?: string;
  to?: string;
  force?: boolean;
  skipCampaigns?: boolean;
  skipProducts?: boolean;
};

type MonthOutcome = {
  month: string;
  range: DateRange;
  status: "succeeded" | "failed" | "skipped";
  campaignRows?: number;
  productRowsFetched?: number;
  productKeysWritten?: number;
  duplicateKeys?: number;
  conflictingKeys?: number;
  apiRequests?: number;
  error?: string;
};

/** Months already fully ingested by an earlier run, so a rerun resumes instead of repeating. */
async function loadCompletedMonths(): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<Array<{ month: string }>>(Prisma.sql`
    SELECT DISTINCT jsonb_array_elements_text(stats_json -> 'completedMonths') AS month
    FROM "public"."ads_sync_runs"
    WHERE command = 'backfill'
      AND stats_json IS NOT NULL
      AND jsonb_exists(stats_json, 'completedMonths')
  `);
  return new Set(rows.map((row) => row.month));
}

export async function ingestCampaignMonth(config: AdsConfig, range: DateRange): Promise<{ rows: number; requests: number }> {
  const query = campaignDailyQuery(range.start, range.end);
  const buffer = [];
  // No maxRows: follow nextPageToken until exhausted.
  const iterator = searchRows(config, query);

  let next = await iterator.next();
  while (!next.done) {
    buffer.push(mapCampaignRow(next.value));
    next = await iterator.next();
  }
  const stats = next.value;

  const written = buffer.length > 0 ? await upsertCampaignDaily(buffer) : 0;
  return { rows: written, requests: stats.requests };
}

export async function ingestProductMonth(
  config: AdsConfig,
  range: DateRange
): Promise<{
  fetched: number;
  written: number;
  duplicateKeys: number;
  conflictingKeys: number;
  requests: number;
}> {
  const query = productDailyQuery(range.start, range.end);
  const aggregator = new ProductAggregator();
  // No maxRows: follow nextPageToken until exhausted (probe alone is capped).
  const iterator = searchRows(config, query);

  let next = await iterator.next();
  while (!next.done) {
    aggregator.add(mapProductRow(next.value));
    next = await iterator.next();
  }
  const stats = next.value;

  const rows = aggregator.rows();
  const report = aggregator.report();
  const written = rows.length > 0 ? await upsertProductDaily(rows) : 0;

  if (report.conflictingKeys > 0) {
    log("backfill.attribute_conflicts", {
      month: monthKey(range.start),
      conflictingKeys: report.conflictingKeys,
      examples: report.conflictExamples,
    });
  }

  return {
    fetched: report.inputRows,
    written,
    duplicateKeys: report.duplicateKeys,
    conflictingKeys: report.conflictingKeys,
    requests: stats.requests,
  };
}

export async function backfillCommand(options: BackfillOptions): Promise<number> {
  return withSyncRun("backfill", { ...options }, async (run: SyncRun) => {
    const config = resolveAdsConfig();
    const range = resolveDateRange({
      from: options.from,
      to: options.to,
      days: options.days ?? 30,
    });
    const months = splitIntoMonths(range);
    // Settled relative to "today", not the range end — historical windows are always settled.
    const settledBefore = addDays(defaultEndDate(), -CONVERSION_LAG_DAYS);
    // Explicit --from/--to always refreshes (month resume keys are not range-scoped).
    const force = options.force || Boolean(options.from && options.to);
    const alreadyDone = force ? new Set<string>() : await loadCompletedMonths();

    log("backfill.plan", {
      range,
      months: months.length,
      settledBefore,
      resumeSkips: months.filter((m) => alreadyDone.has(monthKey(m.start))).length,
    });

    const outcomes: MonthOutcome[] = [];
    const completedMonths: string[] = [];

    for (const month of months) {
      const key = monthKey(month.start);
      const settled = month.end < settledBefore;

      if (settled && alreadyDone.has(key)) {
        outcomes.push({ month: key, range: month, status: "skipped" });
        log("backfill.month_skipped", { month: key, reason: "already completed" });
        await run.setStats({ outcomes, completedMonths });
        continue;
      }

      try {
        log("backfill.month_start", { month: key, range: month, settled });

        const campaign = options.skipCampaigns
          ? { rows: 0, requests: 0 }
          : await ingestCampaignMonth(config, month);

        const product = options.skipProducts
          ? { fetched: 0, written: 0, duplicateKeys: 0, conflictingKeys: 0, requests: 0 }
          : await ingestProductMonth(config, month);

        outcomes.push({
          month: key,
          range: month,
          status: "succeeded",
          campaignRows: campaign.rows,
          productRowsFetched: product.fetched,
          productKeysWritten: product.written,
          duplicateKeys: product.duplicateKeys,
          conflictingKeys: product.conflictingKeys,
          apiRequests: campaign.requests + product.requests,
        });

        // Only a settled month is remembered; the lag window must stay refreshable.
        if (settled) completedMonths.push(key);

        log("backfill.month_done", outcomes[outcomes.length - 1] as unknown as Record<string, unknown>);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        outcomes.push({ month: key, range: month, status: "failed", error: message.slice(0, 500) });
        logError("backfill.month_failed", { month: key, message });
      }

      await run.setStats({ outcomes, completedMonths });
    }

    const failed = outcomes.filter((o) => o.status === "failed");
    const summary = {
      range,
      monthsTotal: months.length,
      monthsSucceeded: outcomes.filter((o) => o.status === "succeeded").length,
      monthsSkipped: outcomes.filter((o) => o.status === "skipped").length,
      monthsFailed: failed.length,
      campaignRows: outcomes.reduce((sum, o) => sum + (o.campaignRows ?? 0), 0),
      productKeysWritten: outcomes.reduce((sum, o) => sum + (o.productKeysWritten ?? 0), 0),
      duplicateKeys: outcomes.reduce((sum, o) => sum + (o.duplicateKeys ?? 0), 0),
      conflictingKeys: outcomes.reduce((sum, o) => sum + (o.conflictingKeys ?? 0), 0),
      apiRequests: outcomes.reduce((sum, o) => sum + (o.apiRequests ?? 0), 0),
      completedMonths,
      outcomes,
    };

    log("backfill.summary", summary);

    if (failed.length > 0) {
      // Successful months stay committed; rerunning resumes at the failed ones.
      throw new Error(
        `${failed.length}/${months.length} month(s) failed: ${failed.map((f) => f.month).join(", ")}`
      );
    }

    // Bridge campaign daily totals into DailyAdSpend for margin dashboard / monthly P&L.
    const spendSync = await syncDailyAdSpend(range);
    await run.setStats({ ...summary, spendSync });

    return { ...summary, spendSync };
  });
}
