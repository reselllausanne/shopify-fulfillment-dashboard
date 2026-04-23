import path from "path";
import { prisma } from "@/app/lib/prisma";
import { parseCsv } from "@/app/lib/csv";
import { normalizeSize, normalizeSku, parsePriceSafe, validateGtin } from "@/app/lib/normalize";
import { buildDuplicateKey, buildSupplierVariantId, computeLastRowByKey } from "@/app/lib/partnerImport";
import { assertMappingIntegrity, buildProviderKey, normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import {
  bulkUpsertSupplierVariantsPartnerImport,
  bulkUpsertVariantMappings,
  bulkUpdateSupplierVariants,
  chunkArray,
  remapRowsToExistingProviderKeyGtin,
} from "@/galaxus/jobs/bulkSql";
import { requestFeedPush } from "@/galaxus/ops/feedPipeline";
import { resolveAppOriginForPartnerJobs } from "@/app/lib/partnerJobOrigin";
import { enqueueJob } from "@/galaxus/jobs/queue";

const REQUIRED_HEADERS = ["providerKey", "sku", "size", "rawStock", "price"];

const PARTNER_PENDING_STATUSES = ["PENDING_ENRICH", "PENDING_GTIN", "AMBIGUOUS_GTIN"] as const;

type ValidImportRow = {
  rowNum: number;
  supplierVariantId: string;
  providerKeyValue: string;
  normalizedSku: string;
  normalizedSize: string;
  sizeRaw: string;
  stock: number;
  price: number;
  productName?: string | null;
  brand?: string | null;
  imageUrl?: string | null;
  gtinProvided?: string | null;
  /** Optional; same names as DB columns — feeds Decathlon/Galaxus when KickDB is absent. */
  supplierGender?: string | null;
  supplierColorway?: string | null;
};

export type PartnerCsvImportRowOutcome = {
  row: number;
  status:
    | "RESOLVED"
    | "PENDING_GTIN"
    | "AMBIGUOUS_GTIN"
    | "PENDING_ENRICH"
    | "ERROR"
    | "DUPLICATE_IGNORED"
    | "DRY_RUN";
  gtin?: string | null;
  gtinCandidates?: string[];
  error?: string;
  warning?: string;
};

export type PartnerCsvImportContext = {
  partnerId: string;
  /** When null (dry run), no PartnerUpload row is touched */
  uploadId: string | null;
  dryRun: boolean;
  /** Base URL for feed push (e.g. https://example.com) */
  origin: string | null;
};

export type PartnerCsvImportResult = {
  uploadId: string | null;
  enrichJobId: string | null;
  importedRows: number;
  newRows: number;
  errorRows: number;
  errors: Array<{ row: number; field: string; message: string }>;
  rows: PartnerCsvImportRowOutcome[];
  dryRun: boolean;
  removedMissing: number;
  removeSkipped: boolean;
};

export function partnerCsvQueueFilePath(uploadId: string): string {
  return path.join(process.cwd(), ".data", "partner-upload-queue", `${uploadId}.csv`);
}

export async function runPartnerCsvImport(
  csvText: string,
  ctx: PartnerCsvImportContext
): Promise<PartnerCsvImportResult> {
  const prismaAny = prisma as any;
  const upload =
    ctx.dryRun || !ctx.uploadId
      ? null
      : await prismaAny.partnerUpload.findFirst({
          where: { id: ctx.uploadId, partnerId: ctx.partnerId },
        });
  if (!ctx.dryRun && ctx.uploadId && !upload) {
    throw new Error("Upload not found or access denied");
  }

  const rows = parseCsv(csvText);
  if (!rows.length) {
    throw new Error("CSV is empty");
  }

  const headers = rows[0].map((value) => value.trim());
  const headerMap = new Map(headers.map((value, index) => [value, index]));
  const normalizeHeader = (value: string) => value.toLowerCase().replace(/[\s_-]+/g, "");
  const headerMapNormalized = new Map(
    headers.map((value, index) => [normalizeHeader(value), index])
  );
  const hasHeader = (header: string) =>
    headerMap.has(header) || headerMapNormalized.has(normalizeHeader(header));
  const missingHeaders = REQUIRED_HEADERS.filter((header) => !hasHeader(header));
  if (missingHeaders.length) {
    throw new Error(`Missing headers: ${missingHeaders.join(", ")}`);
  }

  const dryRun = ctx.dryRun;
  const errors: Array<{ row: number; field: string; message: string }> = [];
  const rowOutcomes: PartnerCsvImportRowOutcome[] = [];
  let importedRows = 0;
  let newRows = 0;
  let enrichJobId: string | null = null;
  const partner = await prismaAny.partner.findUnique({
    where: { id: ctx.partnerId },
  });
  if (!partner) {
    throw new Error("Partner not found.");
  }
  const partnerKey = normalizeProviderKey(partner.key);
  const cleanPartnerKey = partnerKey ? partnerKey.trim().toLowerCase().replace(/[^a-z0-9]/g, "") : null;
  const seenSupplierVariantIds = new Set<string>();

  const lastRowByKey = computeLastRowByKey(rows, headerMap);
  const validImports: ValidImportRow[] = [];

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const read = (header: string) => {
      const idx =
        headerMap.get(header) ??
        headerMapNormalized.get(normalizeHeader(header)) ??
        -1;
      return row[idx]?.trim() ?? "";
    };
    const readAny = (headers: string[]) => {
      for (const header of headers) {
        const value = read(header);
        if (value) return value;
      }
      return "";
    };
    const readByPredicate = (predicate: (normalizedHeader: string) => boolean) => {
      for (const [normalized, index] of headerMapNormalized.entries()) {
        if (!predicate(normalized)) continue;
        const value = row[index]?.trim() ?? "";
        if (value) return value;
      }
      return "";
    };

    const providerKeyRaw = read("providerKey");
    const skuRaw = read("sku");
    const sizeRaw = read("size");
    const stockRaw = read("rawStock");
    const priceRaw = read("price");
    const gtinRaw = readAny(["gtin", "ean", "barcode", "gtin14", "gtin13", "upc"]);
    const productNameRaw = readAny([
      "productName",
      "product_name",
      "name",
      "title",
      "product",
    ]);
    const brandRaw = readAny([
      "brand",
      "brandName",
      "brand_name",
      "brand name",
    ]);
    const imageRaw = readAny([
      "image",
      "imageUrl",
      "image_url",
      "image url",
      "imageLink",
      "image_link",
    ]);
    const supplierGenderRaw =
      readAny(["supplierGender", "gender", "sex"]) ||
      readByPredicate((normalized) => normalized.includes("gender"));
    const supplierColorwayRaw =
      readAny([
        "supplierColorway",
        "colorway",
        "colourway",
        "color",
        "colour",
      ]) ||
      readByPredicate(
        (normalized) =>
          normalized.includes("colorway") ||
          normalized.includes("colourway") ||
          (normalized.includes("color") && normalized.includes("supplier")) ||
          (normalized.includes("colour") && normalized.includes("supplier"))
      );
    const rowErrors: Array<{ field: string; message: string }> = [];

    const dupeKey = buildDuplicateKey(providerKeyRaw, skuRaw, sizeRaw);
    if (dupeKey) {
      if (lastRowByKey.get(dupeKey) !== i) {
        rowOutcomes.push({
          row: i + 1,
          status: "DUPLICATE_IGNORED",
          warning: "Duplicate row, last occurrence wins",
        });
        continue;
      }
    }

    const providerKey = normalizeProviderKey(providerKeyRaw);
    if (!providerKey) {
      rowErrors.push({ field: "providerKey", message: "Must be 3 uppercase letters" });
    }
    if (providerKey && partnerKey && providerKey !== partnerKey) {
      rowErrors.push({
        field: "providerKey",
        message: `Provider key must be ${partnerKey}`,
      });
    }

    const sku = normalizeSku(skuRaw);
    if (!sku) rowErrors.push({ field: "sku", message: "Required" });
    const sizeNormalized = normalizeSize(sizeRaw);
    if (!sizeRaw || !sizeNormalized) rowErrors.push({ field: "size", message: "Required" });

    const stockValue = stockRaw.replace(/\u00A0/g, " ").trim();
    if (!/^\d+$/.test(stockValue)) {
      rowErrors.push({ field: "rawStock", message: "Invalid number" });
    }
    const stock = Number.parseInt(stockValue, 10);
    const price = parsePriceSafe(priceRaw);
    if (price === null) {
      rowErrors.push({ field: "price", message: "Invalid number" });
    }
    const gtinProvided = gtinRaw ? (validateGtin(gtinRaw) ? gtinRaw : null) : null;
    if (gtinRaw && !gtinProvided) {
      rowErrors.push({ field: "gtin", message: "Invalid GTIN" });
    }
    const productName = productNameRaw ? productNameRaw.trim() : null;
    const brand = brandRaw ? brandRaw.trim() : null;
    const imageUrl = imageRaw ? imageRaw.trim() : null;
    const supplierGender = supplierGenderRaw ? supplierGenderRaw.trim() : null;
    const supplierColorway = supplierColorwayRaw ? supplierColorwayRaw.trim() : null;

    if (rowErrors.length > 0) {
      rowErrors.forEach((err) => errors.push({ row: i + 1, ...err }));
      rowOutcomes.push({
        row: i + 1,
        status: "ERROR",
        error: rowErrors.map((item) => `${item.field}: ${item.message}`).join("; "),
      });
      continue;
    }

    const rowPrice = price!;

    if (dryRun) {
      rowOutcomes.push({ row: i + 1, status: "DRY_RUN" });
      importedRows += 1;
      continue;
    }

    const providerKeyValue = providerKey!;
    const normalizedSku = sku!;
    const normalizedSize = sizeNormalized!;
    let supplierVariantId: string;
    try {
      supplierVariantId = buildSupplierVariantId(providerKeyValue, normalizedSku, normalizedSize);
    } catch {
      rowOutcomes.push({ row: i + 1, status: "ERROR", error: "Invalid providerKey for variant id" });
      continue;
    }
    seenSupplierVariantIds.add(supplierVariantId);
    validImports.push({
      rowNum: i + 1,
      supplierVariantId,
      providerKeyValue,
      normalizedSku,
      normalizedSize,
      sizeRaw,
      stock,
      price: rowPrice,
      productName,
      brand,
      imageUrl,
      gtinProvided,
      supplierGender,
      supplierColorway,
    });
  }

  if (!dryRun && validImports.length > 0) {
    const now = new Date();
    const uniqueIds = [...new Set(validImports.map((v) => v.supplierVariantId))];
    const existingById = new Map<string, { gtin: string | null; providerKey: string | null }>();
    for (const batch of chunkArray(uniqueIds, 500)) {
      const found = await prismaAny.supplierVariant.findMany({
        where: { supplierVariantId: { in: batch } },
        select: { supplierVariantId: true, gtin: true, providerKey: true },
      });
      for (const r of found) {
        existingById.set(r.supplierVariantId, { gtin: r.gtin ?? null, providerKey: r.providerKey ?? null });
      }
    }

    const pendingRows = await prismaAny.partnerUploadRow.findMany({
      where: {
        partnerId: ctx.partnerId,
        status: { in: [...PARTNER_PENDING_STATUSES] },
      },
      orderBy: { updatedAt: "desc" },
    });
    const pendingByTriple = new Map<string, { id: string }>();
    for (const pr of pendingRows) {
      const k = `${pr.providerKey}|${pr.sku}|${pr.sizeNormalized}`;
      if (!pendingByTriple.has(k)) pendingByTriple.set(k, { id: pr.id });
    }

    type VariantBulkRow = {
      supplierVariantId: string;
      supplierSku: string;
      providerKey: string | null;
      gtin: string | null;
      price: number;
      stock: number;
      sizeRaw: string | null;
      sizeNormalized: string | null;
    };
    const variantBulkScratch: VariantBulkRow[] = [];
    const supplierUpdates: Array<{
      supplierVariantId: string;
      supplierSku?: string;
      providerKey?: string | null;
      gtin?: string | null;
      supplierBrand?: string | null;
      supplierProductName?: string | null;
      images?: unknown;
      supplierGender?: string | null;
      supplierColorway?: string | null;
    }> = [];
    const mappingUpserts: Array<{
      supplierVariantId: string;
      gtin: string | null;
      providerKey: string | null;
      status: string;
      kickdbVariantId?: string | null;
    }> = [];
    const canonicalIdByImportIndex: string[] = new Array(validImports.length);

    type RowWork = {
      v: ValidImportRow;
      providerKeyFromGtin: string | null;
      providedGtin: string | null;
    };
    const rowWork: RowWork[] = [];

    for (const v of validImports) {
      const existing = existingById.get(v.supplierVariantId);
      const existingGtin = existing?.gtin ?? null;
      const existingProviderKey = existing?.providerKey ?? null;
      const providedGtin = v.gtinProvided ?? null;
      const effectiveGtin = providedGtin ?? existingGtin;
      const providerKeyFromGtin = effectiveGtin
        ? buildProviderKey(effectiveGtin, v.supplierVariantId)
        : null;
      const providerKeyForDb = effectiveGtin
        ? (providerKeyFromGtin ?? existingProviderKey)
        : existingProviderKey;

      if (effectiveGtin) {
        assertMappingIntegrity({
          supplierVariantId: v.supplierVariantId,
          gtin: effectiveGtin,
          providerKey: providerKeyFromGtin,
          status: providedGtin ? "SUPPLIER_GTIN" : "MATCHED",
        });
      }

      variantBulkScratch.push({
        supplierVariantId: v.supplierVariantId,
        supplierSku: v.normalizedSku,
        providerKey: providerKeyForDb,
        gtin: effectiveGtin,
        price: v.price,
        stock: v.stock,
        sizeRaw: v.sizeRaw,
        sizeNormalized: v.normalizedSize,
      });
      rowWork.push({ v, providerKeyFromGtin, providedGtin });
    }

    const { rows: remappedVariantRows } = await remapRowsToExistingProviderKeyGtin(
      variantBulkScratch.map((row) => ({
        supplierVariantId: row.supplierVariantId,
        providerKey: row.providerKey,
        gtin: row.gtin,
      }))
    );

    const remappedScratch: VariantBulkRow[] = variantBulkScratch.map((row, i) => ({
      ...row,
      supplierVariantId: remappedVariantRows[i]!.supplierVariantId,
    }));

    for (let idx = 0; idx < rowWork.length; idx += 1) {
      const { v, providerKeyFromGtin, providedGtin } = rowWork[idx]!;
      const canonicalId = remappedVariantRows[idx]!.supplierVariantId;
      canonicalIdByImportIndex[idx] = canonicalId;
      seenSupplierVariantIds.add(v.supplierVariantId);
      seenSupplierVariantIds.add(canonicalId);

      if (providedGtin) {
        mappingUpserts.push({
          supplierVariantId: canonicalId,
          gtin: providedGtin,
          providerKey: providerKeyFromGtin ?? null,
          status: "SUPPLIER_GTIN",
          kickdbVariantId: null,
        });
      }
      if (
        v.productName ||
        v.brand ||
        v.imageUrl ||
        providedGtin ||
        v.supplierGender ||
        v.supplierColorway
      ) {
        supplierUpdates.push({
          supplierVariantId: canonicalId,
          supplierSku: v.normalizedSku,
          providerKey: providerKeyFromGtin ?? undefined,
          gtin: providedGtin ?? undefined,
          supplierBrand: v.brand ?? undefined,
          supplierProductName: v.productName ?? undefined,
          images: v.imageUrl ? [v.imageUrl] : undefined,
          supplierGender: v.supplierGender ?? undefined,
          supplierColorway: v.supplierColorway ?? undefined,
        });
      }
    }

    const variantBulkDedup = new Map<string, VariantBulkRow>();
    for (const row of remappedScratch) {
      variantBulkDedup.set(row.supplierVariantId, row);
    }
    const variantBulk = [...variantBulkDedup.values()];

    for (const batch of chunkArray(variantBulk, 400)) {
      await bulkUpsertSupplierVariantsPartnerImport(batch, now);
    }
    for (const batch of chunkArray(mappingUpserts, 200)) {
      if (batch.length === 0) continue;
      await bulkUpsertVariantMappings(batch, now, { doNotDowngradeFromMatched: false });
    }
    for (const batch of chunkArray(supplierUpdates, 200)) {
      if (batch.length === 0) continue;
      await bulkUpdateSupplierVariants(batch, now, { updateGtinWhenProvided: true });
    }

    /** After upserts, GTIN may only exist on the canonical (remapped) SupplierVariant row */
    const resolutionIds = new Set<string>();
    for (let vi = 0; vi < validImports.length; vi += 1) {
      const v = validImports[vi]!;
      resolutionIds.add(canonicalIdByImportIndex[vi] ?? v.supplierVariantId);
      resolutionIds.add(v.supplierVariantId);
    }
    const gtinBySupplierVariantId = new Map<string, string | null>();
    for (const batch of chunkArray([...resolutionIds], 500)) {
      if (batch.length === 0) continue;
      const found = await prismaAny.supplierVariant.findMany({
        where: { supplierVariantId: { in: batch } },
        select: { supplierVariantId: true, gtin: true },
      });
      for (const r of found) {
        gtinBySupplierVariantId.set(r.supplierVariantId, r.gtin ?? null);
      }
    }
    const pickValidGtin = (id: string): string | null => {
      const g = gtinBySupplierVariantId.get(id) ?? null;
      return g && validateGtin(g) ? g : null;
    };

    type UploadCreate = {
      uploadId: string | null;
      partnerId: string;
      supplierVariantId: string;
      providerKey: string;
      sku: string;
      sizeRaw: string;
      sizeNormalized: string;
      rawStock: number;
      price: number;
      status: string;
      gtinResolved: null;
    };
    const uploadCreates: UploadCreate[] = [];
    const uploadUpdates: Array<{ id: string; data: Record<string, unknown> }> = [];

    for (let vi = 0; vi < validImports.length; vi += 1) {
      const v = validImports[vi]!;
      const catalogId = canonicalIdByImportIndex[vi] ?? v.supplierVariantId;
      const resolvedGtin =
        v.gtinProvided ?? pickValidGtin(catalogId) ?? pickValidGtin(v.supplierVariantId);
      const isNewRow = !existingById.has(v.supplierVariantId);
      const shouldEnrich = isNewRow && !resolvedGtin;
      const tripleKey = `${v.providerKeyValue}|${v.normalizedSku}|${v.normalizedSize}`;
      const existingPending = pendingByTriple.get(tripleKey);

      if (shouldEnrich) {
        newRows += 1;
        if (existingPending) {
          uploadUpdates.push({
            id: existingPending.id,
            data: {
              uploadId: upload?.id ?? null,
              partnerId: ctx.partnerId,
              supplierVariantId: catalogId,
              providerKey: v.providerKeyValue,
              sku: v.normalizedSku,
              sizeRaw: v.sizeRaw,
              sizeNormalized: v.normalizedSize,
              rawStock: v.stock,
              price: v.price,
              status: "PENDING_ENRICH",
              gtinResolved: null,
              updatedAt: now,
            },
          });
        } else {
          uploadCreates.push({
            uploadId: upload?.id ?? null,
            partnerId: ctx.partnerId,
            supplierVariantId: catalogId,
            providerKey: v.providerKeyValue,
            sku: v.normalizedSku,
            sizeRaw: v.sizeRaw,
            sizeNormalized: v.normalizedSize,
            rawStock: v.stock,
            price: v.price,
            status: "PENDING_ENRICH",
            gtinResolved: null,
          });
        }
        rowOutcomes.push({ row: v.rowNum, status: "PENDING_ENRICH" });
      } else {
        if (existingPending) {
          uploadUpdates.push({
            id: existingPending.id,
            data: {
              supplierVariantId: catalogId,
              status: "RESOLVED",
              gtinResolved: resolvedGtin,
              updatedAt: now,
            },
          });
        }
        rowOutcomes.push({
          row: v.rowNum,
          status: "RESOLVED",
          gtin: resolvedGtin,
        });
      }
      importedRows += 1;
    }

    for (const batch of chunkArray(uploadCreates, 300)) {
      if (batch.length === 0) continue;
      await prismaAny.partnerUploadRow.createMany({ data: batch });
    }

    for (const batch of chunkArray(uploadUpdates, 40)) {
      if (batch.length === 0) continue;
      await prisma.$transaction(
        batch.map((u) =>
          prismaAny.partnerUploadRow.update({
            where: { id: u.id },
            data: u.data,
          })
        )
      );
    }
  }

  if (upload) {
    await prismaAny.partnerUpload.update({
      where: { id: upload.id },
      data: {
        status: errors.length ? "COMPLETED_WITH_ERRORS" : "COMPLETED",
        totalRows: Math.max(rows.length - 1, 0),
        importedRows,
        errorRows: errors.length,
        errorsJson: errors.length ? errors : null,
      },
    });
  }

  let removedMissing = 0;
  let removeSkipped = false;
  if (!dryRun && !errors.length && cleanPartnerKey && seenSupplierVariantIds.size > 0) {
    const existing = await prismaAny.supplierVariant.findMany({
      where: { supplierVariantId: { startsWith: `${cleanPartnerKey}:` } },
      select: { supplierVariantId: true },
    });
    const missing = existing
      .map((row: { supplierVariantId: string }) => row.supplierVariantId)
      .filter((id: string) => !seenSupplierVariantIds.has(id));
    for (const batch of chunkArray(missing, 500)) {
      const res = await prismaAny.supplierVariant.deleteMany({
        where: { supplierVariantId: { in: batch } },
      });
      removedMissing += res.count ?? 0;
    }
  } else {
    removeSkipped = true;
  }

  if (!dryRun && importedRows > 0 && ctx.origin) {
    await requestFeedPush({
      origin: ctx.origin,
      scope: "full",
      triggerSource: "partner-admin",
      runNow: true,
    });
  }

  // Do not enqueue kickdb-enrich-missing here: it scans the whole partner prefix.

  rowOutcomes.sort((a, b) => a.row - b.row);

  // Queue one-shot enrich jobs from DB total (includes backlog from earlier uploads), not only
  // rows marked PENDING_ENRICH in this file — otherwise old pending lines never get a job until
  // someone clicks Force re-enrich.
  if (!dryRun && importedRows > 0 && partnerKey) {
    const pendingEnrichTotal = await prismaAny.partnerUploadRow.count({
      where: { providerKey: partnerKey, status: "PENDING_ENRICH" },
    });
    if (pendingEnrichTotal > 0) {
      const batchLimit = 2000;
      const jobCount = Math.ceil(pendingEnrichTotal / batchLimit);
      const jobOrigin = resolveAppOriginForPartnerJobs(ctx.origin ?? null);
      for (let j = 0; j < jobCount; j++) {
        const job = await enqueueJob(
          "partner-upload-enrich",
          { partnerKey, limit: batchLimit, force: false, origin: jobOrigin },
          { priority: 0, groupKey: partnerKey }
        );
        if (j === 0) enrichJobId = job.id;
      }
    }
  }

  return {
    uploadId: upload?.id ?? null,
    enrichJobId,
    importedRows,
    newRows,
    errorRows: errors.length,
    errors,
    rows: rowOutcomes,
    dryRun,
    removedMissing,
    removeSkipped,
  };
}
