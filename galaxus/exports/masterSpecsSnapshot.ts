import { createHash } from "crypto";
import { prisma } from "@/app/lib/prisma";
import { openCsvWriter, type CsvRow } from "@/galaxus/exports/csvStream";
import { collectCriticalGtinProviderKeys } from "@/galaxus/exports/feedValidation";
import { buildMasterSpecsFeedExport } from "@/galaxus/exports/masterSpecsFeed";
import { loadWelCardOmitProviderKeys } from "@/galaxus/exports/welFeedOmit";
import { skipGalaxusFeedValidationForTrigger } from "@/galaxus/feedExecutor";

const SNAPSHOT_META_ID = "default";
const UPSERT_CHUNK_SIZE = 3000;

/**
 * Fixed header order — Galaxus rejects rows with extra/missing columns. Legacy
 * export sends the non-weight variant; keep the same and add optional weight
 * later via a schema flag instead of expanding this list.
 */
export const MASTER_CSV_HEADERS = [
  "ProviderKey",
  "Gtin",
  "ManufacturerKey",
  "BrandName",
  "ProductCategory",
  "ProductTitle_de",
  "ProductTitle_en",
  "ProductTitle_ch",
  "VariantName",
  "LongDescription_de",
  "MainImageUrl",
  "ImageUrl_1",
  "ImageUrl_2",
] as const;

export const SPECS_CSV_HEADERS = [
  "ProviderKey",
  "SpecificationKey",
  "SpecificationValue",
] as const;

type SnapshotBuildResult = {
  masterRows: number;
  specsRows: number;
  ms: number;
  criticalGtinIssues: number;
  invalidSupplierVariantIds: string[];
};

/**
 * Full rebuild — runs the existing master/specs build pipeline once, then
 * bulk-upserts every row into the snapshot tables. After this succeeds, daily
 * pushes stream straight from the snapshot (no KickDB rawJson, no in-memory
 * row arrays, no giant CSV strings).
 *
 * Phase 1: the rebuild itself still uses the legacy pipeline, so the memory
 * peak matches today. It only needs to succeed once for daily pushes to
 * become cheap. Phase 2 replaces this with a two-pass memory-flat rebuild.
 */
export async function rebuildMasterSpecsSnapshot(params?: {
  supplier?: string | null;
  providerKeys?: string[];
}): Promise<SnapshotBuildResult> {
  const startedAt = Date.now();
  const built = await buildMasterSpecsFeedExport({
    supplier: params?.supplier ?? null,
    providerKeys: params?.providerKeys,
    // Skip 2 × ~600 MB Buffer allocations we would immediately discard.
    // Rebuild uses masterRows/specsRows arrays; final CSV is streamed on push.
    skipCsvBuffers: true,
  });

  // Bake the same row-level filters legacy runFeedUpload applies in-memory:
  //   1. critical GTIN issues (empty / invalid / wrong check digit) — from the
  //      validation report attached to the build result.
  //   2. wel-pokemon opt-outs — from the persisted omit list.
  // Baking them at rebuild time keeps the snapshot upload path a byte-for-byte
  // subset of what the legacy path would upload — no risk of pushing rows
  // Galaxus would reject.
  const criticalGtinKeys = collectCriticalGtinProviderKeys(built.report ?? {});
  const welPokemonKeys = await loadWelCardOmitProviderKeys();
  const blocked = new Set<string>([
    ...Array.from(criticalGtinKeys),
    ...Array.from(welPokemonKeys),
  ]);

  const masterRows = blocked.size
    ? built.masterRows.filter(
        (row) => !blocked.has(String(row.ProviderKey ?? "").trim())
      )
    : built.masterRows;
  const specsRows = blocked.size
    ? built.specsRows.filter(
        (row) => !blocked.has(String(row.ProviderKey ?? "").trim())
      )
    : built.specsRows;
  const masterRowCount = masterRows.length;
  const specsRowCount = specsRows.length;

  // Free the source arrays' hold on the giant candidate blob so the master
  // upsert doesn't have to fight the specs graph for heap.
  (built as { masterRows?: unknown }).masterRows = undefined;

  await replaceMasterSnapshotRows(masterRows);
  // Free master rows once persisted — 1.1M objects × ~500B = ~550 MB.
  masterRows.length = 0;
  if (global.gc) global.gc();

  (built as { specsRows?: unknown }).specsRows = undefined;
  await replaceSpecsSnapshotRows(specsRows);
  specsRows.length = 0;
  if (global.gc) global.gc();

  const now = new Date();
  await (prisma as any).galaxusFeedSnapshotMeta.upsert({
    where: { id: SNAPSHOT_META_ID },
    create: {
      id: SNAPSHOT_META_ID,
      masterRowCount,
      specsRowCount,
      masterHeadersJson: [...MASTER_CSV_HEADERS],
      specsHeadersJson: [...SPECS_CSV_HEADERS],
      masterRebuiltAt: now,
      specsRebuiltAt: now,
      updatedAt: now,
    },
    update: {
      masterRowCount,
      specsRowCount,
      masterHeadersJson: [...MASTER_CSV_HEADERS],
      specsHeadersJson: [...SPECS_CSV_HEADERS],
      masterRebuiltAt: now,
      specsRebuiltAt: now,
      updatedAt: now,
    },
  });

  console.info("[GALAXUS][FEED][SNAPSHOT][MASTER_SPECS] rebuilt", {
    masterRowsOut: masterRowCount,
    specsRowsOut: specsRowCount,
    blockedCriticalGtin: criticalGtinKeys.size,
    blockedWelPokemon: welPokemonKeys.size,
    ms: Date.now() - startedAt,
  });

  return {
    masterRows: masterRowCount,
    specsRows: specsRowCount,
    ms: Date.now() - startedAt,
    criticalGtinIssues: built.criticalGtinIssues,
    invalidSupplierVariantIds: built.invalidSupplierVariantIds,
  };
}

async function replaceMasterSnapshotRows(rows: Array<Record<string, string>>) {
  const prismaAny = prisma as any;
  await prismaAny.galaxusFeedMasterSnapshot.deleteMany({});
  const now = new Date();
  for (let offset = 0; offset < rows.length; offset += UPSERT_CHUNK_SIZE) {
    const chunk = rows.slice(offset, offset + UPSERT_CHUNK_SIZE);
    const data = chunk
      .map((row) => {
        const providerKey = String(row.ProviderKey ?? "").trim();
        if (!providerKey) return null;
        return {
          providerKey,
          gtin: String(row.Gtin ?? "").trim() || null,
          // Supplier prefix — derived downstream if scaling filters ever need it.
          supplierKey: null as string | null,
          rowJson: normaliseMasterRow(row),
          updatedAt: now,
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
    if (data.length === 0) continue;
    await prismaAny.galaxusFeedMasterSnapshot.createMany({ data, skipDuplicates: true });
  }
}

async function replaceSpecsSnapshotRows(rows: Array<Record<string, string>>) {
  const prismaAny = prisma as any;
  await prismaAny.galaxusFeedSpecsSnapshot.deleteMany({});
  const now = new Date();
  for (let offset = 0; offset < rows.length; offset += UPSERT_CHUNK_SIZE) {
    const chunk = rows.slice(offset, offset + UPSERT_CHUNK_SIZE);
    const data = chunk
      .map((row) => {
        const providerKey = String(row.ProviderKey ?? "").trim();
        const specificationKey = String(row.SpecificationKey ?? "").trim();
        if (!providerKey || !specificationKey) return null;
        return {
          providerKey,
          specificationKey,
          rowJson: {
            ProviderKey: providerKey,
            SpecificationKey: specificationKey,
            SpecificationValue: String(row.SpecificationValue ?? ""),
          } satisfies Record<string, string>,
          updatedAt: now,
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
    if (data.length === 0) continue;
    await prismaAny.galaxusFeedSpecsSnapshot.createMany({ data, skipDuplicates: true });
  }
}

function normaliseMasterRow(row: Record<string, string>): Record<string, string> {
  // Store rows in the exact header order — cheap read at export time.
  const out: Record<string, string> = {};
  for (const header of MASTER_CSV_HEADERS) {
    out[header] = String(row[header] ?? "");
  }
  return out;
}

export type MasterSpecsSnapshotMeta = {
  masterRowCount: number;
  specsRowCount: number;
  masterRebuiltAt: Date | null;
  specsRebuiltAt: Date | null;
  masterHeaders: readonly string[];
  specsHeaders: readonly string[];
};

export async function getMasterSpecsSnapshotMeta(): Promise<MasterSpecsSnapshotMeta | null> {
  const meta = await (prisma as any).galaxusFeedSnapshotMeta.findUnique({
    where: { id: SNAPSHOT_META_ID },
  });
  if (!meta) return null;
  return {
    masterRowCount: Number(meta.masterRowCount ?? 0),
    specsRowCount: Number(meta.specsRowCount ?? 0),
    masterRebuiltAt: meta.masterRebuiltAt ?? null,
    specsRebuiltAt: meta.specsRebuiltAt ?? null,
    masterHeaders: (meta.masterHeadersJson as string[]) ?? [...MASTER_CSV_HEADERS],
    specsHeaders: (meta.specsHeadersJson as string[]) ?? [...SPECS_CSV_HEADERS],
  };
}

function snapshotMaxAgeMs(): number {
  const hours = Number(process.env.GALAXUS_MASTER_SPECS_SNAPSHOT_MAX_AGE_HOURS ?? 48);
  return Math.max(1, hours) * 3600 * 1000;
}

export async function isMasterSnapshotReady(): Promise<boolean> {
  const meta = await getMasterSpecsSnapshotMeta();
  if (!meta?.masterRebuiltAt) return false;
  if (meta.masterRowCount <= 0) return false;
  const ageMs = Date.now() - new Date(meta.masterRebuiltAt).getTime();
  return ageMs <= snapshotMaxAgeMs();
}

export async function isSpecsSnapshotReady(): Promise<boolean> {
  const meta = await getMasterSpecsSnapshotMeta();
  if (!meta?.specsRebuiltAt) return false;
  if (meta.specsRowCount <= 0) return false;
  const ageMs = Date.now() - new Date(meta.specsRebuiltAt).getTime();
  return ageMs <= snapshotMaxAgeMs();
}

export function shouldUseMasterSpecsSnapshotForTrigger(
  triggerSource?: string | null
): boolean {
  if (String(process.env.GALAXUS_MASTER_SPECS_SNAPSHOT_ALWAYS ?? "").trim() === "1") {
    return true;
  }
  // Post-sale / inventory triggers don't touch identity — always safe to reuse.
  if (skipGalaxusFeedValidationForTrigger(triggerSource)) return true;
  // Manual & scheduled master-specs pushes: prefer snapshot when fresh.
  return true;
}

const STREAM_PAGE_SIZE = 5000;

async function* iterateMasterRowsFromSnapshot(): AsyncGenerator<CsvRow, void, void> {
  const prismaAny = prisma as any;
  let cursor: string | undefined;
  for (;;) {
    const batch: Array<{ providerKey: string; rowJson: unknown }> =
      await prismaAny.galaxusFeedMasterSnapshot.findMany({
        orderBy: { providerKey: "asc" },
        take: STREAM_PAGE_SIZE,
        ...(cursor ? { cursor: { providerKey: cursor }, skip: 1 } : {}),
        select: { providerKey: true, rowJson: true },
      });
    if (batch.length === 0) return;
    for (const item of batch) {
      yield (item.rowJson ?? {}) as CsvRow;
    }
    cursor = batch[batch.length - 1]?.providerKey;
    if (batch.length < STREAM_PAGE_SIZE) return;
  }
}

async function* iterateSpecsRowsFromSnapshot(): AsyncGenerator<CsvRow, void, void> {
  const prismaAny = prisma as any;
  let cursor: { providerKey: string; specificationKey: string } | undefined;
  for (;;) {
    const batch: Array<{
      providerKey: string;
      specificationKey: string;
      rowJson: unknown;
    }> = await prismaAny.galaxusFeedSpecsSnapshot.findMany({
      orderBy: [{ providerKey: "asc" }, { specificationKey: "asc" }],
      take: STREAM_PAGE_SIZE,
      ...(cursor
        ? {
            cursor: {
              providerKey_specificationKey: {
                providerKey: cursor.providerKey,
                specificationKey: cursor.specificationKey,
              },
            },
            skip: 1,
          }
        : {}),
      select: { providerKey: true, specificationKey: true, rowJson: true },
    });
    if (batch.length === 0) return;
    for (const item of batch) {
      yield (item.rowJson ?? {}) as CsvRow;
    }
    const last = batch[batch.length - 1];
    if (!last) return;
    cursor = { providerKey: last.providerKey, specificationKey: last.specificationKey };
    if (batch.length < STREAM_PAGE_SIZE) return;
  }
}

export type SnapshotStreamOptions = {
  /**
   * ProviderKeys to skip (e.g. wel-pokemon omissions + critical GTIN failures).
   * Applied inline during streaming — no extra file pass afterwards.
   */
  skipProviderKeys?: ReadonlySet<string>;
};

/**
 * Stream master snapshot rows to a CSV file. Memory stays flat at O(1) rows
 * regardless of catalog size — no arrays, no giant string, no sort.
 */
export async function streamMasterCsvFromSnapshot(
  path: string,
  options: SnapshotStreamOptions = {}
): Promise<{
  path: string;
  rowCount: number;
  skipped: number;
  byteSize: number;
  checksum: string;
  ms: number;
}> {
  const startedAt = Date.now();
  const meta = await getMasterSpecsSnapshotMeta();
  const headers = meta?.masterHeaders ?? [...MASTER_CSV_HEADERS];
  const writer = await openCsvWriter(path, headers);
  const hash = createHash("sha256");
  const skipSet = options.skipProviderKeys;
  let skipped = 0;
  try {
    for await (const row of iterateMasterRowsFromSnapshot()) {
      const providerKey = String(row.ProviderKey ?? "").trim();
      if (skipSet && providerKey && skipSet.has(providerKey)) {
        skipped += 1;
        continue;
      }
      // Hash the JSON form for a stable checksum (order-independent per row).
      hash.update(JSON.stringify(row));
      await writer.write(row);
    }
    const info = await writer.close();
    return {
      path: info.path,
      rowCount: info.rowCount,
      skipped,
      byteSize: info.byteSize,
      checksum: hash.digest("hex").slice(0, 16),
      ms: Date.now() - startedAt,
    };
  } catch (err) {
    await writer.abort();
    throw err;
  }
}

export async function streamSpecsCsvFromSnapshot(
  path: string,
  options: SnapshotStreamOptions = {}
): Promise<{
  path: string;
  rowCount: number;
  skipped: number;
  byteSize: number;
  checksum: string;
  ms: number;
}> {
  const startedAt = Date.now();
  const meta = await getMasterSpecsSnapshotMeta();
  const headers = meta?.specsHeaders ?? [...SPECS_CSV_HEADERS];
  const writer = await openCsvWriter(path, headers);
  const hash = createHash("sha256");
  const skipSet = options.skipProviderKeys;
  let skipped = 0;
  try {
    for await (const row of iterateSpecsRowsFromSnapshot()) {
      const providerKey = String(row.ProviderKey ?? "").trim();
      if (skipSet && providerKey && skipSet.has(providerKey)) {
        skipped += 1;
        continue;
      }
      hash.update(JSON.stringify(row));
      await writer.write(row);
    }
    const info = await writer.close();
    return {
      path: info.path,
      rowCount: info.rowCount,
      skipped,
      byteSize: info.byteSize,
      checksum: hash.digest("hex").slice(0, 16),
      ms: Date.now() - startedAt,
    };
  } catch (err) {
    await writer.abort();
    throw err;
  }
}
