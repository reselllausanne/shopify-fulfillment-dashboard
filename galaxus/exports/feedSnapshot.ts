import { createHash } from "crypto";
import { prisma } from "@/app/lib/prisma";
import { withTransientDbRetry } from "@/galaxus/exports/transientDbRetry";
import { GALAXUS_PRICE_CURRENCY, GALAXUS_PRICE_MODEL } from "@/galaxus/edi/config";
import { toCsv } from "@/galaxus/exports/csv";
import { runGalaxusExportGET } from "@/galaxus/ops/internalExportGet";
import { skipGalaxusFeedValidationForTrigger } from "@/galaxus/feedExecutor";
import { enqueueOpsBackgroundJob } from "@/galaxus/ops/enqueueOpsBackgroundJob";
import { runOpsJob } from "@/galaxus/ops/jobRunner";
import { OPS_SNAPSHOT_REBUILD_JOB } from "@/galaxus/ops/opsBackgroundJobs";
import {
  clearSnapshotLocalCache,
  readSnapshotLocalCache,
  writeSnapshotLocalCache,
} from "@/galaxus/exports/feedSnapshotLocalCache";

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

/**
 * Bump whenever export filtering rules change (assortment policy, gates): snapshots
 * rebuilt earlier still carry rows the new rules drop, so uploads fall back to live.
 */
/** Bump when assortment/pricing rules change so uploads skip stale snapshots until rebuild. */
export const GALAXUS_FEED_RULES_CHANGED_AT = new Date("2026-10-27T18:00:00Z");

export async function isFeedSnapshotReady(scope: "stock" | "offer"): Promise<boolean> {
  const meta = await getFeedSnapshotMeta();
  if (!meta?.rebuiltAt) return false;
  const rebuiltAt = new Date(meta.rebuiltAt);
  if (rebuiltAt < GALAXUS_FEED_RULES_CHANGED_AT) return false;
  const ageMs = Date.now() - rebuiltAt.getTime();
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

  await withTransientDbRetry("snapshot-delete-all", () => model.deleteMany({}));

  for (let offset = 0; offset < params.rows.length; offset += CHUNK_SIZE) {
    const chunk = params.rows.slice(offset, offset + CHUNK_SIZE);
    const chunkLabel = `snapshot-create-chunk-${offset / CHUNK_SIZE}`;
    await withTransientDbRetry(chunkLabel, () =>
      model.createMany({
        data: chunk.map((row) => ({
          providerKey: String(row.ProviderKey ?? "").trim(),
          rowJson: row,
          updatedAt: now,
        })),
        skipDuplicates: true,
      })
    );
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
    withTransientDbRetry("snapshot-assert-stock-count", () => prismaAny.galaxusFeedStockSnapshot.count()),
    withTransientDbRetry("snapshot-assert-offer-count", () => prismaAny.galaxusFeedOfferSnapshot.count()),
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

function maybeExposeGc(): void {
  try {
    if (typeof global.gc === "function") global.gc();
  } catch {
    // expose-gc not enabled — ignore
  }
}

/**
 * Stock + offer exports each peak near the old-space limit when run in-process.
 * Never build both at once (Promise.all doubled the heap and OOMed ~8GB during
 * stock paginate). Build → parse → persist → free → GC, one scope at a time.
 */
export async function rebuildFeedSnapshotFromExports(origin: string): Promise<{
  stockRows: number;
  offerRows: number;
  ms: number;
}> {
  const startedAt = Date.now();

  console.info("[GALAXUS][FEED][SNAPSHOT] rebuild phase", { phase: "export-stock" });
  let stockCsv = await fetchExportCsv(origin, "/api/galaxus/export/stock?all=1");
  const stockParsed = parseCsvToRows(stockCsv);
  stockCsv = "";
  maybeExposeGc();
  const stockRowCount = stockParsed.rows.length;
  if (stockRowCount === 0) {
    throw new Error(`Refusing to rebuild snapshot from empty export (stock=0)`);
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
  stockParsed.rows.length = 0;
  maybeExposeGc();

  console.info("[GALAXUS][FEED][SNAPSHOT] rebuild phase", {
    phase: "export-offer",
    stockRowsPersisted: stockRowCount,
  });
  let offerCsv = await fetchExportCsv(origin, "/api/galaxus/export/offer?all=1");
  const offerParsed = parseCsvToRows(offerCsv);
  offerCsv = "";
  maybeExposeGc();
  const offerHeaders =
    offerParsed.headers.length > 0 ? offerParsed.headers : defaultOfferCsvHeaders();
  const offerRowCount = offerParsed.rows.length;
  if (offerRowCount === 0) {
    throw new Error(
      `Refusing to rebuild snapshot from empty export (stock=${stockRowCount}, offer=0)`
    );
  }

  await bulkReplaceSnapshotRows({
    table: "offer",
    headers: offerHeaders,
    rows: offerParsed.rows,
  });
  offerParsed.rows.length = 0;
  maybeExposeGc();

  await assertSnapshotRowCounts({
    stockExpected: stockRowCount,
    offerExpected: offerRowCount,
  });

  const now = new Date();
  await (prisma as any).galaxusFeedSnapshotMeta.upsert({
    where: { id: SNAPSHOT_META_ID },
    create: {
      id: SNAPSHOT_META_ID,
      stockRowCount,
      offerRowCount,
      stockHeadersJson: [...GALAXUS_STOCK_CSV_HEADERS],
      offerHeadersJson: offerHeaders,
      rebuiltAt: now,
      updatedAt: now,
    },
    update: {
      stockRowCount,
      offerRowCount,
      stockHeadersJson: [...GALAXUS_STOCK_CSV_HEADERS],
      offerHeadersJson: offerHeaders,
      rebuiltAt: now,
      updatedAt: now,
    },
  });

  console.info("[GALAXUS][FEED][SNAPSHOT] rebuilt", {
    stockRows: stockRowCount,
    offerRows: offerRowCount,
    ms: Date.now() - startedAt,
  });

  return {
    stockRows: stockRowCount,
    offerRows: offerRowCount,
    ms: Date.now() - startedAt,
  };
}

export function missingProviderKeys(
  requested: string[],
  rows: Array<Record<string, string>>
): string[] {
  const present = new Set(rows.map((row) => String(row.ProviderKey ?? "").trim()).filter(Boolean));
  return requested.filter((key) => !present.has(key));
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

  // Keys the live export no longer emits (newly gated / blocked) must leave the snapshot,
  // otherwise the stale row keeps the offer published until the next full rebuild.
  const staleStock = missingProviderKeys(keys, stockParsed.rows);
  const staleOffer = missingProviderKeys(keys, offerParsed.rows);
  if (staleStock.length > 0) {
    await withTransientDbRetry("snapshot-patch-stale-stock-delete", () =>
      prismaAny.galaxusFeedStockSnapshot.deleteMany({ where: { providerKey: { in: staleStock } } })
    );
  }
  if (staleOffer.length > 0) {
    await withTransientDbRetry("snapshot-patch-stale-offer-delete", () =>
      prismaAny.galaxusFeedOfferSnapshot.deleteMany({ where: { providerKey: { in: staleOffer } } })
    );
  }

  return { patched: keys.length };
}

type SnapshotPullBatch = { providerKey: string; rowJson: unknown; updatedAt: Date };

async function pullSnapshotRows(
  model: any,
  where: Record<string, unknown> | undefined,
  into: Map<string, Record<string, string>>
): Promise<{ pulled: number; maxUpdatedAtMs: number }> {
  let pulled = 0;
  let maxUpdatedAtMs = 0;
  let cursor: string | undefined;
  for (;;) {
    const batchLabel = `snapshot-pull-page-${cursor ?? "start"}`;
    const batch: SnapshotPullBatch[] = await withTransientDbRetry(batchLabel, () =>
      model.findMany({
        ...(where ? { where } : {}),
        orderBy: { providerKey: "asc" },
        take: CHUNK_SIZE,
        ...(cursor ? { cursor: { providerKey: cursor }, skip: 1 } : {}),
        select: { providerKey: true, rowJson: true, updatedAt: true },
      })
    );
    if (batch.length === 0) break;
    for (const item of batch) {
      into.set(item.providerKey, item.rowJson as Record<string, string>);
      const t = new Date(item.updatedAt).getTime();
      if (Number.isFinite(t) && t > maxUpdatedAtMs) maxUpdatedAtMs = t;
      pulled += 1;
    }
    cursor = batch[batch.length - 1]?.providerKey;
    if (batch.length < CHUNK_SIZE) break;
  }
  return { pulled, maxUpdatedAtMs };
}

/** Re-pull rows written up to this long before the watermark (same-timestamp races). */
const SNAPSHOT_INCREMENTAL_OVERLAP_MS = 60_000;

/**
 * Load snapshot rows for CSV export — from the local disk cache plus an incremental
 * DB pull (`updatedAt` > watermark) instead of re-reading the full ~1.6M-row table
 * from Supabase on every push. Deletes are detected via a row-count mismatch and
 * reconciled with a key-only pull; any remaining drift falls back to a full reload.
 */
async function loadSnapshotCsv(scope: "stock" | "offer"): Promise<{ csv: string; count: number }> {
  const meta = await getFeedSnapshotMeta();
  const prismaAny = prisma as any;
  const headers: string[] =
    scope === "stock"
      ? (meta?.stockHeadersJson as string[]) ?? [...GALAXUS_STOCK_CSV_HEADERS]
      : (meta?.offerHeadersJson as string[]) ?? defaultOfferCsvHeaders();

  const model =
    scope === "stock" ? prismaAny.galaxusFeedStockSnapshot : prismaAny.galaxusFeedOfferSnapshot;
  const rebuiltAtIso = meta?.rebuiltAt ? new Date(meta.rebuiltAt).toISOString() : null;

  let rows = new Map<string, Record<string, string>>();
  let maxUpdatedAtMs = 0;
  let source: "cache-incremental" | "full-pull" = "full-pull";
  let pulledRows = 0;
  let cacheMutated = true;

  const cached = rebuiltAtIso
    ? await readSnapshotLocalCache(scope).catch((err: any) => {
        console.warn("[GALAXUS][FEED][SNAPSHOT] local cache read failed — full pull", {
          scope,
          error: err?.message ?? String(err),
        });
        return null;
      })
    : null;

  if (cached && cached.rebuiltAt === rebuiltAtIso) {
    rows = cached.rows;
    maxUpdatedAtMs = cached.maxUpdatedAtMs;
    const since = new Date(Math.max(0, maxUpdatedAtMs - SNAPSHOT_INCREMENTAL_OVERLAP_MS));
    const changed = await pullSnapshotRows(model, { updatedAt: { gte: since } }, rows);
    pulledRows = changed.pulled;
    // The overlap window re-pulls the last already-cached rows on every push; only a
    // strictly newer updatedAt means the table actually changed since the cache write.
    cacheMutated = changed.maxUpdatedAtMs > maxUpdatedAtMs;
    if (changed.maxUpdatedAtMs > maxUpdatedAtMs) maxUpdatedAtMs = changed.maxUpdatedAtMs;
    source = "cache-incremental";

    // Patches can also DELETE rows (keys the live export stopped emitting). Upserts all
    // bump `updatedAt` and are caught above, so a count mismatch can only mean deletes
    // (or drift) — reconcile with a key-only pull, and full-reload if that is not enough.
    const dbCount: number = await withTransientDbRetry("snapshot-count", () => model.count());
    if (rows.size !== dbCount) {
      const keyRows: Array<{ providerKey: string }> = await withTransientDbRetry(
        "snapshot-key-pull",
        () => model.findMany({ select: { providerKey: true } })
      );
      const keep = new Set(keyRows.map((row) => row.providerKey));
      for (const key of rows.keys()) {
        if (!keep.has(key)) rows.delete(key);
      }
      cacheMutated = true;
      if (rows.size !== dbCount) {
        console.warn("[GALAXUS][FEED][SNAPSHOT] cache drift — full reload", {
          scope,
          cacheRows: rows.size,
          dbCount,
        });
        await clearSnapshotLocalCache(scope);
        rows = new Map();
        const full = await pullSnapshotRows(model, undefined, rows);
        pulledRows = full.pulled;
        maxUpdatedAtMs = full.maxUpdatedAtMs;
        source = "full-pull";
      }
    }
  } else {
    const full = await pullSnapshotRows(model, undefined, rows);
    pulledRows = full.pulled;
    maxUpdatedAtMs = full.maxUpdatedAtMs;
  }

  // Rewriting ~1.6M JSONL lines (~300MB) per push is pure waste when nothing changed —
  // most pushes touch a handful of keys in ONE scope and none in the other.
  if (rebuiltAtIso && cacheMutated) {
    await writeSnapshotLocalCache(scope, { rebuiltAt: rebuiltAtIso, maxUpdatedAtMs, rows }).catch(
      (err: any) => {
        console.warn("[GALAXUS][FEED][SNAPSHOT] local cache write failed (non-fatal)", {
          scope,
          error: err?.message ?? String(err),
        });
      }
    );
  }

  console.info("[GALAXUS][FEED][SNAPSHOT] load", {
    scope,
    source,
    rows: rows.size,
    pulledFromDb: pulledRows,
  });

  // Deterministic order so the upload sha256 skip-unchanged check stays stable run-to-run.
  const sortedKeys = Array.from(rows.keys()).sort();
  const rowList = sortedKeys.map((key) => rows.get(key)!);
  const csv = toCsv(headers, rowList);
  return { csv, count: rowList.length };
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
