import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requestFeedPush } from "@/galaxus/ops/feedPipeline";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { parseCsv } from "@/app/lib/csv";
import { normalizeSize, normalizeSku, parsePriceSafe, validateGtin } from "@/app/lib/normalize";
import { buildDuplicateKey, buildSupplierVariantId, computeLastRowByKey } from "@/app/lib/partnerImport";
import { assertMappingIntegrity, buildProviderKey, normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import {
  bulkUpsertSupplierVariantsPartnerImport,
  bulkUpsertVariantMappings,
  bulkUpdateSupplierVariants,
  chunkArray,
} from "@/galaxus/jobs/bulkSql";
import { enqueueJob } from "@/galaxus/jobs/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Large CSV + batched DB; allow long runs on Vercel / serverless where supported */
export const maxDuration = 900;

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
};

export async function POST(req: NextRequest) {
  const session = await getPartnerSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const dryRun = ["1", "true", "yes"].includes((searchParams.get("dryRun") ?? "").toLowerCase());

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "CSV file required" }, { status: 400 });
  }

  const prismaAny = prisma as any;
  const upload = dryRun
    ? null
    : await prismaAny.partnerUpload.create({
        data: {
          partnerId: session.partnerId,
          filename: file.name ?? "upload.csv",
          status: "PROCESSING",
        },
      });

  try {
    const text = await file.text();
    const rows = parseCsv(text);
    if (!rows.length) {
      throw new Error("CSV is empty");
    }

    const headers = rows[0].map((value) => value.trim());
    const headerMap = new Map(headers.map((value, index) => [value, index]));
    const missingHeaders = REQUIRED_HEADERS.filter((header) => !headerMap.has(header));
    if (missingHeaders.length) {
      throw new Error(`Missing headers: ${missingHeaders.join(", ")}`);
    }

    const errors: Array<{ row: number; field: string; message: string }> = [];
    type RowOutcome = {
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
    const rowOutcomes: RowOutcome[] = [];
    let importedRows = 0;
    let newRows = 0;
    let enrichJobId: string | null = null;
    const partner = await prismaAny.partner.findUnique({
      where: { id: session.partnerId },
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
      const read = (header: string) => row[headerMap.get(header) ?? -1]?.trim() ?? "";

      const providerKeyRaw = read("providerKey");
      const skuRaw = read("sku");
      const sizeRaw = read("size");
      const stockRaw = read("rawStock");
      const priceRaw = read("price");
      const gtinRaw = read("gtin");
      const productNameRaw = read("productName");
      const brandRaw = read("brand");
      const imageRaw = read("image");
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
          partnerId: session.partnerId,
          status: { in: [...PARTNER_PENDING_STATUSES] },
        },
        orderBy: { updatedAt: "desc" },
      });
      const pendingByTriple = new Map<string, { id: string }>();
      for (const pr of pendingRows) {
        const k = `${pr.providerKey}|${pr.sku}|${pr.sizeNormalized}`;
        if (!pendingByTriple.has(k)) pendingByTriple.set(k, { id: pr.id });
      }

      const variantBulk: Array<{
        supplierVariantId: string;
        supplierSku: string;
        providerKey: string | null;
        gtin: string | null;
        price: number;
        stock: number;
        sizeRaw: string | null;
        sizeNormalized: string | null;
      }> = [];
      const supplierUpdates: Array<{
        supplierVariantId: string;
        supplierSku?: string;
        providerKey?: string | null;
        gtin?: string | null;
        supplierBrand?: string | null;
        supplierProductName?: string | null;
        images?: unknown;
      }> = [];
      const mappingUpserts: Array<{
        supplierVariantId: string;
        gtin: string | null;
        providerKey: string | null;
        status: string;
        kickdbVariantId?: string | null;
      }> = [];

      for (const v of validImports) {
        const existing = existingById.get(v.supplierVariantId);
        const existingGtin = existing?.gtin ?? null;
        const existingProviderKey = existing?.providerKey ?? null;
        const providedGtin = v.gtinProvided ?? null;
        const effectiveGtin = providedGtin ?? existingGtin;
        const providerKeyFromGtin = effectiveGtin
          ? buildProviderKey(effectiveGtin, v.supplierVariantId)
          : existingProviderKey;
        assertMappingIntegrity({
          supplierVariantId: v.supplierVariantId,
          gtin: effectiveGtin,
          providerKey: providerKeyFromGtin,
          status: effectiveGtin ? "MATCHED" : "PENDING_GTIN",
        });
        variantBulk.push({
          supplierVariantId: v.supplierVariantId,
          supplierSku: v.normalizedSku,
          providerKey: providerKeyFromGtin ?? existingProviderKey,
          gtin: effectiveGtin,
          price: v.price,
          stock: v.stock,
          sizeRaw: v.sizeRaw,
          sizeNormalized: v.normalizedSize,
        });
        if (providedGtin) {
          mappingUpserts.push({
            supplierVariantId: v.supplierVariantId,
            gtin: providedGtin,
            providerKey: providerKeyFromGtin ?? null,
            status: "SUPPLIER_GTIN",
            kickdbVariantId: null,
          });
        }
        if (v.productName || v.brand || v.imageUrl || providedGtin) {
          supplierUpdates.push({
            supplierVariantId: v.supplierVariantId,
            supplierSku: v.normalizedSku,
            providerKey: providerKeyFromGtin ?? undefined,
            gtin: providedGtin ?? undefined,
            supplierBrand: v.brand ?? undefined,
            supplierProductName: v.productName ?? undefined,
            images: v.imageUrl ? [v.imageUrl] : undefined,
          });
        }
      }

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

      for (const v of validImports) {
        const existing = existingById.get(v.supplierVariantId);
        const existingGtin = existing?.gtin ?? null;
        const resolvedGtin =
          v.gtinProvided ??
          (existingGtin && validateGtin(existingGtin) ? existingGtin : null);
        const shouldEnrich = !resolvedGtin;
        const tripleKey = `${v.providerKeyValue}|${v.normalizedSku}|${v.normalizedSize}`;
        const existingPending = pendingByTriple.get(tripleKey);

        if (shouldEnrich) {
          newRows += 1;
          if (existingPending) {
            uploadUpdates.push({
              id: existingPending.id,
              data: {
                uploadId: upload?.id ?? null,
                partnerId: session.partnerId,
                supplierVariantId: v.supplierVariantId,
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
              partnerId: session.partnerId,
              supplierVariantId: v.supplierVariantId,
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
                supplierVariantId: v.supplierVariantId,
                status: "RESOLVED",
                gtinResolved: resolvedGtin,
                updatedAt: now,
              },
            });
          }
          rowOutcomes.push({ row: v.rowNum, status: "RESOLVED", gtin: resolvedGtin });
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

    if (!dryRun && importedRows > 0) {
      const origin = new URL(req.url).origin;
      await requestFeedPush({ origin, scope: "full", triggerSource: "partner-admin", runNow: true });
    }

    if (!dryRun && newRows > 0 && cleanPartnerKey) {
      const limit = Math.min(Math.max(newRows, 200), 2000);
      const job = await enqueueJob(
        "kickdb-enrich-missing",
        {
          limit,
          concurrency: 8,
          supplierVariantIdPrefix: `${cleanPartnerKey}:`,
          partnerId: session.partnerId,
          includeNotFound: true,
          respectRecentRun: false,
          autoDrain: true,
        },
        { priority: 5, groupKey: `partner:${session.partnerId}` }
      );
      enrichJobId = job.id;
    }

    rowOutcomes.sort((a, b) => a.row - b.row);

    return NextResponse.json({
      ok: true,
      result: {
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
      },
    });
  } catch (error: any) {
    if (upload) {
      await prismaAny.partnerUpload.update({
        where: { id: upload.id },
        data: {
          status: "FAILED",
          errorsJson: [{ message: error.message ?? "Upload failed" }],
        },
      });
    }
    return NextResponse.json({ error: error.message ?? "Upload failed" }, { status: 500 });
  }
}
