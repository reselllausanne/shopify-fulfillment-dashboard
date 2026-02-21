import { prisma } from "@/app/lib/prisma";

type FeedRunResult = {
  ok: boolean;
  status: number;
  error?: string;
  counts?: { master?: number | null; stock?: number | null; offer?: number | null };
  uploaded?: Array<{ name: string; path: string; size: number }>;
  resultJson?: unknown;
};

type SchedulerState = {
  running: boolean;
  startedAt: string | null;
  lastSupplierSyncRunAt: string | null;
  lastPartnerSyncRunAt: string | null;
  lastEdiInRunAt: string | null;
  lastOfferStockRunAt: string | null;
  lastMasterRunAt: string | null;
  lastSupplierSyncResult: FeedRunResult | null;
  lastPartnerSyncResult: FeedRunResult | null;
  lastEdiInResult: FeedRunResult | null;
  lastOfferStockResult: FeedRunResult | null;
  lastMasterResult: FeedRunResult | null;
  supplierSyncIntervalMs: number;
  ediInIntervalMs: number;
  offerStockIntervalMs: number;
  masterIntervalMs: number;
  origin: string | null;
  nextSupplierSyncAt: string | null;
  nextEdiInAt: string | null;
  nextOfferStockAt: string | null;
  nextMasterAt: string | null;
  lastManifests: {
    master: any | null;
    offer: any | null;
    stock: any | null;
    ediOut: any | null;
  };
};

const DEFAULT_OFFER_STOCK_INTERVAL_MS = 2 * 60 * 60 * 1000;
const DEFAULT_MASTER_INTERVAL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_EDI_IN_INTERVAL_MS = 60 * 60 * 1000;

function toIso(value: Date | number | null) {
  if (!value) return null;
  return new Date(value).toISOString();
}

async function getSchedulerConfig() {
  const existing = await (prisma as any).galaxusSchedulerConfig.findFirst();
  if (existing) return existing;
  return (prisma as any).galaxusSchedulerConfig.create({
    data: { enabled: false },
  });
}

async function getLastJobRun(jobName: string) {
  return (prisma as any).galaxusJobRun.findFirst({
    where: { jobName },
    orderBy: { finishedAt: "desc" },
  });
}

function toResult(run: any | null): FeedRunResult | null {
  if (!run) return null;
  return {
    ok: Boolean(run.success),
    status: run.success ? 200 : 500,
    error: run.errorMessage ?? undefined,
    resultJson: run.resultJson ?? undefined,
  };
}

function nextFrom(lastRunAt: Date | null, intervalMs: number, enabledAt: Date | null): string | null {
  if (!enabledAt) return null;
  const base = lastRunAt ?? enabledAt;
  return new Date(base.getTime() + intervalMs).toISOString();
}

async function runUpload(origin: string, path: string): Promise<FeedRunResult> {
  const res = await fetch(`${origin}${path}`, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    return { ok: false, status: res.status, error: data?.error ?? "Upload failed", resultJson: data };
  }
  return {
    ok: true,
    status: res.status,
    counts: data?.counts ?? null,
    uploaded: data?.uploaded ?? null,
    resultJson: data ?? null,
  };
}

async function maybeRunIfDue(
  origin: string,
  jobName: string,
  intervalMs: number,
  path: string,
  enabledAt: Date | null,
  runImmediately = false
) {
  if (!enabledAt) return null;
  if (runImmediately) return runUpload(origin, path);
  const lastRun = await getLastJobRun(jobName);
  const lastFinishedAt = lastRun?.finishedAt ? new Date(lastRun.finishedAt) : null;
  const nextAt = nextFrom(lastFinishedAt, intervalMs, enabledAt);
  if (!nextAt) return null;
  if (Date.now() < new Date(nextAt).getTime()) return null;
  return runUpload(origin, path);
}

export async function getFeedSchedulerStatus(): Promise<SchedulerState> {
  const config = await getSchedulerConfig();
  const enabledAt = config.enabledAt ? new Date(config.enabledAt) : null;
  const lastEdiIn = await getLastJobRun("edi-in");
  const lastOfferStock = await getLastJobRun("feeds-offer-stock");
  const lastMaster = await getLastJobRun("feeds-master");
  const lastPartnerSync = await getLastJobRun("partners-sync");
  const [lastMasterManifest, lastOfferManifest, lastStockManifest, lastEdiManifest] =
    await Promise.all([
      (prisma as any).galaxusExportManifest.findFirst({
        where: { exportType: "master" },
        orderBy: { createdAt: "desc" },
      }),
      (prisma as any).galaxusExportManifest.findFirst({
        where: { exportType: "offer" },
        orderBy: { createdAt: "desc" },
      }),
      (prisma as any).galaxusExportManifest.findFirst({
        where: { exportType: "stock" },
        orderBy: { createdAt: "desc" },
      }),
      (prisma as any).galaxusExportManifest.findFirst({
        where: { exportType: "edi-out" },
        orderBy: { createdAt: "desc" },
      }),
    ]);

  return {
    running: Boolean(config.enabled),
    startedAt: toIso(config.enabledAt ?? null),
    lastSupplierSyncRunAt: toIso(lastOfferStock?.finishedAt ?? null),
    lastPartnerSyncRunAt: toIso(lastPartnerSync?.finishedAt ?? null),
    lastEdiInRunAt: toIso(lastEdiIn?.finishedAt ?? null),
    lastOfferStockRunAt: toIso(lastOfferStock?.finishedAt ?? null),
    lastMasterRunAt: toIso(lastMaster?.finishedAt ?? null),
    lastSupplierSyncResult: toResult(lastOfferStock),
    lastPartnerSyncResult: toResult(lastPartnerSync),
    lastEdiInResult: toResult(lastEdiIn),
    lastOfferStockResult: toResult(lastOfferStock),
    lastMasterResult: toResult(lastMaster),
    supplierSyncIntervalMs: DEFAULT_OFFER_STOCK_INTERVAL_MS,
    ediInIntervalMs: DEFAULT_EDI_IN_INTERVAL_MS,
    offerStockIntervalMs: DEFAULT_OFFER_STOCK_INTERVAL_MS,
    masterIntervalMs: DEFAULT_MASTER_INTERVAL_MS,
    origin: null,
    nextSupplierSyncAt: nextFrom(lastOfferStock?.finishedAt ?? null, DEFAULT_OFFER_STOCK_INTERVAL_MS, enabledAt),
    nextEdiInAt: nextFrom(lastEdiIn?.finishedAt ?? null, DEFAULT_EDI_IN_INTERVAL_MS, enabledAt),
    nextOfferStockAt: nextFrom(lastOfferStock?.finishedAt ?? null, DEFAULT_OFFER_STOCK_INTERVAL_MS, enabledAt),
    nextMasterAt: nextFrom(lastMaster?.finishedAt ?? null, DEFAULT_MASTER_INTERVAL_MS, enabledAt),
    lastManifests: {
      master: lastMasterManifest ?? null,
      offer: lastOfferManifest ?? null,
      stock: lastStockManifest ?? null,
      ediOut: lastEdiManifest ?? null,
    },
  };
}

export async function startFeedScheduler(origin: string, runImmediately = true) {
  const now = new Date();
  const config = await getSchedulerConfig();
  if (!config.enabled) {
    await (prisma as any).galaxusSchedulerConfig.update({
      where: { id: config.id },
      data: { enabled: true, enabledAt: now, disabledAt: null },
    });
  }
  if (runImmediately) {
    await maybeRunIfDue(origin, "edi-in", DEFAULT_EDI_IN_INTERVAL_MS, "/api/galaxus/cron?task=edi-in", now, true);
    await maybeRunIfDue(
      origin,
      "feeds-offer-stock",
      DEFAULT_OFFER_STOCK_INTERVAL_MS,
      "/api/galaxus/cron?task=feeds-offer-stock",
      now,
      true
    );
  }
  return getFeedSchedulerStatus();
}

export async function stopFeedScheduler() {
  const now = new Date();
  const config = await getSchedulerConfig();
  if (config.enabled) {
    await (prisma as any).galaxusSchedulerConfig.update({
      where: { id: config.id },
      data: { enabled: false, disabledAt: now },
    });
  }
  return getFeedSchedulerStatus();
}

export async function runFeedSchedulerTick(origin: string) {
  const config = await getSchedulerConfig();
  if (!config.enabled) {
    return { ok: true, running: false, skipped: true };
  }
  const enabledAt = config.enabledAt ? new Date(config.enabledAt) : new Date();
  const results: Record<string, FeedRunResult | null> = {};
  results.ediIn = await maybeRunIfDue(
    origin,
    "edi-in",
    DEFAULT_EDI_IN_INTERVAL_MS,
    "/api/galaxus/cron?task=edi-in",
    enabledAt
  );
  results.offerStock = await maybeRunIfDue(
    origin,
    "feeds-offer-stock",
    DEFAULT_OFFER_STOCK_INTERVAL_MS,
    "/api/galaxus/cron?task=feeds-offer-stock",
    enabledAt
  );
  results.master = await maybeRunIfDue(
    origin,
    "feeds-master",
    DEFAULT_MASTER_INTERVAL_MS,
    "/api/galaxus/cron?task=feeds-master",
    enabledAt
  );
  return { ok: true, running: true, results };
}
