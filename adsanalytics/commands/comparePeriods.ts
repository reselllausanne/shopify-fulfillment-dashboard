import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { periodSnapshot } from "@/adsanalytics/commands/analyzeModels";
import type { DateRange } from "@/adsanalytics/dates";
import { stringifySafe } from "@/adsanalytics/json";
import { log, withSyncRun } from "@/adsanalytics/run";

const CURRENT: DateRange = { start: "2026-07-06", end: "2026-08-04" };
const PRIOR_MONTH: DateRange = { start: "2026-06-06", end: "2026-07-05" };
const YOY: DateRange = { start: "2025-07-06", end: "2025-08-04" };

type Snapshot = Awaited<ReturnType<typeof periodSnapshot>>;
type Layer = Snapshot["totalCampaign"];

function delta(current: number | null | undefined, baseline: number | null | undefined) {
  if (current == null || baseline == null) return null;
  const abs = Number((current - baseline).toFixed(3));
  const pct =
    baseline === 0 ? null : Number((((current - baseline) / Math.abs(baseline)) * 100).toFixed(2));
  return { abs, pct };
}

function compareLayer(current: Layer, baseline: Layer) {
  return {
    spendChf: {
      current: current.spendChf,
      baseline: baseline.spendChf,
      delta: delta(current.spendChf, baseline.spendChf),
    },
    valueChf: {
      current: current.valueChf,
      baseline: baseline.valueChf,
      delta: delta(current.valueChf, baseline.valueChf),
    },
    conversions: {
      current: current.conversions,
      baseline: baseline.conversions,
      delta: delta(current.conversions, baseline.conversions),
    },
    roas: { current: current.roas, baseline: baseline.roas, delta: delta(current.roas, baseline.roas) },
  };
}

function compareMetricBlock(label: string, current: Snapshot, baseline: Snapshot) {
  return {
    label,
    currentPeriod: current.range,
    baselinePeriod: baseline.range,
    /** Campaign totals from ads_campaign_daily — overall account/campaign spend. */
    totalCampaign: compareLayer(current.totalCampaign, baseline.totalCampaign),
    /** Shopping-performance product rows — product-attributed only. */
    productAttributed: {
      ...compareLayer(current.productAttributed, baseline.productAttributed),
      impressions: {
        current: current.productAttributed.impressions,
        baseline: baseline.productAttributed.impressions,
        delta: delta(current.productAttributed.impressions, baseline.productAttributed.impressions),
      },
      clicks: {
        current: current.productAttributed.clicks,
        baseline: baseline.productAttributed.clicks,
        delta: delta(current.productAttributed.clicks, baseline.productAttributed.clicks),
      },
      cpc: {
        current: current.productAttributed.cpc,
        baseline: baseline.productAttributed.cpc,
        delta: delta(current.productAttributed.cpc, baseline.productAttributed.cpc),
      },
      ctr: {
        current: current.productAttributed.ctr,
        baseline: baseline.productAttributed.ctr,
        delta: delta(current.productAttributed.ctr, baseline.productAttributed.ctr),
      },
      conversionRate: {
        current: current.productAttributed.conversionRate,
        baseline: baseline.productAttributed.conversionRate,
        delta: delta(
          current.productAttributed.conversionRate,
          baseline.productAttributed.conversionRate
        ),
      },
      avgConversionValue: {
        current: current.productAttributed.avgConversionValue,
        baseline: baseline.productAttributed.avgConversionValue,
        delta: delta(
          current.productAttributed.avgConversionValue,
          baseline.productAttributed.avgConversionValue
        ),
      },
      distinctShopifyModels: {
        current: current.productAttributed.distinctShopifyModels,
        baseline: baseline.productAttributed.distinctShopifyModels,
        delta: delta(
          current.productAttributed.distinctShopifyModels,
          baseline.productAttributed.distinctShopifyModels
        ),
      },
    },
    /** Campaign − product-attributed (non-Shopping PMax channels, etc.). */
    uncovered: compareLayer(current.uncovered, baseline.uncovered),
    zeroConversionSpendChf: {
      current: current.zeroConversionSpendChf,
      baseline: baseline.zeroConversionSpendChf,
      delta: delta(current.zeroConversionSpendChf, baseline.zeroConversionSpendChf),
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
        note:
          "Read-only comparison. For every period, totalCampaign / productAttributed / uncovered are separate. " +
          "Do not treat productAttributed as overall. Zero-conversion cohorts use 7-day lag exclusion. " +
          "No exclusions recommended from offer-level keys.",
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
        totalCampaign: report.vsPriorMonth.totalCampaign,
        productAttributed: {
          spend: report.vsPriorMonth.productAttributed.spendChf,
          value: report.vsPriorMonth.productAttributed.valueChf,
          roas: report.vsPriorMonth.productAttributed.roas,
          models: report.vsPriorMonth.productAttributed.distinctShopifyModels,
        },
        uncovered: report.vsPriorMonth.uncovered,
        zeroConvSpend: report.vsPriorMonth.zeroConversionSpendChf,
      });
      log("compare.vs_yoy", {
        totalCampaign: report.vsYearOverYear.totalCampaign,
        productAttributed: {
          spend: report.vsYearOverYear.productAttributed.spendChf,
          value: report.vsYearOverYear.productAttributed.valueChf,
          roas: report.vsYearOverYear.productAttributed.roas,
          models: report.vsYearOverYear.productAttributed.distinctShopifyModels,
        },
        uncovered: report.vsYearOverYear.uncovered,
      });
      log("compare.report_written", { file: outFile });

      return {
        reportFile: outFile,
        currentTotalSpendChf: current.totalCampaign.spendChf,
        currentTotalRoas: current.totalCampaign.roas,
        currentProductRoas: current.productAttributed.roas,
        priorMonthTotalRoas: priorMonth.totalCampaign.roas,
        yoyTotalRoas: yoy.totalCampaign.roas,
      };
    }
  );
}
