import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { periodSnapshot } from "@/adsanalytics/commands/analyzeModels";
import type { DateRange } from "@/adsanalytics/dates";
import { stringifySafe } from "@/adsanalytics/json";
import { log, withSyncRun } from "@/adsanalytics/run";

const CURRENT: DateRange = { start: "2026-07-06", end: "2026-08-04" };
const PRIOR_MONTH: DateRange = { start: "2026-06-06", end: "2026-07-05" };
const YOY: DateRange = { start: "2025-07-06", end: "2025-08-04" };

function delta(current: number | null | undefined, baseline: number | null | undefined) {
  if (current == null || baseline == null) return null;
  const abs = Number((current - baseline).toFixed(3));
  const pct =
    baseline === 0 ? null : Number((((current - baseline) / Math.abs(baseline)) * 100).toFixed(2));
  return { abs, pct };
}

function compareMetricBlock(
  label: string,
  current: Awaited<ReturnType<typeof periodSnapshot>>,
  baseline: Awaited<ReturnType<typeof periodSnapshot>>
) {
  return {
    label,
    currentPeriod: current.range,
    baselinePeriod: baseline.range,
    spendChf: { current: current.spendChf, baseline: baseline.spendChf, delta: delta(current.spendChf, baseline.spendChf) },
    revenueChf: {
      current: current.revenueChf,
      baseline: baseline.revenueChf,
      delta: delta(current.revenueChf, baseline.revenueChf),
    },
    roas: { current: current.roas, baseline: baseline.roas, delta: delta(current.roas, baseline.roas) },
    impressions: {
      current: current.impressions,
      baseline: baseline.impressions,
      delta: delta(current.impressions, baseline.impressions),
    },
    clicks: {
      current: current.clicks,
      baseline: baseline.clicks,
      delta: delta(current.clicks, baseline.clicks),
    },
    cpc: { current: current.cpc, baseline: baseline.cpc, delta: delta(current.cpc, baseline.cpc) },
    ctr: { current: current.ctr, baseline: baseline.ctr, delta: delta(current.ctr, baseline.ctr) },
    conversionRate: {
      current: current.conversionRate,
      baseline: baseline.conversionRate,
      delta: delta(current.conversionRate, baseline.conversionRate),
    },
    avgConversionValue: {
      current: current.avgConversionValue,
      baseline: baseline.avgConversionValue,
      delta: delta(current.avgConversionValue, baseline.avgConversionValue),
    },
    distinctShopifyModels: {
      current: current.distinctShopifyModels,
      baseline: baseline.distinctShopifyModels,
      delta: delta(current.distinctShopifyModels, baseline.distinctShopifyModels),
    },
    zeroConversionSpendChf: {
      current: current.zeroConversionSpendChf,
      baseline: baseline.zeroConversionSpendChf,
      delta: delta(current.zeroConversionSpendChf, baseline.zeroConversionSpendChf),
    },
    uncoveredSpendChf: {
      current: current.uncoveredSpendChf,
      baseline: baseline.uncoveredSpendChf,
      delta: delta(current.uncoveredSpendChf, baseline.uncoveredSpendChf),
    },
    zeroConversionCohorts: {
      current: current.zeroConversionCohorts,
      baseline: baseline.zeroConversionCohorts,
    },
    byCampaign: {
      current: current.byCampaign,
      baseline: baseline.byCampaign,
    },
    byLanguage: {
      current: current.byLanguage,
      baseline: baseline.byLanguage,
    },
  };
}

export async function comparePeriodsCommand(options: { outDir?: string } = {}): Promise<number> {
  return withSyncRun(
    "compare",
    { current: CURRENT, priorMonth: PRIOR_MONTH, yoy: YOY },
    async () => {
      const [current, priorMonth, yoy] = await Promise.all([
        periodSnapshot(CURRENT),
        periodSnapshot(PRIOR_MONTH),
        periodSnapshot(YOY),
      ]);

      const report = {
        note: "Read-only comparison. Negative zero-conversion cohorts use a 7-day conversion-lag exclusion on each period. No exclusions recommended from offer-level keys.",
        periods: {
          current: current.range,
          priorMonth: priorMonth.range,
          yearOverYear: yoy.range,
        },
        snapshots: { current, priorMonth, yearOverYear: yoy },
        vsPriorMonth: compareMetricBlock("current vs prior month", current, priorMonth),
        vsYearOverYear: compareMetricBlock("current vs year-over-year", current, yoy),
      };

      const outDir = options.outDir ?? path.join(process.cwd(), "tmp");
      await mkdir(outDir, { recursive: true });
      const outFile = path.join(
        outDir,
        `ads-compare-${CURRENT.start}_${CURRENT.end}.json`
      );
      await writeFile(outFile, stringifySafe(report, 2), "utf8");

      log("compare.vs_prior_month", {
        spend: report.vsPriorMonth.spendChf,
        revenue: report.vsPriorMonth.revenueChf,
        roas: report.vsPriorMonth.roas,
        models: report.vsPriorMonth.distinctShopifyModels,
        zeroConvSpend: report.vsPriorMonth.zeroConversionSpendChf,
        uncovered: report.vsPriorMonth.uncoveredSpendChf,
      });
      log("compare.vs_yoy", {
        spend: report.vsYearOverYear.spendChf,
        revenue: report.vsYearOverYear.revenueChf,
        roas: report.vsYearOverYear.roas,
        models: report.vsYearOverYear.distinctShopifyModels,
        zeroConvSpend: report.vsYearOverYear.zeroConversionSpendChf,
        uncovered: report.vsYearOverYear.uncoveredSpendChf,
      });
      log("compare.report_written", { file: outFile });

      return {
        reportFile: outFile,
        currentSpendChf: current.spendChf,
        currentRoas: current.roas,
        priorMonthRoas: priorMonth.roas,
        yoyRoas: yoy.roas,
      };
    }
  );
}
