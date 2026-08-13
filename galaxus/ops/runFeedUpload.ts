import { randomUUID, createHash } from "crypto";
import { prisma } from "@/app/lib/prisma";
import {
  GALAXUS_FEED_UPLOADS_DISABLED,
  GALAXUS_FEED_UPLOADS_MANUAL_ONLY,
} from "@/galaxus/config";
import {
  GALAXUS_SFTP_HOST,
  GALAXUS_PROVIDER_NAME,
  GALAXUS_ASSORTMENT_FILE,
  GALAXUS_SFTP_FEEDS_DIR,
  GALAXUS_SFTP_IN_DIR,
  GALAXUS_SFTP_OUT_DIR,
  GALAXUS_SFTP_FEED_UPLOAD_TIMEOUT_MS,
  GALAXUS_SFTP_PASSWORD,
  GALAXUS_SFTP_PORT,
  GALAXUS_SFTP_USER,
  GALAXUS_SUPPLIER_ID,
  assertSftpConfig,
} from "@/galaxus/edi/config";
import { uploadTempThenRename, withSftp } from "@/galaxus/edi/sftpClient";
import { runGalaxusExportGET } from "@/galaxus/ops/internalExportGet";
import { toCsvBuffer } from "@/galaxus/exports/csv";
import { buildMasterSpecsFeedExport } from "@/galaxus/exports/masterSpecsFeed";
import { countCriticalGtinIssues, collectCriticalGtinProviderKeys, filterCsvByProviderKeys } from "@/galaxus/exports/feedValidation";
import { shouldSkipGalaxusFeedCheckAll } from "@/galaxus/feedExecutor";
import {
  rebuildFeedSnapshotFromExports,
  tryExportCsvFromSnapshot,
} from "@/galaxus/exports/feedSnapshot";
import type { FeedTriggerSource } from "@/galaxus/ops/types";

export type FeedUploadInput = {
  origin: string;
  type: string;
  manual?: boolean;
  supplier?: string | null;
  providerKeysRaw?: string;
  force?: boolean;
  limit?: number | null;
  provider?: string | null;
  assortment?: string | null;
  triggerSource?: FeedTriggerSource | string | null;
};

export type FeedUploadResult = {
  ok: boolean;
  status: number;
  runId?: string;
  error?: string;
  counts?: Record<string, number | null>;
  uploaded?: UploadedFile[];
  [key: string]: unknown;
};

export function parseFeedUploadRequest(request: Request): FeedUploadInput {
  const url = new URL(request.url);
  const sp = url.searchParams;
  const limitRaw = sp.get("limit");
  return {
    origin: url.origin,
    type: (sp.get("type") ?? "all").toLowerCase(),
    manual: ["1", "true", "yes"].includes((sp.get("manual") ?? "").toLowerCase()),
    supplier: sp.get("supplier"),
    providerKeysRaw: sp.get("providerKeys")?.trim() ?? "",
    force: ["1", "true", "yes"].includes((sp.get("force") ?? "").toLowerCase()),
    limit: limitRaw ? Math.max(1, Math.min(Number(limitRaw), 1000)) : null,
    provider: sp.get("provider")?.trim() || null,
    assortment: sp.get("assortment")?.trim() || null,
  };
}

type UploadedFile = {
  name: string;
  path: string;
  size: number;
};

function countCsvRows(csv: string): number {
  if (!csv) return 0;
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return 0;
  return Math.max(0, lines.length - 1); // exclude header
}

function normalizeProviderName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase() || "digitecgalaxus";
}

function hashContent(value: string | Buffer): string {
  const hash = createHash("sha256");
  hash.update(value);
  return hash.digest("hex");
}

function extractSupplierKeysFromCsv(csv: string | Buffer): string[] {
  // Never materialize a multi-hundred-MB Buffer as one string — sample is enough for prefixes.
  const text = Buffer.isBuffer(csv)
    ? csv.subarray(0, Math.min(csv.length, 2_000_000)).toString("utf8")
    : csv;
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length <= 1) return [];
  const suppliers = new Set<string>();
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const first = line.split(",")[0] ?? "";
    const providerKey = first.replace(/^"|"$/g, "").trim();
    const supplierKey = providerKey.split("_")[0]?.trim();
    if (supplierKey) suppliers.add(supplierKey);
  }
  return Array.from(suppliers.values()).sort();
}

function csvByteLength(csv: string | Buffer): number {
  return Buffer.isBuffer(csv) ? csv.length : Buffer.byteLength(csv);
}

/** Provider keys present in a CSV (first column, header stripped). */
function collectProviderKeysFromCsv(csv: string): Set<string> {
  const out = new Set<string>();
  if (!csv) return out;
  const lines = csv.split(/\r?\n/);
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const first = line.split(",")[0] ?? "";
    const key = first.replace(/^"|"$/g, "").trim();
    if (key) out.add(key);
  }
  return out;
}

/** Drop rows whose ProviderKey is not in `keep` (header preserved). */
function keepCsvRowsByProviderKey(
  csv: string,
  keep: Set<string>
): { csv: string; kept: number; dropped: number } {
  if (!csv) return { csv, kept: 0, dropped: 0 };
  const lines = csv.split(/\r?\n/);
  if (lines.length === 0) return { csv, kept: 0, dropped: 0 };
  const header = lines[0];
  const out: string[] = [header];
  let kept = 0;
  let dropped = 0;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    if (!line.trim()) {
      out.push(line);
      continue;
    }
    const first = line.split(",")[0] ?? "";
    const key = first.replace(/^"|"$/g, "").trim();
    if (keep.has(key)) {
      out.push(line);
      kept += 1;
    } else {
      dropped += 1;
    }
  }
  const trailingNewline = csv.endsWith("\n") ? "\n" : "";
  return { csv: out.join("\n") + trailingNewline, kept, dropped };
}

function buildFeedFilename(
  type: "product" | "price" | "stock" | "specifications",
  providerName: string,
  assortmentFile: string
): string {
  const safeProvider = normalizeProviderName(providerName);
  const isAssortment = assortmentFile.toLowerCase() === type;
  const suffix = isAssortment ? "_assortment" : "";
  if (type === "price") return `PriceData_${safeProvider}${suffix}.csv`;
  if (type === "stock") return `StockData_${safeProvider}${suffix}.csv`;
  if (type === "specifications") return `SpecificationData_${safeProvider}${suffix}.csv`;
  return `ProductData_${safeProvider}${suffix}.csv`;
}

export async function runFeedUpload(input: FeedUploadInput): Promise<FeedUploadResult> {
  const runId = randomUUID();
  const startedAt = new Date();
  let auditId: string | null = null;
  try {
    if (GALAXUS_FEED_UPLOADS_DISABLED) {
      return { ok: false, status: 403, error: "Feed uploads are disabled" };
    }
    const manual = Boolean(input.manual);
    if (GALAXUS_FEED_UPLOADS_MANUAL_ONLY && !manual) {
      return { ok: false, status: 403, error: "Feed uploads are manual-only" };
    }
    assertSftpConfig();
    const supplier = input.supplier ?? null;
    const rawType = (input.type ?? "all").toLowerCase();
    const type = rawType === "price" ? "offer" : rawType;
    const effectiveType = type === "stock-price" || type === "offer-stock" ? "offer-stock" : type;
    const force = Boolean(input.force);
    const limit = input.limit ?? null;
    if (limit && !["1", "true", "yes"].includes(String(process.env.GALAXUS_FEED_ALLOW_LIMIT ?? "").toLowerCase())) {
      return {
        ok: false,
        status: 400,
        error:
          "Partial feed uploads (limit=…) are blocked for SFTP. Use export preview/download endpoints for sampling.",
      };
    }
    const origin = input.origin;
    const supplierParam = supplier?.trim() ? `&supplier=${encodeURIComponent(supplier.trim())}` : "";
    const providerKeysRaw = input.providerKeysRaw?.trim() ?? "";
    const providerKeysParam = providerKeysRaw
      ? `&providerKeys=${encodeURIComponent(providerKeysRaw)}`
      : "";
    const limitParam = limit ? `&limit=${limit}` : "";
    const providerName = input.provider?.trim() || GALAXUS_PROVIDER_NAME || "digitecgalaxus";
    const assortmentFile = input.assortment?.trim() || GALAXUS_ASSORTMENT_FILE || "price";

    const masterUrl = `${origin}/api/galaxus/export/master?${limit ? "limit=" + limit : "all=1"}${supplierParam}${limitParam}${providerKeysParam}`;
    const stockUrl = `${origin}/api/galaxus/export/stock?${limit ? "limit=" + limit : "all=1"}${supplierParam}${limitParam}${providerKeysParam}`;
    const offerUrl = `${origin}/api/galaxus/export/offer?${limit ? "limit=" + limit : "all=1"}${supplierParam}${limitParam}${providerKeysParam}`;
    const specsUrl = `${origin}/api/galaxus/export/specifications?${limit ? "limit=" + limit : "all=1"}${supplierParam}${limitParam}${providerKeysParam}`;

    const needsMaster =
      effectiveType === "all" || effectiveType === "master" || effectiveType === "master-specs";
    const needsStock = effectiveType === "all" || effectiveType === "offer-stock" || effectiveType === "stock";
    const needsOffer = effectiveType === "all" || effectiveType === "offer-stock" || effectiveType === "offer";
    const needsSpecs =
      effectiveType === "all" ||
      effectiveType === "specs" ||
      effectiveType === "specifications" ||
      effectiveType === "master-specs";
    const useSinglePassMasterSpecs = effectiveType === "master-specs";
    auditId = (await (prisma as any).galaxusJobRun.create({
      data: {
        jobName: "feeds-upload",
        runId,
        supplierKey: supplier?.trim() || null,
        startedAt,
        finishedAt: startedAt,
        success: false,
      },
    }))?.id ?? null;

    let masterCsv: string | Buffer = "";
    let stockCsv = "";
    let offerCsv = "";
    let specsCsv: string | Buffer = "";
    let masterCount: number | null = null;
    let stockCount: number | null = null;
    let offerCount: number | null = null;
    let specsCount: number | null = null;
    let report: any = null;
    let masterHeaders: string[] | null = null;
    let specsHeaders: string[] | null = null;
    let masterRowsForFilter: Array<Record<string, string>> | null = null;
    let specsRowsForFilter: Array<Record<string, string>> | null = null;

    if (useSinglePassMasterSpecs) {
      const providerKeys = providerKeysRaw
        .split(/[\n,]+/)
        .map((value) => value.trim())
        .filter(Boolean);
      const combined = await buildMasterSpecsFeedExport({
        supplier: supplier?.trim() || null,
        limit,
        providerKeys,
      });
      masterCsv = combined.masterCsv;
      specsCsv = combined.specsCsv;
      masterHeaders = combined.masterHeaders;
      specsHeaders = combined.specsHeaders;
      masterRowsForFilter = combined.masterRows;
      specsRowsForFilter = combined.specsRows;
      masterCount = combined.masterCount;
      specsCount = combined.specsCount;
      report = combined.report;
    } else {
      const stockFromSnapshot = needsStock
        ? await tryExportCsvFromSnapshot({
            scope: "stock",
            triggerSource: input.triggerSource,
          })
        : null;
      const offerFromSnapshot = needsOffer
        ? await tryExportCsvFromSnapshot({
            scope: "offer",
            triggerSource: input.triggerSource,
          })
        : null;

      const [masterRes, stockRes, offerRes, specsRes] = await Promise.all([
        needsMaster ? runGalaxusExportGET(masterUrl) : Promise.resolve(null),
        needsStock && !stockFromSnapshot ? runGalaxusExportGET(stockUrl) : Promise.resolve(null),
        needsOffer && !offerFromSnapshot ? runGalaxusExportGET(offerUrl) : Promise.resolve(null),
        needsSpecs ? runGalaxusExportGET(specsUrl) : Promise.resolve(null),
      ]);

      if (masterRes && !masterRes.ok) {
        const body = await masterRes.text().catch(() => "");
        throw new Error(`Master export failed: ${masterRes.status} ${masterRes.statusText} ${body}`);
      }
      if (stockRes && !stockRes.ok) {
        const body = await stockRes.text().catch(() => "");
        throw new Error(`Stock export failed: ${stockRes.status} ${stockRes.statusText} ${body}`);
      }
      if (offerRes && !offerRes.ok) {
        const body = await offerRes.text().catch(() => "");
        throw new Error(`Offer export failed: ${offerRes.status} ${offerRes.statusText} ${body}`);
      }
      if (specsRes && !specsRes.ok) {
        const body = await specsRes.text().catch(() => "");
        throw new Error(`Specifications export failed: ${specsRes.status} ${specsRes.statusText} ${body}`);
      }

      [masterCsv, stockCsv, offerCsv, specsCsv] = await Promise.all([
        masterRes ? masterRes.text() : Promise.resolve(""),
        stockFromSnapshot
          ? Promise.resolve(stockFromSnapshot.csv)
          : stockRes
            ? stockRes.text()
            : Promise.resolve(""),
        offerFromSnapshot
          ? Promise.resolve(offerFromSnapshot.csv)
          : offerRes
            ? offerRes.text()
            : Promise.resolve(""),
        specsRes ? specsRes.text() : Promise.resolve(""),
      ]);

      masterCount = masterRes ? countCsvRows(masterCsv) : null;
      stockCount = stockFromSnapshot
        ? stockFromSnapshot.count
        : stockRes
          ? countCsvRows(stockCsv)
          : null;
      offerCount = offerFromSnapshot
        ? offerFromSnapshot.count
        : offerRes
          ? countCsvRows(offerCsv)
          : null;
      specsCount = specsRes ? countCsvRows(specsCsv) : null;

      const skipValidation = shouldSkipGalaxusFeedCheckAll({
        triggerSource: input.triggerSource,
        stockFromSnapshot: Boolean(stockFromSnapshot),
        offerFromSnapshot: Boolean(offerFromSnapshot),
        needsMaster,
        needsSpecs,
      });
      if (skipValidation) {
        console.info("[GALAXUS][FEEDS][UPLOAD] Skipping check-all", {
          triggerSource: input.triggerSource,
          stockFromSnapshot: Boolean(stockFromSnapshot),
          offerFromSnapshot: Boolean(offerFromSnapshot),
        });
      }
      const shouldRunValidation =
        !skipValidation && (needsMaster || needsStock || needsSpecs);
      const validationScope = needsStock
        ? "all"
        : needsMaster && needsSpecs
          ? "master-specs"
          : needsMaster
            ? "master"
            : "specs";
      const validationUrl = `${origin}/api/galaxus/export/check-all?${limit ? "limit=" + limit : "all=1"}${supplierParam}${limitParam}&scope=${validationScope}`;
      const validationRes = shouldRunValidation ? await runGalaxusExportGET(validationUrl).catch(() => null) : null;
      const validationData = validationRes ? await validationRes.json().catch(() => null) : null;
      report = validationData?.report ?? null;
    }

    const totalIssues =
      (report?.summary?.master?.totalIssues ?? 0) +
      (report?.summary?.stock?.totalIssues ?? 0) +
      (report?.summary?.specs?.totalIssues ?? 0);
    const criticalGtinIssues =
      useSinglePassMasterSpecs || needsMaster || needsStock || needsSpecs
        ? countCriticalGtinIssues(report)
        : 0;
    const blockedProviderKeys = collectCriticalGtinProviderKeys(report ?? {});
    const omittedByFeed: Record<string, number> = {};
    if (blockedProviderKeys.size > 0) {
      // Prefer row-level filter + Buffer re-serialize for master-specs (string filter OOMs).
      if (
        useSinglePassMasterSpecs &&
        masterRowsForFilter &&
        specsRowsForFilter &&
        masterHeaders &&
        specsHeaders
      ) {
        const filteredMaster = masterRowsForFilter.filter(
          (row) => !blockedProviderKeys.has(String(row.ProviderKey ?? "").trim())
        );
        const filteredSpecs = specsRowsForFilter.filter(
          (row) => !blockedProviderKeys.has(String(row.ProviderKey ?? "").trim())
        );
        omittedByFeed.master = masterRowsForFilter.length - filteredMaster.length;
        omittedByFeed.specs = specsRowsForFilter.length - filteredSpecs.length;
        masterCsv = toCsvBuffer(masterHeaders, filteredMaster);
        specsCsv = toCsvBuffer(specsHeaders, filteredSpecs);
        masterCount = filteredMaster.length;
        specsCount = filteredSpecs.length;
      } else {
        if (typeof masterCsv === "string") {
          const masterFiltered = filterCsvByProviderKeys(masterCsv, blockedProviderKeys);
          masterCsv = masterFiltered.filteredCsv;
          omittedByFeed.master = masterFiltered.omittedRows;
        }
        const stockFiltered = filterCsvByProviderKeys(stockCsv, blockedProviderKeys);
        stockCsv = stockFiltered.filteredCsv;
        omittedByFeed.stock = stockFiltered.omittedRows;
        const offerFiltered = filterCsvByProviderKeys(offerCsv, blockedProviderKeys);
        offerCsv = offerFiltered.filteredCsv;
        omittedByFeed.offer = offerFiltered.omittedRows;
        if (typeof specsCsv === "string") {
          const specsFiltered = filterCsvByProviderKeys(specsCsv, blockedProviderKeys);
          specsCsv = specsFiltered.filteredCsv;
          omittedByFeed.specs = specsFiltered.omittedRows;
        }
        masterCount = masterCount != null ? Math.max(0, masterCount - (omittedByFeed.master ?? 0)) : null;
        stockCount = stockCount != null ? Math.max(0, stockCount - (omittedByFeed.stock ?? 0)) : null;
        offerCount = offerCount != null ? Math.max(0, offerCount - (omittedByFeed.offer ?? 0)) : null;
        specsCount = specsCount != null ? Math.max(0, specsCount - (omittedByFeed.specs ?? 0)) : null;
      }
      console.info("[GALAXUS][FEEDS][UPLOAD] Omitted critical-GTIN rows", {
        blockedProviderKeys: Array.from(blockedProviderKeys),
        omittedByFeed,
      });
    }
    const totalOmitted = Object.values(omittedByFeed).reduce((sum, value) => sum + value, 0);
    if (
      (useSinglePassMasterSpecs || needsMaster || needsStock || needsSpecs) &&
      !force &&
      totalIssues > 0 &&
      totalOmitted === 0 &&
      criticalGtinIssues === 0
    ) {
      const blockedManifests = [];
      if (needsMaster && masterCsv) {
        blockedManifests.push({
          exportType: "master",
          csv: masterCsv,
          count: masterCount ?? 0,
        });
      }
      if (needsStock && stockCsv) {
        blockedManifests.push({
          exportType: "stock",
          csv: stockCsv,
          count: stockCount ?? 0,
        });
      }
      if (needsOffer && offerCsv) {
        blockedManifests.push({
          exportType: "offer",
          csv: offerCsv,
          count: offerCount ?? 0,
        });
      }
    if (needsSpecs && specsCsv) {
      blockedManifests.push({
        exportType: "specs",
        csv: specsCsv,
        count: specsCount ?? 0,
      });
    }
      for (const entry of blockedManifests) {
        await (prisma as any).galaxusExportManifest.create({
          data: {
            runId,
            exportType: entry.exportType,
            supplierKeys: extractSupplierKeysFromCsv(entry.csv),
            productCount: entry.count ?? 0,
            checksum: hashContent(entry.csv),
            storagePointer: null,
            destination: null,
            uploadStatus: "blocked",
            responseJson: {
              error: "validation_failed",
              criticalGtinIssues,
              omittedByFeed,
              blockedProviderKeys: Array.from(blockedProviderKeys),
            },
            validationIssuesJson: report ?? undefined,
          },
        });
      }
      if (auditId) {
        await (prisma as any).galaxusJobRun.update({
          where: { id: auditId },
          data: {
            finishedAt: new Date(),
            success: false,
            errorMessage: "Validation failed",
            resultJson: { validation: report, criticalGtinIssues, omittedByFeed },
          },
        });
      }
      return {
        ok: false,
        status: 409,
        runId,
        error: "Validation failed. Fix remaining issues or pass force=1.",
        report,
        criticalGtinIssues,
        omittedByFeed,
        blockedProviderKeys: Array.from(blockedProviderKeys),
      };
    }
    // Stock and offer exports each apply their own skip rules (offer drops rows
    // with invalid price, stock drops rows with no eta/qty resolution), so the
    // two CSVs can naturally diverge even though they are built from the same
    // catalog. Galaxus requires strict row parity between the two feeds, so we
    // reconcile by intersecting the ProviderKey sets and dropping the divergent
    // rows on both sides instead of aborting the upload.
    const parityDrops = { fromStock: [] as string[], fromOffer: [] as string[] };
    if (needsStock && needsOffer && stockCsv && offerCsv && stockCount !== offerCount) {
      const stockKeys = collectProviderKeysFromCsv(stockCsv);
      const offerKeys = collectProviderKeysFromCsv(offerCsv);
      const shared = new Set<string>();
      for (const key of stockKeys) if (offerKeys.has(key)) shared.add(key);
      for (const key of stockKeys) if (!shared.has(key)) parityDrops.fromStock.push(key);
      for (const key of offerKeys) if (!shared.has(key)) parityDrops.fromOffer.push(key);

      const stockReconciled = keepCsvRowsByProviderKey(stockCsv, shared);
      const offerReconciled = keepCsvRowsByProviderKey(offerCsv, shared);
      stockCsv = stockReconciled.csv;
      offerCsv = offerReconciled.csv;
      stockCount = stockReconciled.kept;
      offerCount = offerReconciled.kept;

      console.warn("[GALAXUS][FEEDS][UPLOAD] Reconciled stock<->offer row parity", {
        sharedProviderKeys: shared.size,
        droppedFromStock: parityDrops.fromStock.length,
        droppedFromOffer: parityDrops.fromOffer.length,
        sampleDroppedFromStock: parityDrops.fromStock.slice(0, 10),
        sampleDroppedFromOffer: parityDrops.fromOffer.slice(0, 10),
      });
    }
    // Master/specs are catalog-oriented and can have more rows than stock/offer.

    // Hard safety: never upload empty feeds to Galaxus.
    // Empty files silently delist / break assortment state on partner side.
    const emptyFeeds: string[] = [];
    if (needsMaster && (masterCount ?? 0) <= 0) emptyFeeds.push("master");
    if (needsStock && (stockCount ?? 0) <= 0) emptyFeeds.push("stock");
    if (needsOffer && (offerCount ?? 0) <= 0) emptyFeeds.push("offer");
    if (needsSpecs && (specsCount ?? 0) <= 0) emptyFeeds.push("specs");
    if (emptyFeeds.length > 0) {
      const error = `Refusing upload: empty feed(s): ${emptyFeeds.join(", ")}`;
      if (auditId) {
        await (prisma as any).galaxusJobRun.update({
          where: { id: auditId },
          data: {
            finishedAt: new Date(),
            success: false,
            errorMessage: error,
            resultJson: {
              emptyFeeds,
              counts: { master: masterCount, stock: stockCount, offer: offerCount, specs: specsCount },
              omittedByFeed,
              blockedProviderKeys: Array.from(blockedProviderKeys),
            },
          },
        });
      }
      return {
        ok: false,
        status: 409,
        runId,
        error,
        emptyFeeds,
        counts: { master: masterCount, stock: stockCount, offer: offerCount, specs: specsCount },
      };
    }

    const masterName = buildFeedFilename("product", providerName, assortmentFile);
    const stockName = buildFeedFilename("stock", providerName, assortmentFile);
    const offerName = buildFeedFilename("price", providerName, assortmentFile);
    const specsName = buildFeedFilename("specifications", providerName, assortmentFile);

    const uploads: UploadedFile[] = [];
    const manifestEntries: Array<{
      exportType: string;
      csv: string | Buffer;
      count: number | null;
      name: string;
      path: string;
      size: number;
    }> = [];

    await withSftp(
      {
        host: GALAXUS_SFTP_HOST,
        port: GALAXUS_SFTP_PORT,
        username: GALAXUS_SFTP_USER,
        password: GALAXUS_SFTP_PASSWORD,
      },
      async (client) => {
        const sftpStarted = Date.now();
        // One SFTP client — ops must stay sequential (ssh2-sftp is not concurrent-safe).
        if (needsMaster) {
          await uploadTempThenRename(client, GALAXUS_SFTP_FEEDS_DIR, masterName, masterCsv);
          const masterSize = csvByteLength(masterCsv);
          uploads.push({
            name: masterName,
            path: `${GALAXUS_SFTP_FEEDS_DIR.replace(/\/$/, "")}/${masterName}`,
            size: masterSize,
          });
          manifestEntries.push({
            exportType: "master",
            csv: masterCsv,
            count: masterCount ?? null,
            name: masterName,
            path: `${GALAXUS_SFTP_FEEDS_DIR.replace(/\/$/, "")}/${masterName}`,
            size: masterSize,
          });
          console.info("[GALAXUS][FEEDS][UPLOAD] sftp master done", {
            bytes: masterSize,
            ms: Date.now() - sftpStarted,
          });
        }

        if (needsStock) {
          await uploadTempThenRename(client, GALAXUS_SFTP_FEEDS_DIR, stockName, stockCsv);
          uploads.push({
            name: stockName,
            path: `${GALAXUS_SFTP_FEEDS_DIR.replace(/\/$/, "")}/${stockName}`,
            size: Buffer.byteLength(stockCsv),
          });
          manifestEntries.push({
            exportType: "stock",
            csv: stockCsv,
            count: stockCount ?? null,
            name: stockName,
            path: `${GALAXUS_SFTP_FEEDS_DIR.replace(/\/$/, "")}/${stockName}`,
            size: Buffer.byteLength(stockCsv),
          });
        }
        if (needsOffer) {
          await uploadTempThenRename(client, GALAXUS_SFTP_FEEDS_DIR, offerName, offerCsv);
          uploads.push({
            name: offerName,
            path: `${GALAXUS_SFTP_FEEDS_DIR.replace(/\/$/, "")}/${offerName}`,
            size: Buffer.byteLength(offerCsv),
          });
          manifestEntries.push({
            exportType: "offer",
            csv: offerCsv,
            count: offerCount ?? null,
            name: offerName,
            path: `${GALAXUS_SFTP_FEEDS_DIR.replace(/\/$/, "")}/${offerName}`,
            size: Buffer.byteLength(offerCsv),
          });
        }
        if (needsSpecs) {
          const specsUploadStarted = Date.now();
          await uploadTempThenRename(client, GALAXUS_SFTP_FEEDS_DIR, specsName, specsCsv);
          const specsSize = csvByteLength(specsCsv);
          uploads.push({
            name: specsName,
            path: `${GALAXUS_SFTP_FEEDS_DIR.replace(/\/$/, "")}/${specsName}`,
            size: specsSize,
          });
          manifestEntries.push({
            exportType: "specs",
            csv: specsCsv,
            count: specsCount ?? null,
            name: specsName,
            path: `${GALAXUS_SFTP_FEEDS_DIR.replace(/\/$/, "")}/${specsName}`,
            size: specsSize,
          });
          console.info("[GALAXUS][FEEDS][UPLOAD] sftp specs done", {
            bytes: specsSize,
            ms: Date.now() - specsUploadStarted,
          });
        }
        console.info("[GALAXUS][FEEDS][UPLOAD] sftp all done", { ms: Date.now() - sftpStarted });
      },
      { timeoutMs: GALAXUS_SFTP_FEED_UPLOAD_TIMEOUT_MS }
    );

    const destination = `sftp://${GALAXUS_SFTP_HOST}:${GALAXUS_SFTP_PORT}${GALAXUS_SFTP_FEEDS_DIR}`;
    for (const entry of manifestEntries) {
      await (prisma as any).galaxusExportManifest.create({
        data: {
          runId,
          exportType: entry.exportType,
          supplierKeys: extractSupplierKeysFromCsv(entry.csv),
          productCount: entry.count ?? 0,
          checksum: hashContent(entry.csv),
          storagePointer: entry.path,
          destination,
          uploadStatus: "uploaded",
          responseJson: { filename: entry.name, size: entry.size, omittedRows: omittedByFeed[entry.exportType] ?? 0 },
          validationIssuesJson: report ?? undefined,
        },
      });
    }

    const isLocal =
      !GALAXUS_SFTP_HOST ||
      GALAXUS_SFTP_HOST === "localhost" ||
      GALAXUS_SFTP_HOST === "127.0.0.1" ||
      GALAXUS_SFTP_HOST.startsWith("192.168.");
    const payload = {
      ok: true,
      type,
      limit,
      runId,
      sftpHost: GALAXUS_SFTP_HOST,
      sftpPort: GALAXUS_SFTP_PORT,
      supplierId: GALAXUS_SUPPLIER_ID,
      inDir: GALAXUS_SFTP_IN_DIR,
      outDir: GALAXUS_SFTP_OUT_DIR,
      feedsDir: GALAXUS_SFTP_FEEDS_DIR,
      uploaded: uploads,
      isRealGalaxus: GALAXUS_SFTP_HOST === "ftp.digitecgalaxus.ch",
      warning: isLocal
        ? "Uploaded to LOCAL SFTP. Galaxus staff cannot see these files."
        : null,
      counts: {
        master: masterCount,
        stock: stockCount,
        offer: offerCount,
        specs: specsCount,
      },
      omittedByFeed,
      blockedProviderKeys: Array.from(blockedProviderKeys),
      parityDrops: {
        fromStock: parityDrops.fromStock.length,
        fromOffer: parityDrops.fromOffer.length,
        sampleFromStock: parityDrops.fromStock.slice(0, 20),
        sampleFromOffer: parityDrops.fromOffer.slice(0, 20),
      },
      validation: report ?? null,
    };
    if (auditId) {
      await (prisma as any).galaxusJobRun.update({
        where: { id: auditId },
        data: {
          finishedAt: new Date(),
          success: true,
          resultJson: payload,
        },
      });
    }
    return { ...payload, status: 200 };
  } catch (error: any) {
    console.error("[GALAXUS][FEEDS][UPLOAD] Failed:", error);
    if (auditId) {
      await (prisma as any).galaxusJobRun.update({
        where: { id: auditId },
        data: {
          finishedAt: new Date(),
          success: false,
          errorMessage: error?.message ?? "Upload failed.",
        },
      });
    }
    return {
      ok: false,
      status: 500,
      runId,
      error: error?.message ?? "Upload failed.",
    };
  }
}
