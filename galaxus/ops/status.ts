import { prisma } from "@/app/lib/prisma";
import { listJobDefinitions } from "./jobDefinitions";
import type { OpsJobKey } from "./types";

async function getLatestJobRun(jobKey: OpsJobKey) {
  return (prisma as any).galaxusJobRun.findFirst({
    where: { jobName: `ops-${jobKey}` },
    orderBy: { startedAt: "desc" },
  });
}

async function getLatestManifest(exportType: string) {
  return (prisma as any).galaxusExportManifest.findFirst({
    where: { exportType },
    orderBy: { createdAt: "desc" },
  });
}

async function getLatestFeedRun(scope: string) {
  return (prisma as any).galaxusFeedRun.findFirst({
    where: { scope },
    orderBy: { startedAt: "desc" },
  });
}

export async function getOpsStatus() {
  const now = new Date();
  const defs = await listJobDefinitions();
  const jobs = await Promise.all(
    defs.map(async (def: any) => {
      const lastRun = await getLatestJobRun(def.jobKey as OpsJobKey);
      const nextRunAt =
        def.nextRunAt ??
        (def.lastRunAt ? new Date(def.lastRunAt.getTime() + def.intervalMs) : null);
      return {
        jobKey: def.jobKey,
        enabled: def.enabled,
        intervalMs: def.intervalMs,
        lastRun,
        nextRunAt,
        lastError: def.lastError ?? null,
      };
    })
  );

  const [lastStockPrice, lastFull, lastMaster, lastOffer, lastStock, lastSpecs] = await Promise.all([
    getLatestFeedRun("stock-price"),
    getLatestFeedRun("full"),
    getLatestManifest("master"),
    getLatestManifest("offer"),
    getLatestManifest("stock"),
    getLatestManifest("specs"),
  ]);

  const runningFeed = await (prisma as any).galaxusFeedRun.findFirst({
    where: { finishedAt: null },
    orderBy: { startedAt: "desc" },
  });

  const ordersTotal = await (prisma as any).galaxusOrder.count({
    where: { ingestedAt: { not: null } },
  });
  const ordersOrdrSent = await (prisma as any).galaxusOrder.count({
    where: {
      OR: [{ ordrStatus: "SENT" }, { ordrSentAt: { not: null } }],
    },
  });
  const ordersOrdrFailed = await (prisma as any).galaxusOrder.count({
    where: { ordrStatus: "FAILED" },
  });
  const ordersOrdrMissing = await (prisma as any).galaxusOrder.count({
    where: {
      ingestedAt: { not: null },
      ordrSentAt: null,
      OR: [{ ordrStatus: null }, { ordrStatus: "PENDING" }],
    },
  });
  const recentOrdersRaw = await (prisma as any).galaxusOrder.findMany({
    orderBy: [{ ingestedAt: "desc" }, { orderDate: "desc" }],
    take: 20,
    select: {
      id: true,
      galaxusOrderId: true,
      ingestedAt: true,
      orderDate: true,
      ordrStatus: true,
      ordrSentAt: true,
      ordrLastError: true,
    },
  });
  const recentOrders = (recentOrdersRaw ?? []).map((order: any) => ({
    ...order,
    source: "EDI",
  }));

  return {
    ok: true,
    now: now.toISOString(),
    jobs,
    feeds: {
      running: Boolean(runningFeed),
      runningFeed,
      lastStockPrice,
      lastFull,
      lastManifests: {
        master: lastMaster,
        offer: lastOffer,
        stock: lastStock,
        specs: lastSpecs,
      },
    },
    orders: {
      totalIngested: ordersTotal,
      ordrSent: ordersOrdrSent,
      ordrFailed: ordersOrdrFailed,
      ordrMissing: ordersOrdrMissing,
      recent: recentOrders,
    },
  };
}
