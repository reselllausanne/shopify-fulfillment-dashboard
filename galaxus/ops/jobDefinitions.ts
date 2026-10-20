import { prisma } from "@/app/lib/prisma";
import type { OpsJobKey } from "./types";

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export const DEFAULT_JOBS: Array<{
  jobKey: OpsJobKey;
  intervalMs: number;
  enabled: boolean;
}> = [
  { jobKey: "partner-stock-sync", intervalMs: 5 * HOUR_MS, enabled: true }, // physical recovery; THE partner rows skipped unless THE_SUPPLIER_ENABLED=true
  /**
   * KickDB → STX price/stock shard (ops-background). Default batch ~8k products /
   * ~45–75 min; hourly ticks rotate the catalog in ~1–1.5 days instead of one
   * 17h web request that kills the :6543 pooler.
   */
  { jobKey: "stx-refresh", intervalMs: 1 * HOUR_MS, enabled: true },
  /** Golden (GLD) assortment price/stock refresh. */
  { jobKey: "gld-refresh", intervalMs: 10 * HOUR_MS, enabled: true },
  { jobKey: "edi-in", intervalMs: 1 * HOUR_MS, enabled: false }, // owned by worker-galaxus-edi (5min direct / 12:05 warehouse)
  { jobKey: "image-sync", intervalMs: 24 * HOUR_MS, enabled: true },
  { jobKey: "shopify-order-sync", intervalMs: 15 * MINUTE_MS, enabled: true },
  { jobKey: "multichannel-stock-sync", intervalMs: 15 * MINUTE_MS, enabled: true },
  { jobKey: "inventory-reconcile", intervalMs: 1 * HOUR_MS, enabled: true },
  /** Direct-delivery shipments with tracking but DELR never sent (background send lost). */
  { jobKey: "delr-retry", intervalMs: 30 * MINUTE_MS, enabled: true },
];

export async function ensureJobDefinitions() {
  const prismaAny = prisma as any;
  const now = new Date();
  for (const job of DEFAULT_JOBS) {
    await prismaAny.galaxusJobDefinition.upsert({
      where: { jobKey: job.jobKey },
      create: {
        jobKey: job.jobKey,
        intervalMs: job.intervalMs,
        enabled: job.enabled,
      },
      update: {
        intervalMs: job.intervalMs,
        enabled: job.enabled,
      },
    });
  }

  // Self-heal: a failed 17h web stx-refresh left nextRunAt + lastError stuck while
  // hourly cron timed out before reaching stx (alpha order). Clear overdue poison.
  const stx = await prismaAny.galaxusJobDefinition.findUnique({ where: { jobKey: "stx-refresh" } });
  if (stx?.enabled) {
    const nextAt = stx.nextRunAt ? new Date(stx.nextRunAt) : null;
    const intervalMs = Math.max(Number(stx.intervalMs ?? HOUR_MS), HOUR_MS);
    const overdueMs = nextAt ? now.getTime() - nextAt.getTime() : Number.POSITIVE_INFINITY;
    const err = String(stx.lastError ?? "");
    const poisoned =
      /can't reach database|timed out|P1001|P1017/i.test(err) || overdueMs > 2 * intervalMs;
    if (poisoned) {
      await prismaAny.galaxusJobDefinition.update({
        where: { jobKey: "stx-refresh" },
        data: { nextRunAt: now, lastError: null },
      });
    }
  }
}

export async function listJobDefinitions() {
  await ensureJobDefinitions();
  const prismaAny = prisma as any;
  return prismaAny.galaxusJobDefinition.findMany({
    where: { jobKey: { in: DEFAULT_JOBS.map((job) => job.jobKey) } },
    orderBy: { jobKey: "asc" },
  });
}

export async function updateJobDefinition(jobKey: OpsJobKey, data: Record<string, unknown>) {
  const prismaAny = prisma as any;
  return prismaAny.galaxusJobDefinition.update({
    where: { jobKey },
    data,
  });
}
