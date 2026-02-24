import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { parseCsv } from "@/app/lib/csv";
import { normalizeSize, normalizeSku, parsePriceSafe, validateGtin } from "@/app/lib/normalize";
import { buildDuplicateKey, computeLastRowByKey } from "@/app/lib/partnerImport";
import { runKickdbEnrich } from "@/galaxus/kickdb/enrichJob";
import { assertMappingIntegrity, buildProviderKey, normalizeProviderKey } from "@/galaxus/supplier/providerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REQUIRED_HEADERS = ["providerKey", "sku", "size", "rawStock", "price"];

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
    const rowResults: Array<{
      row: number;
      status: "RESOLVED" | "PENDING_GTIN" | "AMBIGUOUS_GTIN" | "ERROR" | "DUPLICATE_IGNORED" | "DRY_RUN";
      gtin?: string | null;
      gtinCandidates?: string[];
      error?: string;
      warning?: string;
    }> = [];
    let importedRows = 0;
    const partner = await prismaAny.partner.findUnique({
      where: { id: session.partnerId },
    });
    if (!partner) {
      throw new Error("Partner not found.");
    }

    const buildSupplierVariantId = (providerKey: string, sku: string, sizeValue: string) => {
      const cleanKey = providerKey.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
      const cleanSku = sku.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
      const cleanSize = sizeValue.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
      return `${cleanKey}:${cleanSku}-${cleanSize}`;
    };

    const lastRowByKey = computeLastRowByKey(rows, headerMap);

    for (let i = 1; i < rows.length; i += 1) {
      const row = rows[i];
      const read = (header: string) => row[headerMap.get(header) ?? -1]?.trim() ?? "";

      const providerKeyRaw = read("providerKey");
      const skuRaw = read("sku");
      const sizeRaw = read("size");
      const stockRaw = read("rawStock");
      const priceRaw = read("price");
      const rowErrors: Array<{ field: string; message: string }> = [];

      const dupeKey = buildDuplicateKey(providerKeyRaw, skuRaw, sizeRaw);
      if (dupeKey) {
        if (lastRowByKey.get(dupeKey) !== i) {
          rowResults.push({
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
      const partnerKey = normalizeProviderKey(partner.key);
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

      if (rowErrors.length > 0) {
        rowErrors.forEach((err) => errors.push({ row: i + 1, ...err }));
        rowResults.push({
          row: i + 1,
          status: "ERROR",
          error: rowErrors.map((item) => `${item.field}: ${item.message}`).join("; "),
        });
        continue;
      }

      if (dryRun) {
        rowResults.push({ row: i + 1, status: "DRY_RUN" });
        importedRows += 1;
        continue;
      }

      const providerKeyValue = providerKey!;
      const normalizedSku = sku!;
      const normalizedSize = sizeNormalized!;
      const supplierVariantId = buildSupplierVariantId(providerKeyValue, normalizedSku, normalizedSize);
      const now = new Date();

      // DELTA import: rows absent from this CSV remain unchanged.
      const existingVariant = await prismaAny.supplierVariant.findUnique({
        where: { supplierVariantId },
        select: { gtin: true, providerKey: true },
      });
      const existingGtin = existingVariant?.gtin ?? null;
      const existingProviderKey = existingVariant?.providerKey ?? null;
      assertMappingIntegrity({
        supplierVariantId,
        gtin: existingGtin,
        providerKey: existingProviderKey,
        status: existingGtin ? "MATCHED" : "PENDING_GTIN",
      });
      await prismaAny.supplierVariant.upsert({
        where: { supplierVariantId },
        create: {
          supplierVariantId,
          supplierSku: normalizedSku,
          providerKey: existingProviderKey,
          gtin: existingGtin,
          sizeRaw,
          sizeNormalized: normalizedSize,
          stock,
          price,
          lastSyncAt: now,
        },
        update: {
          supplierSku: normalizedSku,
          providerKey: existingProviderKey,
          gtin: existingGtin,
          sizeRaw,
          sizeNormalized: normalizedSize,
          stock,
          price,
          lastSyncAt: now,
        },
      });

      let resolvedGtin: string | null = null;
      let gtinCandidates: string[] = [];
      let isAmbiguous = false;
      try {
        const enrich = await runKickdbEnrich({ supplierVariantId, force: true });
        const match = enrich?.results?.find((result) => result.supplierVariantId === supplierVariantId);
        const mapping = await prismaAny.variantMapping.findUnique({
          where: { supplierVariantId },
          select: { gtin: true },
        });
        gtinCandidates = match?.gtinCandidates ?? [];
        isAmbiguous = match?.status === "AMBIGUOUS_GTIN" || gtinCandidates.length > 1;
        resolvedGtin = match?.gtin ?? mapping?.gtin ?? null;
      } catch (err: any) {
        const message = err?.message ?? "Enrichment failed";
        errors.push({ row: i + 1, field: "gtin", message });
        rowResults.push({ row: i + 1, status: "ERROR", error: message });
        continue;
      }

      if (isAmbiguous) {
        const existingPending = await prismaAny.partnerUploadRow?.findFirst({
          where: {
            providerKey: providerKeyValue,
            sku: normalizedSku,
            sizeNormalized: normalizedSize,
            status: { in: ["PENDING_GTIN", "AMBIGUOUS_GTIN"] },
          },
          orderBy: { updatedAt: "desc" },
        });
        if (existingPending) {
          await prismaAny.partnerUploadRow?.update({
            where: { id: existingPending.id },
            data: {
              uploadId: upload?.id ?? null,
              partnerId: session.partnerId,
              providerKey: providerKeyValue,
              sku: normalizedSku,
              sizeRaw,
              sizeNormalized: normalizedSize,
              rawStock: stock,
              price,
              status: "AMBIGUOUS_GTIN",
              gtinResolved: null,
              gtinCandidatesJson: gtinCandidates,
              updatedAt: now,
            },
          });
        } else {
          await prismaAny.partnerUploadRow?.create({
            data: {
              uploadId: upload?.id ?? null,
              partnerId: session.partnerId,
              providerKey: providerKeyValue,
              sku: normalizedSku,
              sizeRaw,
              sizeNormalized: normalizedSize,
              rawStock: stock,
              price,
              status: "AMBIGUOUS_GTIN",
              gtinResolved: null,
              gtinCandidatesJson: gtinCandidates,
            },
          });
        }
        rowResults.push({
          row: i + 1,
          status: "AMBIGUOUS_GTIN",
          gtinCandidates,
        });
        importedRows += 1;
        continue;
      }

      if (!resolvedGtin || !validateGtin(resolvedGtin)) {
        const existingPending = await prismaAny.partnerUploadRow?.findFirst({
          where: {
            providerKey: providerKeyValue,
            sku: normalizedSku,
            sizeNormalized: normalizedSize,
            status: { in: ["PENDING_GTIN", "AMBIGUOUS_GTIN"] },
          },
          orderBy: { updatedAt: "desc" },
        });
        const errorsJson = !resolvedGtin
          ? [{ message: "GTIN not resolved" }]
          : [{ message: "Invalid GTIN" }];
        if (existingPending) {
          await prismaAny.partnerUploadRow?.update({
            where: { id: existingPending.id },
            data: {
              uploadId: upload?.id ?? null,
              partnerId: session.partnerId,
              providerKey: providerKeyValue,
              sku: normalizedSku,
              sizeRaw,
              sizeNormalized: normalizedSize,
              rawStock: stock,
              price,
              status: "PENDING_GTIN",
              gtinResolved: null,
              errorsJson,
              updatedAt: now,
            },
          });
        } else {
          await prismaAny.partnerUploadRow?.create({
            data: {
              uploadId: upload?.id ?? null,
              partnerId: session.partnerId,
              providerKey: providerKeyValue,
              sku: normalizedSku,
              sizeRaw,
              sizeNormalized: normalizedSize,
              rawStock: stock,
              price,
              status: "PENDING_GTIN",
              gtinResolved: null,
              errorsJson,
            },
          });
        }
        rowResults.push({ row: i + 1, status: "PENDING_GTIN" });
        importedRows += 1;
        continue;
      }

      const fullProviderKey = buildProviderKey(resolvedGtin, supplierVariantId);
      if (!fullProviderKey) {
        errors.push({ row: i + 1, field: "gtin", message: "Invalid GTIN" });
        rowResults.push({ row: i + 1, status: "ERROR", error: "Invalid GTIN" });
        continue;
      }
      assertMappingIntegrity({
        supplierVariantId,
        gtin: resolvedGtin,
        providerKey: fullProviderKey,
        status: "MATCHED",
      });
      const offer = await prismaAny.supplierVariant.upsert({
        where: { providerKey_gtin: { providerKey: fullProviderKey, gtin: resolvedGtin } },
        create: {
          supplierVariantId,
          supplierSku: normalizedSku,
          providerKey: fullProviderKey,
          gtin: resolvedGtin,
          sizeRaw,
          sizeNormalized: normalizedSize,
          stock,
          price,
          lastSyncAt: now,
        },
        update: {
          supplierSku: normalizedSku,
          providerKey: fullProviderKey,
          gtin: resolvedGtin,
          sizeRaw,
          sizeNormalized,
          stock,
          price,
          lastSyncAt: now,
        },
      });

      if (offer.supplierVariantId !== supplierVariantId) {
        const existingMapping = await prismaAny.variantMapping.findUnique({
          where: { supplierVariantId: offer.supplierVariantId },
          select: { supplierVariantId: true },
        });
        if (existingMapping) {
          await prismaAny.variantMapping.deleteMany({
            where: { supplierVariantId },
          });
        } else {
          await prismaAny.variantMapping.updateMany({
            where: { supplierVariantId },
            data: { supplierVariantId: offer.supplierVariantId },
          });
        }
        await prismaAny.supplierVariant.deleteMany({
          where: { supplierVariantId },
        });
      }

      rowResults.push({ row: i + 1, status: "RESOLVED", gtin: resolvedGtin });
      importedRows += 1;
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

    return NextResponse.json({
      ok: true,
      result: {
        uploadId: upload?.id ?? null,
        importedRows,
        errorRows: errors.length,
        errors,
        rows: rowResults,
        dryRun,
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
