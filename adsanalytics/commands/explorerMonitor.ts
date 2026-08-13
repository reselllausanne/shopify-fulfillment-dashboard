import { Prisma } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import {
  EXPLORER_GROSS_MARGIN,
  loadBatchById,
  summarizeConcentration,
  writeExplorerReport,
} from "@/adsanalytics/explorer/core";
import { log, withSyncRun } from "@/adsanalytics/run";

type ExplorerMonitorOptions = { batch?: string };

function requiredBatchId(batchId: string | undefined): string {
  const id = batchId?.trim();
  if (!id) throw new Error("Missing --batch=<id>");
  return id;
}

export async function explorerMonitorCommand(options: ExplorerMonitorOptions = {}): Promise<number> {
  return withSyncRun("explorer:monitor", options, async () => {
    const batchId = requiredBatchId(options.batch);
    const batch = await loadBatchById(batchId);
    if (!batch) throw new Error(`Batch not found: ${batchId}`);

    const rows = await prisma.$queryRaw<
      Array<{
        shopify_product_id: string;
        impressions: number;
        clicks: number;
        cost_micros: number;
        conversions: number;
        conversion_value: number;
        lifecycle_status: string;
        destination: string;
        pending_destination: string | null;
        metrics_synced_at: string | null;
      }>
    >(Prisma.sql`
      SELECT
        "shopify_product_id"::text,
        COALESCE("impressions", 0)::float8 AS impressions,
        COALESCE("clicks", 0)::float8 AS clicks,
        COALESCE("cost_micros", 0)::float8 AS cost_micros,
        COALESCE("conversions", 0)::float8 AS conversions,
        COALESCE("conversion_value", 0)::float8 AS conversion_value,
        "lifecycle_status",
        "destination",
        "pending_destination",
        "metrics_synced_at"::text AS metrics_synced_at
      FROM "public"."ads_explorer_batch_models"
      WHERE "batch_id" = ${batchId}
    `);
    const modelCount = rows.length;
    const impressions = rows.reduce((s, r) => s + r.impressions, 0);
    const clicks = rows.reduce((s, r) => s + r.clicks, 0);
    const costMicros = rows.reduce((s, r) => s + r.cost_micros, 0);
    const conversions = rows.reduce((s, r) => s + r.conversions, 0);
    const value = rows.reduce((s, r) => s + r.conversion_value, 0);
    const spendChf = costMicros / 1e6;
    const cpc = clicks > 0 ? spendChf / clicks : null;
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : null;
    const roas = spendChf > 0 ? value / spendChf : null;
    const contribution = value * EXPLORER_GROSS_MARGIN - spendChf;

    const thresholdCount = (min: number) => rows.filter((r) => r.impressions >= min).length;
    const concentration = summarizeConcentration(rows.map((r) => r.impressions));

    const byExitReason = await prisma.$queryRaw<Array<{ exit_reason: string | null; n: number }>>(Prisma.sql`
      SELECT "exit_reason", COUNT(*)::int AS n
      FROM "public"."ads_explorer_batch_models"
      WHERE "batch_id" = ${batchId}
      GROUP BY "exit_reason"
    `);

    const report = {
      batchId,
      batchStatus: batch.status,
      totals: {
        modelCount,
        impressions,
        clicks,
        spendChf: Number(spendChf.toFixed(2)),
        cpc: cpc != null ? Number(cpc.toFixed(4)) : null,
        ctr: ctr != null ? Number(ctr.toFixed(4)) : null,
        conversions: Number(conversions.toFixed(2)),
        valueChf: Number(value.toFixed(2)),
        roas: roas != null ? Number(roas.toFixed(4)) : null,
        grossContributionChf: Number(contribution.toFixed(2)),
      },
      exposureBuckets: {
        gt0: rows.filter((r) => r.impressions > 0).length,
        gte10: thresholdCount(10),
        gte25: thresholdCount(25),
        gte50: thresholdCount(50),
        gte100: thresholdCount(100),
      },
      concentration,
      exits: byExitReason.map((r) => ({ reason: r.exit_reason ?? "(none)", count: r.n })),
      destinations: rows.reduce<Record<string, number>>((acc, r) => {
        acc[r.destination] = (acc[r.destination] ?? 0) + 1;
        return acc;
      }, {}),
      pendingDestinations: rows.filter((r) => r.pending_destination != null).length,
      metricsSyncedAt: rows.reduce<string | null>(
        (latest, r) =>
          r.metrics_synced_at && (!latest || r.metrics_synced_at > latest)
            ? r.metrics_synced_at
            : latest,
        null
      ),
      remaining: rows.filter((r) => r.destination === "EXPLORER_ALL").length,
    };
    const outPath = await writeExplorerReport(`explorer-monitor-${batchId}.json`, report);
    log("explorer_monitor.summary", {
      batchId,
      modelCount,
      impressions: report.totals.impressions,
      clicks: report.totals.clicks,
      spendChf: report.totals.spendChf,
      roas: report.totals.roas,
      concentration,
      destinations: report.destinations,
      pendingDestinations: report.pendingDestinations,
      metricsSyncedAt: report.metricsSyncedAt,
      reportPath: outPath,
    });
    return { batchId, ...report.totals, concentration, reportPath: outPath };
  });
}

