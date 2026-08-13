import { buildFunnelReport } from "@/adsanalytics/commands/funnel";
import { upsertInventoryFunnelDaily, type InventoryFunnelDailyRow } from "@/adsanalytics/repository";
import { log, withSyncRun } from "@/adsanalytics/run";

function toSnapshotRow(report: Awaited<ReturnType<typeof buildFunnelReport>>): InventoryFunnelDailyRow {
  const rows = report.current;
  return {
    date: report.periods.current.end,
    granularity: report.settings.granularity,
    windowDays: report.settings.days,
    periodStart: report.periods.current.start,
    periodEnd: report.periods.current.end,
    total: rows.totals.entities,
    targeted: rows.totals.targeted,
    notTargeted: rows.totals.notTargeted,
    withImpressions7d: rows.currentStepCount?.withImpressions7d ?? rows.steps.find((s) => s.step === "with_impressions")?.count ?? 0,
    withImpressions30d: rows.steps.find((s) => s.step === "with_impressions")?.count ?? 0,
    withClicks7d: rows.currentStepCount?.withClicks7d ?? rows.steps.find((s) => s.step === "with_clicks")?.count ?? 0,
    withClicks30d: rows.steps.find((s) => s.step === "with_clicks")?.count ?? 0,
    withSpend30d: rows.steps.find((s) => s.step === "with_spend")?.count ?? 0,
    withConversions30d: rows.steps.find((s) => s.step === "with_conversions")?.count ?? 0,
    spendZeroConversion30d: rows.economicSegments.spendZeroConversion.spendChf,
    unmapped: rows.totals.unmapped,
    statsJson: report,
  };
}

export async function funnelSnapshotCommand(options: { days?: number } = {}): Promise<number> {
  return withSyncRun("funnel:snapshot", options, async () => {
    const granularities: Array<"offer" | "variant" | "model"> = ["offer", "variant", "model"];
    const rows: InventoryFunnelDailyRow[] = [];
    for (const granularity of granularities) {
      const report = await buildFunnelReport({ days: options.days ?? 30, granularity });
      rows.push(toSnapshotRow(report));
    }
    const written = await upsertInventoryFunnelDaily(rows);
    const summary = {
      rowsWritten: written,
      date: rows[0]?.date ?? null,
      windowDays: options.days ?? 30,
      granularities,
    };
    log("funnel_snapshot.summary", summary);
    return summary;
  });
}
