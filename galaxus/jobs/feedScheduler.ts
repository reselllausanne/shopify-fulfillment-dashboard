type FeedRunResult = {
  ok: boolean;
  status: number;
  error?: string;
  counts?: { master?: number | null; stock?: number | null; offer?: number | null };
  uploaded?: Array<{ name: string; path: string; size: number }>;
};

type SchedulerState = {
  running: boolean;
  startedAt: string | null;
  lastSupplierSyncRunAt: string | null;
  lastEdiInRunAt: string | null;
  lastOfferStockRunAt: string | null;
  lastMasterRunAt: string | null;
  lastSupplierSyncResult: FeedRunResult | null;
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
};

const DEFAULT_OFFER_STOCK_INTERVAL_MS = 2 * 60 * 60 * 1000;
const DEFAULT_MASTER_INTERVAL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_EDI_IN_INTERVAL_MS = 60 * 60 * 1000;

let offerStockTimer: NodeJS.Timeout | null = null;
let masterTimer: NodeJS.Timeout | null = null;
let ediInTimer: NodeJS.Timeout | null = null;

const state: SchedulerState = {
  running: false,
  startedAt: null,
  lastSupplierSyncRunAt: null,
  lastEdiInRunAt: null,
  lastOfferStockRunAt: null,
  lastMasterRunAt: null,
  lastSupplierSyncResult: null,
  lastEdiInResult: null,
  lastOfferStockResult: null,
  lastMasterResult: null,
  supplierSyncIntervalMs: DEFAULT_OFFER_STOCK_INTERVAL_MS,
  ediInIntervalMs: DEFAULT_EDI_IN_INTERVAL_MS,
  offerStockIntervalMs: DEFAULT_OFFER_STOCK_INTERVAL_MS,
  masterIntervalMs: DEFAULT_MASTER_INTERVAL_MS,
  origin: null,
  nextSupplierSyncAt: null,
  nextEdiInAt: null,
  nextOfferStockAt: null,
  nextMasterAt: null,
};

function toIso(value: Date | number) {
  return new Date(value).toISOString();
}

function scheduleNextRuns() {
  if (!state.running) {
    state.nextSupplierSyncAt = null;
    state.nextEdiInAt = null;
    state.nextOfferStockAt = null;
    state.nextMasterAt = null;
    return;
  }
  state.nextSupplierSyncAt = toIso(Date.now() + state.supplierSyncIntervalMs);
  state.nextEdiInAt = toIso(Date.now() + state.ediInIntervalMs);
  state.nextOfferStockAt = toIso(Date.now() + state.offerStockIntervalMs);
  state.nextMasterAt = toIso(Date.now() + state.masterIntervalMs);
}

async function runUpload(path: string): Promise<FeedRunResult> {
  if (!state.origin) {
    return { ok: false, status: 0, error: "Missing scheduler origin" };
  }
  const res = await fetch(`${state.origin}${path}`, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    return { ok: false, status: res.status, error: data?.error ?? "Upload failed" };
  }
  return {
    ok: true,
    status: res.status,
    counts: data?.counts ?? null,
    uploaded: data?.uploaded ?? null,
  };
}

async function runSupplierSync() {
  state.lastSupplierSyncRunAt = toIso(Date.now());
  state.lastSupplierSyncResult = await runUpload("/api/galaxus/supplier/sync?all=1");
  state.nextSupplierSyncAt = toIso(Date.now() + state.supplierSyncIntervalMs);
}

async function runEdiIn() {
  state.lastEdiInRunAt = toIso(Date.now());
  state.lastEdiInResult = await runUpload("/api/galaxus/cron?task=edi-in");
  state.nextEdiInAt = toIso(Date.now() + state.ediInIntervalMs);
}

async function runOfferStock() {
  state.lastOfferStockRunAt = toIso(Date.now());
  await runSupplierSync();
  if (state.lastSupplierSyncResult?.ok) {
    state.lastOfferStockResult = await runUpload("/api/galaxus/feeds/upload?type=offer-stock");
  } else {
    state.lastOfferStockResult = {
      ok: false,
      status: 500,
      error: "Supplier sync failed; skipped price/stock upload",
    };
  }
  state.nextOfferStockAt = toIso(Date.now() + state.offerStockIntervalMs);
}

async function runMaster() {
  state.lastMasterRunAt = toIso(Date.now());
  state.lastMasterResult = await runUpload("/api/galaxus/feeds/upload?type=master");
  state.nextMasterAt = toIso(Date.now() + state.masterIntervalMs);
}

export function getFeedSchedulerStatus() {
  return { ...state };
}

export async function startFeedScheduler(origin: string, runImmediately = true) {
  if (state.running) return getFeedSchedulerStatus();
  state.running = true;
  state.startedAt = toIso(Date.now());
  state.origin = origin;
  scheduleNextRuns();

  if (runImmediately) {
    await runEdiIn();
    await runOfferStock();
  }

  ediInTimer = setInterval(runEdiIn, state.ediInIntervalMs);
  offerStockTimer = setInterval(runOfferStock, state.offerStockIntervalMs);
  masterTimer = setInterval(runMaster, state.masterIntervalMs);

  return getFeedSchedulerStatus();
}

export function stopFeedScheduler() {
  if (offerStockTimer) clearInterval(offerStockTimer);
  if (masterTimer) clearInterval(masterTimer);
  if (ediInTimer) clearInterval(ediInTimer);
  offerStockTimer = null;
  masterTimer = null;
  ediInTimer = null;
  state.running = false;
  state.origin = null;
  state.nextSupplierSyncAt = null;
  state.nextEdiInAt = null;
  state.nextOfferStockAt = null;
  state.nextMasterAt = null;
  return getFeedSchedulerStatus();
}
