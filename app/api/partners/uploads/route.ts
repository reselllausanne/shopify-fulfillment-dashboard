import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { parseCsv } from "@/app/lib/csv";
import { runKickdbEnrich } from "@/galaxus/kickdb/enrichJob";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REQUIRED_HEADERS = ["providerKey", "sku", "size", "rawStock", "price"];

function normalizeSize(value: string): string {
  return value.trim().toUpperCase().replace(",", ".").replace(/\s+/g, "");
}

export async function POST(req: NextRequest) {
  const session = await getPartnerSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "CSV file required" }, { status: 400 });
  }

  const upload = await (prisma as any).partnerUpload.create({
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
      status: "RESOLVED" | "PENDING_GTIN" | "ERROR";
      gtin?: string | null;
      error?: string;
    }> = [];
    let importedRows = 0;
    const partner = await (prisma as any).partner.findUnique({
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

    for (let i = 1; i < rows.length; i += 1) {
      const row = rows[i];
      const read = (header: string) => row[headerMap.get(header) ?? -1]?.trim() ?? "";

      const providerKeyRaw = read("providerKey");
      const sku = read("sku");
      const sizeRaw = read("size");
      const stockRaw = read("rawStock");
      const priceRaw = read("price");
      const rowErrors: Array<{ field: string; message: string }> = [];

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

      if (!sku) rowErrors.push({ field: "sku", message: "Required" });
      if (!sizeRaw) rowErrors.push({ field: "size", message: "Required" });

      const stock = Number.parseInt(stockRaw, 10);
      if (!Number.isFinite(stock) || stock < 0) {
        rowErrors.push({ field: "rawStock", message: "Invalid number" });
      }
      const price = Number.parseFloat(priceRaw);
      if (!Number.isFinite(price) || price < 0) {
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

      const providerKeyValue = providerKey!;
      const sizeNormalized = normalizeSize(sizeRaw);
      const supplierVariantId = buildSupplierVariantId(providerKeyValue, sku, sizeNormalized);
      const now = new Date();

      await (prisma as any).supplierVariant.upsert({
        where: { supplierVariantId },
        create: {
          supplierVariantId,
          supplierSku: sku,
          providerKey: providerKeyValue,
          sizeRaw,
          sizeNormalized,
          stock,
          price,
          lastSyncAt: now,
        },
        update: {
          supplierSku: sku,
          providerKey: providerKeyValue,
          sizeRaw,
          sizeNormalized,
          stock,
          price,
          lastSyncAt: now,
        },
      });

      let resolvedGtin: string | null = null;
      try {
        const enrich = await runKickdbEnrich({ supplierVariantId, force: true });
        const match = enrich?.results?.find((result) => result.supplierVariantId === supplierVariantId);
        const mapping = await (prisma as any).variantMapping.findUnique({
          where: { supplierVariantId },
          select: { gtin: true },
        });
        resolvedGtin = match?.gtin ?? mapping?.gtin ?? null;
      } catch (err: any) {
        const message = err?.message ?? "Enrichment failed";
        errors.push({ row: i + 1, field: "gtin", message });
        rowResults.push({ row: i + 1, status: "ERROR", error: message });
        continue;
      }

      if (!resolvedGtin) {
        rowResults.push({ row: i + 1, status: "PENDING_GTIN" });
        importedRows += 1;
        continue;
      }

      const offer = await (prisma as any).supplierVariant.upsert({
        where: { providerKey_gtin: { providerKey: providerKeyValue, gtin: resolvedGtin } },
        create: {
          supplierVariantId,
          supplierSku: sku,
          providerKey: providerKeyValue,
          gtin: resolvedGtin,
          sizeRaw,
          sizeNormalized,
          stock,
          price,
          lastSyncAt: now,
        },
        update: {
          supplierSku: sku,
          providerKey: providerKeyValue,
          gtin: resolvedGtin,
          sizeRaw,
          sizeNormalized,
          stock,
          price,
          lastSyncAt: now,
        },
      });

      if (offer.supplierVariantId !== supplierVariantId) {
        const existingMapping = await (prisma as any).variantMapping.findUnique({
          where: { supplierVariantId: offer.supplierVariantId },
          select: { supplierVariantId: true },
        });
        if (existingMapping) {
          await (prisma as any).variantMapping.deleteMany({
            where: { supplierVariantId },
          });
        } else {
          await (prisma as any).variantMapping.updateMany({
            where: { supplierVariantId },
            data: { supplierVariantId: offer.supplierVariantId },
          });
        }
        await (prisma as any).supplierVariant.deleteMany({
          where: { supplierVariantId },
        });
      }

      rowResults.push({ row: i + 1, status: "RESOLVED", gtin: resolvedGtin });
      importedRows += 1;
    }

    await (prisma as any).partnerUpload.update({
      where: { id: upload.id },
      data: {
        status: errors.length ? "COMPLETED_WITH_ERRORS" : "COMPLETED",
        totalRows: Math.max(rows.length - 1, 0),
        importedRows,
        errorRows: errors.length,
        errorsJson: errors.length ? errors : null,
      },
    });

    return NextResponse.json({
      ok: true,
      result: {
        uploadId: upload.id,
        importedRows,
        errorRows: errors.length,
        errors,
        rows: rowResults,
      },
    });
  } catch (error: any) {
    await (prisma as any).partnerUpload.update({
      where: { id: upload.id },
      data: {
        status: "FAILED",
        errorsJson: [{ message: error.message ?? "Upload failed" }],
      },
    });
    return NextResponse.json({ error: error.message ?? "Upload failed" }, { status: 500 });
  }
}
