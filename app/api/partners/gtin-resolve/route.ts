import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { parseCsv } from "@/app/lib/csv";
import { assertMappingIntegrity, buildProviderKey, normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import { normalizeSize, normalizeSku, parsePriceSafe, validateGtin } from "@/app/lib/normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REQUIRED_HEADERS = ["providerKey", "sku", "size", "rawStock", "price", "gtin"];

function buildSupplierVariantId(providerKey: string, sku: string, sizeNormalized: string) {
  const cleanKey = providerKey.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const cleanSku = sku.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  const cleanSize = sizeNormalized.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  return `${cleanKey}:${cleanSku}-${cleanSize}`;
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

  const prismaAny = prisma as any;
  const partner = await prismaAny.partner.findUnique({ where: { id: session.partnerId } });
  const partnerKey = normalizeProviderKey(partner?.key ?? null);
  if (!partnerKey) {
    return NextResponse.json({ ok: false, error: "Partner key missing" }, { status: 400 });
  }

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
    let resolvedRows = 0;

    for (let i = 1; i < rows.length; i += 1) {
      const row = rows[i];
      const read = (header: string) => row[headerMap.get(header) ?? -1]?.trim() ?? "";

      const providerKeyRaw = read("providerKey");
      const skuRaw = read("sku");
      const sizeRaw = read("size");
      const stockRaw = read("rawStock");
      const priceRaw = read("price");
      const gtin = read("gtin");

      const supplierCode = normalizeProviderKey(providerKeyRaw);
      if (!supplierCode || supplierCode !== partnerKey) {
        errors.push({ row: i + 1, field: "providerKey", message: "Invalid providerKey" });
        continue;
      }
      const sku = normalizeSku(skuRaw);
      const sizeNormalized = normalizeSize(sizeRaw ?? null);
      if (!sku) {
        errors.push({ row: i + 1, field: "sku", message: "Required" });
        continue;
      }
      if (!sizeNormalized) {
        errors.push({ row: i + 1, field: "size", message: "Required" });
        continue;
      }
      if (!validateGtin(gtin)) {
        errors.push({ row: i + 1, field: "gtin", message: "Invalid GTIN" });
        continue;
      }

      const stockValue = stockRaw.replace(/\u00A0/g, " ").trim();
      if (!/^\d+$/.test(stockValue)) {
        errors.push({ row: i + 1, field: "rawStock", message: "Invalid number" });
        continue;
      }
      const stock = Number.parseInt(stockValue, 10);
      const price = parsePriceSafe(priceRaw);
      if (price === null) {
        errors.push({ row: i + 1, field: "price", message: "Invalid number" });
        continue;
      }

      const pendingRow = await prismaAny.partnerUploadRow.findFirst({
        where: {
          providerKey: supplierCode,
          sku,
          sizeNormalized,
          status: { in: ["PENDING_GTIN", "AMBIGUOUS_GTIN"] },
        },
        orderBy: { updatedAt: "desc" },
      });
      if (!pendingRow) {
        errors.push({ row: i + 1, field: "row", message: "Pending row not found" });
        continue;
      }

      const supplierVariantId = buildSupplierVariantId(supplierCode, sku, sizeNormalized);
      const fullProviderKey = buildProviderKey(gtin, supplierVariantId);
      if (!fullProviderKey) {
        errors.push({ row: i + 1, field: "gtin", message: "Invalid GTIN" });
        continue;
      }
      const now = new Date();

      assertMappingIntegrity({
        supplierVariantId,
        gtin,
        providerKey: fullProviderKey,
        status: "MATCHED",
      });
      const offer = await prismaAny.supplierVariant.upsert({
        where: { providerKey_gtin: { providerKey: fullProviderKey, gtin } },
        create: {
          supplierVariantId,
          supplierSku: sku,
          providerKey: fullProviderKey,
          gtin,
          sizeRaw,
          sizeNormalized,
          stock,
          price,
          lastSyncAt: now,
        },
        update: {
          supplierSku: sku,
          providerKey: fullProviderKey,
          gtin,
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
          await prismaAny.variantMapping.deleteMany({ where: { supplierVariantId } });
        } else {
          await prismaAny.variantMapping.updateMany({
            where: { supplierVariantId },
            data: { supplierVariantId: offer.supplierVariantId },
          });
        }
        await prismaAny.supplierVariant.deleteMany({ where: { supplierVariantId } });
      }

      assertMappingIntegrity({
        supplierVariantId: offer.supplierVariantId,
        gtin,
        providerKey: fullProviderKey,
        status: "MATCHED",
      });
      await prismaAny.variantMapping.upsert({
        where: { supplierVariantId: offer.supplierVariantId },
        create: {
          supplierVariantId: offer.supplierVariantId,
          gtin,
          providerKey: fullProviderKey,
          status: "MATCHED",
        },
        update: {
          gtin,
          providerKey: fullProviderKey,
          status: "MATCHED",
        },
      });

      await prismaAny.partnerUploadRow.update({
        where: { id: pendingRow.id },
        data: {
          status: "RESOLVED",
          gtinResolved: gtin,
          updatedAt: now,
        },
      });

      resolvedRows += 1;
    }

    return NextResponse.json({
      ok: true,
      resolvedRows,
      errorRows: errors.length,
      errors,
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
