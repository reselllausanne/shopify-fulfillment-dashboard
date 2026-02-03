import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
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

function buildCreateData(item: SupplierCatalogItem): Prisma.SupplierVariantCreateInput {
  return {
    supplierVariantId: item.supplierVariantId,
    supplierSku: item.supplierSku,
    price: item.price ?? 0,
    stock: item.stock ?? 0,
    sizeRaw: item.sizeRaw,
    images: item.images.length ? item.images : undefined,
    leadTimeDays: item.leadTimeDays,
    lastSyncAt: new Date(),
  };
}

function buildUpdateData(item: SupplierCatalogItem): Prisma.SupplierVariantUpdateInput {
  const updateData: Prisma.SupplierVariantUpdateInput = {
    supplierSku: item.supplierSku,
    sizeRaw: item.sizeRaw,
    leadTimeDays: item.leadTimeDays,
    lastSyncAt: new Date(),
  };
  if (item.price !== null) updateData.price = item.price;
  if (item.stock !== null) updateData.stock = item.stock;
  if (item.images.length) updateData.images = item.images;
  return updateData;
}

export async function runCatalogSync(options: CatalogSyncOptions = {}): Promise<CatalogSyncResult> {
  const client = createGoldenSupplierClient();
  const items = await client.fetchCatalog();
  const offset = Math.max(options.offset ?? 0, 0);
  const limit = options.limit ? Math.max(options.limit, 0) : items.length;
  const slicedItems = items.slice(offset, offset + limit);

  let created = 0;
  let updated = 0;

  for (const item of slicedItems) {
    const exists = await prisma.supplierVariant.findUnique({
      where: { supplierVariantId: item.supplierVariantId },
      select: { supplierVariantId: true },
    });

    await prisma.supplierVariant.upsert({
      where: { supplierVariantId: item.supplierVariantId },
      create: buildCreateData(item),
      update: buildUpdateData(item),
    });

    if (exists) {
      updated += 1;
    } else {
      created += 1;
    }
  }

  return { processed: slicedItems.length, created, updated };
}
