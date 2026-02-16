import { prisma } from "@/app/lib/prisma";
import { buildProviderKey, resolveSupplierCode } from "@/galaxus/supplier/providerKey";
import { createGoldenSupplierClient } from "../supplier/client";
import type { SupplierCatalogItem } from "../supplier/types";

type CatalogSyncResult = {
  processed: number;
  created: number;
  updated: number;
};

type CatalogSyncOptions = {
  limit?: number;
  offset?: number;
};

function buildCreateData(item: SupplierCatalogItem) {
  return {
    supplierVariantId: item.supplierVariantId,
    supplierSku: item.supplierSku,
    providerKey: resolveSupplierCode(item.supplierVariantId),
    price: item.price ?? 0,
    stock: item.stock ?? 0,
    sizeRaw: item.sizeRaw,
    supplierBrand: item.sourcePayload.brand_name ?? null,
    supplierProductName: item.sourcePayload.product_name ?? null,
    images: item.images.length ? item.images : undefined,
    leadTimeDays: item.leadTimeDays,
    lastSyncAt: new Date(),
  };
}

function buildUpdateData(item: SupplierCatalogItem) {
  const updateData: Record<string, unknown> = {
    supplierSku: item.supplierSku,
    providerKey: resolveSupplierCode(item.supplierVariantId),
    sizeRaw: item.sizeRaw,
    leadTimeDays: item.leadTimeDays,
    lastSyncAt: new Date(),
  };
  if (item.sourcePayload.brand_name) updateData.supplierBrand = item.sourcePayload.brand_name;
  if (item.sourcePayload.product_name) updateData.supplierProductName = item.sourcePayload.product_name;
  if (item.price !== null) updateData.price = item.price;
  if (item.stock !== null) updateData.stock = item.stock;
  if (item.images.length) updateData.images = item.images;
  return updateData;
}

export async function runCatalogSync(options: CatalogSyncOptions = {}): Promise<CatalogSyncResult> {
  const prismaAny = prisma as any;
  const client = createGoldenSupplierClient();
  const items = await client.fetchCatalog();
  const offset = Math.max(options.offset ?? 0, 0);
  const limit = options.limit ? Math.max(options.limit, 0) : items.length;
  const slicedItems = items.slice(offset, offset + limit);

  let created = 0;
  let updated = 0;

  for (const item of slicedItems) {
    const exists = await prismaAny.supplierVariant.findUnique({
      where: { supplierVariantId: item.supplierVariantId },
      select: { supplierVariantId: true },
    });

    await prismaAny.supplierVariant.upsert({
      where: { supplierVariantId: item.supplierVariantId },
      create: buildCreateData(item),
      update: buildUpdateData(item),
    });

    if (exists) {
      updated += 1;
    } else {
      created += 1;
    }

    // Persist supplier GTIN as source of truth when available.
    const supplierGtin = item.sourcePayload?.barcode ?? null;
    if (supplierGtin) {
      const providerKey = buildProviderKey(supplierGtin, item.supplierVariantId);
      await prismaAny.supplierVariant.update({
        where: { supplierVariantId: item.supplierVariantId },
        data: {
          gtin: supplierGtin,
          providerKey: resolveSupplierCode(item.supplierVariantId),
        },
      });
      await prismaAny.variantMapping.upsert({
        where: { supplierVariantId: item.supplierVariantId },
        create: {
          supplierVariantId: item.supplierVariantId,
          gtin: supplierGtin,
          providerKey: providerKey ?? null,
          status: "SUPPLIER_GTIN",
        },
        update: {
          gtin: supplierGtin,
          providerKey: providerKey ?? null,
          status: "SUPPLIER_GTIN",
        },
      });
    }
  }

  return { processed: slicedItems.length, created, updated };
}
