import { createHash } from "crypto";
import { prisma } from "@/app/lib/prisma";
import { GALAXUS_PRICE_CURRENCY, GALAXUS_PRICE_MODEL } from "@/galaxus/edi/config";
import { toCsv } from "@/galaxus/exports/csv";
import { runGalaxusExportGET } from "@/galaxus/ops/internalExportGet";
import { skipGalaxusFeedValidationForTrigger } from "@/galaxus/feedExecutor";
import { enqueueOpsBackgroundJob } from "@/galaxus/ops/enqueueOpsBackgroundJob";
import { runOpsJob } from "@/galaxus/ops/jobRunner";
import { OPS_SNAPSHOT_REBUILD_JOB } from "@/galaxus/ops/opsBackgroundJobs";

export const GALAXUS_STOCK_CSV_HEADERS = [
  "ProviderKey",
  "QuantityOnStock",
  "RestockTime",
  "RestockDate",
  "MinimumOrderQuantity",
  "OrderQuantitySteps",
  "TradeUnit",
  "LogisticUnit",
  "WarehouseCountry",
  "DirectDeliverySupported",
] as const;

const SNAPSHOT_META_ID = "default";
const CHUNK_SIZE = 3000;
export const FEED_SNAPSHOT_REBUILD_JOB = "ops-feed-snapshot-rebuild";
const SNAPSHOT_REBUILD_STALE_MS = 2 * 60 * 60 * 1000;

type SnapshotRebuildJobRun = {
  startedAt: Date | string;
  finishedAt: Date | string;
  success?: boolean;
  errorMessage?: string | null;
  resultJson?: unknown;
};

export async function getLatestFeedSnapshotRebuildJobRun() {
  return (prisma as any).galaxusJobRun.findFirst({
    where: { jobName: FEED_SNAPSHOT_REBUILD_JOB },
    orderBy: { startedAt: "desc" },
  });
}

/** Job run rows are created with finishedAt = startedAt until the handler completes. */
export function isFeedSnapshotRebuildRunning(
  run: SnapshotRebuildJobRun | null | undefined
): boolean {
  if (!run?.startedAt || !run?.finishedAt) return false;
  const startedMs = new Date(run.startedAt).getTime();
  const finishedMs = new Date(run.finishedAt).getTime();
  if (finishedMs > startedMs) return false;
  if (
    run.success === false &&
    !run.errorMessage &&
    run.resultJson == null &&
    Date.now() - startedMs > 10 * 60 * 1000
  ) {
    return false;
  }
  if (Date.now() - startedMs > SNAPSHOT_REBUILD_STALE_MS) return false;
  return true;
}

export async function startFeedSnapshotRebuildAsync(origin: string): Promise<{
  ok: boolean;
  accepted?: boolean;
  error?: string;
  status?: number;
}> {
  const latest = await getLatestFeedSnapshotRebuildJobRun();
  if (isFeedSnapshotRebuildRunning(latest)) {
    return { ok: false, error: "Feed snapshot rebuild already running", status: 409 };
  }

  return enqueueOpsBackgroundJob({
    jobType: OPS_SNAPSHOT_REBUILD_JOB,
    origin,
    groupKey: OPS_SNAPSHOT_REBUILD_JOB,
  });
}

export function defaultOfferCsvHeaders(): string[] {
  const currency = GALAXUS_PRICE_CURRENCY || "CHF";
  const isMerchant = GALAXUS_PRICE_MODEL.toLowerCase() === "merchant";
  const priceHeader = isMerchant
    ? `SalesPriceExclVat_${currency}`
    : `PurchasePriceExclVat_${currency}`;
  return isMerchant
    ? ["ProviderKey", priceHeader, "VatRatePercentage"]
    : ["ProviderKey", priceHeader, "SuggestedRetailPriceInclVat_CHF", "VatRatePercentage"];
}

export function parseCsvToRows(csv: string): {
  headers: string[];
  rows: Array<Record<string, string>>;
} {
  const lines = csv.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  };

  const headers = parseLine(lines[0]);
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((header, idx) => {
      row[header] = cells[idx] ?? "";
    });
    const providerKey = String(row.ProviderKey ?? "").trim();
    if (!providerKey) continue;
    rows.push(row);
  }
  return { headers, rows };
}

function snapshotMaxAgeMs(): number {
  const hours = Number(process.env.GALAXUS_FEED_SNAPSHOT_MAX_AGE_HOURS ?? 48);
  return Math.max(1, hours) * 3600 * 1000;
}

export async function getFeedSnapshotMeta() {
  return (prisma as any).galaxusFeedSnapshotMeta.findUnique({
    where: { id: SNAPSHOT_META_ID },
  });
}

export async function isFeedSnapshotReady(scope: "stock" | "offer"): Promise<boolean> {
  const meta = await getFeedSnapshotMeta();
  if (!meta?.rebuiltAt) return false;
  const ageMs = Date.now() - new Date(meta.rebuiltAt).getTime();
  if (ageMs > snapshotMaxAgeMs()) return false;
  const count = scope === "stock" ? meta.stockRowCount : meta.offerRowCount;
  return Number(count) > 0;
}

export function shouldUseFeedSnapshotForTrigger(
  triggerSource?: string | null,
  scope?: "stock" | "offer"
): boolean {
  if (scope && String(process.env.GALAXUS_FEED_SNAPSHOT_ALWAYS ?? "").trim() === "1") {
    return true;
  }
  return skipGalaxusFeedValidationForTrigger(triggerSource);
}

async function bulkReplaceSnapshotRows(params: {
  table: "stock" | "offer";
  headers: string[];
  rows: Array<Record<string, string>>;
}) {
  const prismaAny = prisma as any;
  const model =
    params.table === "stock"
      ? prismaAny.galaxusFeedStockSnapshot
      : prismaAny.galaxusFeedOfferSnapshot;
  const now = new Date();

  await model.deleteMany({});

  for (let offset = 0; offset < params.rows.length; offset += CHUNK_SIZE) {
    const chunk = params.rows.slice(offset, offset + CHUNK_SIZE);
    await model.createMany({
      data: chunk.map((row) => ({
        providerKey: String(row.ProviderKey ?? "").trim(),
        rowJson: row,
        updatedAt: now,
      })),
      skipDuplicates: true,
    });
  }
}

/** Clear `rebuiltAt` so the snapshot path is skipped and exports fall back to live. */
export async function invalidateFeedSnapshot(): Promise<void> {
  await (prisma as any).galaxusFeedSnapshotMeta.updateMany({
    where: { id: SNAPSHOT_META_ID },
    data: { rebuiltAt: null, stockRowCount: 0, offerRowCount: 0 },
  });
}

/**
 * Chunked `createMany` can silently land fewer rows than parsed (duplicate ProviderKeys
 * are skipped, a chunk can fail). Publishing a short feed is worse than publishing none.
 */
async function assertSnapshotRowCounts(expected: {
  stockExpected: number;
  offerExpected: number;
}): Promise<void> {
  const prismaAny = prisma as any;
  const [stockCount, offerCount] = await Promise.all([
    prismaAny.galaxusFeedStockSnapshot.count(),
    prismaAny.galaxusFeedOfferSnapshot.count(),
  ]);

  const shortfall = (actual: number, target: number) => target > 0 && actual < target * 0.99;
  if (shortfall(stockCount, expected.stockExpected) || shortfall(offerCount, expected.offerExpected)) {
    throw new Error(
      `Snapshot rebuild incomplete — stock ${stockCount}/${expected.stockExpected}, offer ${offerCount}/${expected.offerExpected}. Snapshot left invalid; exports stay on the live path.`
    );
  }
}

async function fetchExportCsv(origin: string, path: string): Promise<string> {
  const url = `${origin}${path}`;
  const res = await runGalaxusExportGET(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Export failed ${path}: ${res.status} ${body.slice(0, 200)}`);
  }
  return res.text();
}

export async function rebuildFeedSnapshotFromExports(origin: string): Promise<{
  stockRows: number;
  offerRows: number;
  ms: number;
}> {
  const startedAt = Date.now();
  const [stockCsv, offerCsv] = await Promise.all([
    fetchExportCsv(origin, "/api/galaxus/export/stock?all=1"),
    fetchExportCsv(origin, "/api/galaxus/export/offer?all=1"),
  ]);

  const stockParsed = parseCsvToRows(stockCsv);
  const offerParsed = parseCsvToRows(offerCsv);
  const offerHeaders =
    offerParsed.headers.length > 0 ? offerParsed.headers : defaultOfferCsvHeaders();

  if (stockParsed.rows.length === 0 || offerParsed.rows.length === 0) {
    throw new Error(
      `Refusing to rebuild snapshot from empty export (stock=${stockParsed.rows.length}, offer=${offerParsed.rows.length})`
    );
  }

  // Invalidate before wiping. The rebuild is delete-then-insert across two tables and
  // cannot be one transaction at this row count, so a crash mid-rebuild would otherwise
  // leave truncated tables still flagged ready by the previous run's `rebuiltAt` —
  // and a truncated offer CSV delists every product missing from it.
  await invalidateFeedSnapshot();

  await bulkReplaceSnapshotRows({
    table: "stock",
    headers: [...GALAXUS_STOCK_CSV_HEADERS],
    rows: stockParsed.rows,
  });
  await bulkReplaceSnapshotRows({
    table: "offer",
    headers: offerHeaders,
    rows: offerParsed.rows,
  });

  await assertSnapshotRowCounts({
    stockExpected: stockParsed.rows.length,
    offerExpected: offerParsed.rows.length,
  });

  const now = new Date();
  await (prisma as any).galaxusFeedSnapshotMeta.upsert({
    where: { id: SNAPSHOT_META_ID },
    create: {
      id: SNAPSHOT_META_ID,
      stockRowCount: stockParsed.rows.length,
      offerRowCount: offerParsed.rows.length,
      stockHeadersJson: [...GALAXUS_STOCK_CSV_HEADERS],
      offerHeadersJson: offerHeaders,
      rebuiltAt: now,
      updatedAt: now,
    },
    update: {
      stockRowCount: stockParsed.rows.length,
      offerRowCount: offerParsed.rows.length,
      stockHeadersJson: [...GALAXUS_STOCK_CSV_HEADERS],
      offerHeadersJson: offerHeaders,
      rebuiltAt: now,
      updatedAt: now,
    },
  });

  console.info("[GALAXUS][FEED][SNAPSHOT] rebuilt", {
    stockRows: stockParsed.rows.length,
    offerRows: offerParsed.rows.length,
    ms: Date.now() - startedAt,
  });

  return {
    stockRows: stockParsed.rows.length,
    offerRows: offerParsed.rows.length,
    ms: Date.now() - startedAt,
  };
}

export async function patchFeedSnapshotsForProviderKeys(params: {
  origin: string;
  providerKeys: string[];
}): Promise<{ patched: number }> {
  const keys = Array.from(
    new Set(params.providerKeys.map((k) => String(k ?? "").trim()).filter(Boolean))
  );
  if (keys.length === 0) return { patched: 0 };

  const ready = (await isFeedSnapshotReady("stock")) && (await isFeedSnapshotReady("offer"));
  if (!ready) return { patched: 0 };

  const encoded = encodeURIComponent(keys.join(","));
  const [stockCsv, offerCsv] = await Promise.all([
    fetchExportCsv(params.origin, `/api/galaxus/export/stock?all=1&providerKeys=${encoded}`),
    fetchExportCsv(params.origin, `/api/galaxus/export/offer?all=1&providerKeys=${encoded}`),
  ]);

  const stockParsed = parseCsvToRows(stockCsv);
  const offerParsed = parseCsvToRows(offerCsv);
  const now = new Date();
  const prismaAny = prisma as any;

  for (const row of stockParsed.rows) {
    const providerKey = String(row.ProviderKey ?? "").trim();
    if (!providerKey) continue;
    await prismaAny.galaxusFeedStockSnapshot.upsert({
      where: { providerKey },
      create: { providerKey, rowJson: row, updatedAt: now },
      update: { rowJson: row, updatedAt: now },
    });
  }
  for (const row of offerParsed.rows) {
    const providerKey = String(row.ProviderKey ?? "").trim();
    if (!providerKey) continue;
    await prismaAny.galaxusFeedOfferSnapshot.upsert({
      where: { providerKey },
      create: { providerKey, rowJson: row, updatedAt: now },
      update: { rowJson: row, updatedAt: now },
    });
  }

  return { patched: keys.length };
}

async function loadSnapshotCsv(scope: "stock" | "offer"): Promise<{ csv: string; count: number }> {
  const meta = await getFeedSnapshotMeta();
  const prismaAny = prisma as any;
  const headers: string[] =
    scope === "stock"
      ? (meta?.stockHeadersJson as string[]) ?? [...GALAXUS_STOCK_CSV_HEADERS]
      : (meta?.offerHeadersJson as string[]) ?? defaultOfferCsvHeaders();

  const rows: Array<Record<string, string>> = [];
  const model =
    scope === "stock" ? prismaAny.galaxusFeedStockSnapshot : prismaAny.galaxusFeedOfferSnapshot;

  let cursor: string | undefined;
  for (;;) {
    const batch: Array<{ providerKey: string; rowJson: unknown }> = await model.findMany({
      orderBy: { providerKey: "asc" },
      take: CHUNK_SIZE,
      ...(cursor ? { cursor: { providerKey: cursor }, skip: 1 } : {}),
      select: { providerKey: true, rowJson: true },
    });
    if (batch.length === 0) break;
    for (const item of batch) {
      rows.push(item.rowJson as Record<string, string>);
    }
    cursor = batch[batch.length - 1]?.providerKey;
    if (batch.length < CHUNK_SIZE) break;
  }

  const csv = toCsv(headers, rows);
  return { csv, count: rows.length };
}

export async function tryExportCsvFromSnapshot(params: {
  scope: "stock" | "offer";
  triggerSource?: string | null;
}): Promise<{ csv: string; count: number; source: "snapshot" } | null> {
  if (!shouldUseFeedSnapshotForTrigger(params.triggerSource, params.scope)) return null;
  if (!(await isFeedSnapshotReady(params.scope))) return null;

  const startedAt = Date.now();
  const out = await loadSnapshotCsv(params.scope);
  console.info("[GALAXUS][FEED][SNAPSHOT] export", {
    scope: params.scope,
    rows: out.count,
    ms: Date.now() - startedAt,
    checksum: createHash("sha256").update(out.csv).digest("hex").slice(0, 16),
  });
  return { ...out, source: "snapshot" };
}
