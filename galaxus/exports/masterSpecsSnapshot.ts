import { createHash } from "crypto";
import { prisma } from "@/app/lib/prisma";
import { openCsvWriter, type CsvRow } from "@/galaxus/exports/csvStream";
import { isValidGtin } from "@/galaxus/exports/feedValidation";
import {
  loadMappingsByIdsForExport,
  hydrateExportCandidateKickdbRawJson,
  scanSlimMasterSpecsWinners,
  type FeedExportCandidate,
} from "@/galaxus/exports/feedMappingLoader";
import { filterExportCandidates } from "@/galaxus/exports/gtinSelection";
import {
  buildGalaxusAlternativeMasterRows,
  buildGalaxusAlternativeSpecRows,
  filterAlternativeProducts,
  loadAlternativeProductsForExport,
} from "@/galaxus/exports/alternative";
import {
  buildMasterRowsFromCandidates,
  buildSpecsRowsFromCandidates,
} from "@/galaxus/exports/masterSpecsFeed";
import { loadStxFeedGateProviderKeys } from "@/galaxus/exports/stxFeedGate";
import { loadWelCardOmitProviderKeys } from "@/galaxus/exports/welFeedOmit";
import { skipGalaxusFeedValidationForTrigger } from "@/galaxus/feedExecutor";
import { attachAvailableStock } from "@/inventory/availableStock";
import {
  isPhysicalMergeEnabled,
  loadPhysicalMirrorStockByGtin,
  type PhysicalStockMap,
} from "@/shopify/inventory/physicalAvailability";
import type { SlimGtinWinner } from "@/galaxus/exports/gtinSelection";

const SNAPSHOT_META_ID = "default";
const UPSERT_CHUNK_SIZE = 3000;
/** Pass-2 materialize batch — full include + rawJson for this many winners only. */
const MATERIALIZE_CHUNK_SIZE = 1500;

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

function maybeExposeGc(): void {
  try {
    if (typeof global.gc === "function") global.gc();
  } catch {
    // expose-gc not enabled
  }
}

function logHeap(phase: string, extra?: Record<string, unknown>): void {
  const heap = process.memoryUsage();
  console.info("[GALAXUS][FEED][SNAPSHOT][MASTER_SPECS] heap", {
    phase,
    heapMb: Math.round(heap.heapUsed / 1024 / 1024),
    rssMb: Math.round(heap.rss / 1024 / 1024),
    ...extra,
  });
}

function winnersByMappingId(
  winners: Map<string, SlimGtinWinner>
): Map<string, SlimGtinWinner> {
  const byId = new Map<string, SlimGtinWinner>();
  for (const winner of winners.values()) {
    byId.set(winner.mappingId, winner);
  }
  return byId;
}

function candidatesFromMappings(
  mappings: any[],
  winnersById: Map<string, SlimGtinWinner>
): FeedExportCandidate[] {
  const out: FeedExportCandidate[] = [];
  for (const mapping of mappings) {
    const mappingId = String(mapping?.id ?? "").trim();
    const winner = winnersById.get(mappingId);
    if (!winner) continue;
    out.push({
      mapping,
      variant: mapping.supplierVariant ?? null,
      product: mapping.kickdbVariant?.product ?? null,
      providerKey: winner.providerKey,
      gtin: winner.gtin,
      sellPriceExVat: winner.sellPriceExVat,
    });
  }
  return out;
}

async function insertMasterSnapshotRows(
  rows: Array<Record<string, string>>,
  now: Date
): Promise<number> {
  const prismaAny = prisma as any;
  let inserted = 0;
  for (let offset = 0; offset < rows.length; offset += UPSERT_CHUNK_SIZE) {
    const chunk = rows.slice(offset, offset + UPSERT_CHUNK_SIZE);
    const data = chunk
      .map((row) => {
        const providerKey = String(row.ProviderKey ?? "").trim();
        if (!providerKey) return null;
        return {
          providerKey,
          gtin: String(row.Gtin ?? "").trim() || null,
          supplierKey: providerKey.split("_")[0]?.trim() || null,
          rowJson: normaliseMasterRow(row),
          updatedAt: now,
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
    if (data.length === 0) continue;
    await prismaAny.galaxusFeedMasterSnapshot.createMany({ data, skipDuplicates: true });
    inserted += data.length;
  }
  return inserted;
}

async function insertSpecsSnapshotRows(
  rows: Array<Record<string, string>>,
  now: Date
): Promise<number> {
  const prismaAny = prisma as any;
  let inserted = 0;
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
    inserted += data.length;
  }
  return inserted;
}

/**
 * Phase-2 memory-flat rebuild:
 *   1) Slim cursor scan — Map of gtin to {mappingId, scores} only (no full-catalog graphs)
 *   2) Truncate snapshot tables (meta invalidated first)
 *   3) Materialize winners in chunks: load → hydrate → stock → build rows → insert → free
 * Peak heap stays well under 8GB; NODE_OPTIONS=10240 is headroom.
 */
export async function rebuildMasterSpecsSnapshot(params?: {
  supplier?: string | null;
  providerKeys?: string[];
}): Promise<SnapshotBuildResult> {
  const startedAt = Date.now();
  const supplier = params?.supplier ?? null;
  const providerKeys = params?.providerKeys;

  console.info("[GALAXUS][FEED][SNAPSHOT][MASTER_SPECS] rebuild phase", {
    phase: "slim-scan",
  });
  const slim = await scanSlimMasterSpecsWinners({
    supplier,
    providerKeys,
    includeTrmDiagnostics: false,
  });
  logHeap("slim-scan-done", {
    masterGtins: slim.masterByGtin.size,
    specsGtins: slim.specsByGtin.size,
    mappingsScanned: slim.mappingsScanned,
    scanMs: slim.ms,
  });

  const welPokemonKeys = await loadWelCardOmitProviderKeys();
  const stxGateKeys = await loadStxFeedGateProviderKeys();
  const blocked = new Set<string>([
    ...Array.from(welPokemonKeys),
    ...Array.from(stxGateKeys),
  ]);

  const masterById = winnersByMappingId(slim.masterByGtin);
  const specsById = winnersByMappingId(slim.specsByGtin);
  const unionIds = Array.from(
    new Set([...Array.from(masterById.keys()), ...Array.from(specsById.keys())])
  );

  // Invalidate before wipe so a mid-rebuild crash cannot serve truncated tables as ready.
  const prismaAny = prisma as any;
  await prismaAny.galaxusFeedSnapshotMeta.updateMany({
    where: { id: SNAPSHOT_META_ID },
    data: {
      masterRebuiltAt: null,
      specsRebuiltAt: null,
      masterRowCount: 0,
      specsRowCount: 0,
    },
  });
  await prismaAny.galaxusFeedMasterSnapshot.deleteMany({});
  await prismaAny.galaxusFeedSpecsSnapshot.deleteMany({});
  maybeExposeGc();
  logHeap("tables-wiped", { unionWinners: unionIds.length });

  const mergePhysical = isPhysicalMergeEnabled();
  const now = new Date();
  let masterRowCount = 0;
  let specsRowCount = 0;
  let criticalGtinIssues = 0;
  const invalidSupplierVariantIds: string[] = [];
  let materializeChunks = 0;

  console.info("[GALAXUS][FEED][SNAPSHOT][MASTER_SPECS] rebuild phase", {
    phase: "materialize",
    unionWinners: unionIds.length,
    chunkSize: MATERIALIZE_CHUNK_SIZE,
  });

  for (let offset = 0; offset < unionIds.length; offset += MATERIALIZE_CHUNK_SIZE) {
    const idChunk = unionIds.slice(offset, offset + MATERIALIZE_CHUNK_SIZE);
    materializeChunks += 1;
    const mappings = await loadMappingsByIdsForExport(idChunk);
    const masterFiltered = filterExportCandidates(
      candidatesFromMappings(mappings, masterById)
    );
    const specsFiltered = filterExportCandidates(
      candidatesFromMappings(mappings, specsById)
    );
    if (masterFiltered.invalidSupplierVariantIds.length > 0) {
      invalidSupplierVariantIds.push(...masterFiltered.invalidSupplierVariantIds);
    }
    if (specsFiltered.invalidSupplierVariantIds.length > 0) {
      invalidSupplierVariantIds.push(...specsFiltered.invalidSupplierVariantIds);
    }
    const masterCandidates = masterFiltered.valid as FeedExportCandidate[];
    const specsCandidates = specsFiltered.valid as FeedExportCandidate[];

    await hydrateExportCandidateKickdbRawJson(masterCandidates, specsCandidates);

    const stockBySupplierVariantId = await attachAvailableStock(
      masterCandidates.map((candidate) => candidate.variant).filter(Boolean)
    );
    let physicalByGtin: PhysicalStockMap = new Map();
    if (mergePhysical) {
      const gtins = masterCandidates
        .map((candidate) => String(candidate?.mapping?.gtin ?? candidate.gtin ?? "").trim())
        .filter((g) => g.length > 0);
      physicalByGtin = await loadPhysicalMirrorStockByGtin(gtins);
    }

    let masterRows = buildMasterRowsFromCandidates(
      masterCandidates,
      stockBySupplierVariantId,
      false,
      mergePhysical,
      physicalByGtin
    );
    let specsRows = buildSpecsRowsFromCandidates(specsCandidates);

    if (blocked.size > 0) {
      masterRows = masterRows.filter((row) => !blocked.has(String(row.ProviderKey ?? "").trim()));
      specsRows = specsRows.filter((row) => !blocked.has(String(row.ProviderKey ?? "").trim()));
    }

    // Bake critical GTIN failures (same as legacy validation report filter).
    const nextMaster: typeof masterRows = [];
    for (const row of masterRows) {
      const gtin = String(row.Gtin ?? "").trim();
      if (!gtin || !isValidGtin(gtin)) {
        criticalGtinIssues += 1;
        continue;
      }
      nextMaster.push(row);
    }
    masterRows = nextMaster;

    masterRowCount += await insertMasterSnapshotRows(masterRows, now);
    specsRowCount += await insertSpecsSnapshotRows(specsRows, now);

    if (materializeChunks % 20 === 0 || offset + MATERIALIZE_CHUNK_SIZE >= unionIds.length) {
      logHeap("materialize-progress", {
        chunk: materializeChunks,
        done: Math.min(offset + idChunk.length, unionIds.length),
        total: unionIds.length,
        masterRowCount,
        specsRowCount,
      });
    }

    masterRows.length = 0;
    specsRows.length = 0;
    masterCandidates.length = 0;
    specsCandidates.length = 0;
    mappings.length = 0;
    maybeExposeGc();
  }

  // NER alternatives — small set; price maps from slim specs winners (no full candidates).
  const allowAlternatives = !supplier || supplier.toLowerCase() === "ner";
  if (allowAlternatives) {
    const normalByGtin = new Map<string, number>();
    const normalByProviderKey = new Map<string, number>();
    for (const winner of slim.specsByGtin.values()) {
      if (winner.gtin && Number.isFinite(winner.sellPriceExVat)) {
        normalByGtin.set(winner.gtin, winner.sellPriceExVat);
      }
      if (winner.providerKey && Number.isFinite(winner.sellPriceExVat)) {
        normalByProviderKey.set(winner.providerKey, winner.sellPriceExVat);
      }
    }
    const alternatives = await loadAlternativeProductsForExport({
      providerKeys: providerKeys && providerKeys.length > 0 ? providerKeys : undefined,
    });
    const { exportable } = filterAlternativeProducts({
      alternatives,
      normalByGtin,
      normalByProviderKey,
    });
    let altMaster = buildGalaxusAlternativeMasterRows(exportable, {
      minimal: false,
      includeWeight: false,
    });
    let altSpecs = buildGalaxusAlternativeSpecRows(exportable);
    if (blocked.size > 0) {
      altMaster = altMaster.filter((row) => !blocked.has(String(row.ProviderKey ?? "").trim()));
      altSpecs = altSpecs.filter((row) => !blocked.has(String(row.ProviderKey ?? "").trim()));
    }
    masterRowCount += await insertMasterSnapshotRows(altMaster, now);
    specsRowCount += await insertSpecsSnapshotRows(altSpecs, now);
    console.info("[GALAXUS][FEED][SNAPSHOT][MASTER_SPECS] alternatives", {
      exportable: exportable.length,
      altMaster: altMaster.length,
      altSpecs: altSpecs.length,
    });
  }

  // Drop slim maps before meta write so GC can reclaim.
  slim.masterByGtin.clear();
  slim.specsByGtin.clear();
  masterById.clear();
  specsById.clear();
  unionIds.length = 0;
  maybeExposeGc();

  if (masterRowCount <= 0 || specsRowCount <= 0) {
    throw new Error(
      `Refusing to publish empty master/specs snapshot (master=${masterRowCount}, specs=${specsRowCount})`
    );
  }

  const finishedAt = new Date();
  await prismaAny.galaxusFeedSnapshotMeta.upsert({
    where: { id: SNAPSHOT_META_ID },
    create: {
      id: SNAPSHOT_META_ID,
      masterRowCount,
      specsRowCount,
      masterHeadersJson: [...MASTER_CSV_HEADERS],
      specsHeadersJson: [...SPECS_CSV_HEADERS],
      masterRebuiltAt: finishedAt,
      specsRebuiltAt: finishedAt,
      updatedAt: finishedAt,
    },
    update: {
      masterRowCount,
      specsRowCount,
      masterHeadersJson: [...MASTER_CSV_HEADERS],
      specsHeadersJson: [...SPECS_CSV_HEADERS],
      masterRebuiltAt: finishedAt,
      specsRebuiltAt: finishedAt,
      updatedAt: finishedAt,
    },
  });

  logHeap("rebuilt-done", { masterRowCount, specsRowCount });
  console.info("[GALAXUS][FEED][SNAPSHOT][MASTER_SPECS] rebuilt", {
    masterRowsOut: masterRowCount,
    specsRowsOut: specsRowCount,
    blockedWelPokemon: welPokemonKeys.size,
    blockedStxGate: stxGateKeys.size,
    criticalGtinIssues,
    materializeChunks,
    ms: Date.now() - startedAt,
  });

  return {
    masterRows: masterRowCount,
    specsRows: specsRowCount,
    ms: Date.now() - startedAt,
    criticalGtinIssues,
    invalidSupplierVariantIds,
  };
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
