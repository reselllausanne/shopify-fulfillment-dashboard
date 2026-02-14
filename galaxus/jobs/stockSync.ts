import { prisma } from "@/app/lib/prisma";
import { buildProviderKey } from "@/galaxus/supplier/providerKey";
import { createGoldenSupplierClient } from "../supplier/client";

type StockSyncResult = {
  processed: number;
  updated: number;
  created: number;
};

type StockSyncOptions = {
  limit?: number;
  offset?: number;
};

export async function runStockSync(options: StockSyncOptions = {}): Promise<StockSyncResult> {
  const client = createGoldenSupplierClient();
  const items = await client.fetchStockAndPrice();
  const offset = Math.max(options.offset ?? 0, 0);
  const limit = options.limit ? Math.max(options.limit, 0) : items.length;
  const slicedItems = items.slice(offset, offset + limit);

  let updated = 0;
  let created = 0;

  for (const item of slicedItems) {
    const updateData: Record<string, unknown> = {
      lastSyncAt: new Date(),
    };
    if (item.sourcePayload.brand_name) updateData.supplierBrand = item.sourcePayload.brand_name;
    if (item.sourcePayload.product_name) updateData.supplierProductName = item.sourcePayload.product_name;
    if (item.price !== null) updateData.price = item.price;
    if (item.stock !== null) updateData.stock = item.stock;

    const existing = await prisma.supplierVariant.findUnique({
      where: { supplierVariantId: item.supplierVariantId },
      select: { supplierVariantId: true },
    });

    if (existing) {
      await prisma.supplierVariant.update({
        where: { supplierVariantId: item.supplierVariantId },
        data: updateData,
      });
      updated += 1;
    } else {
      await prisma.supplierVariant.create({
        data: {
          supplierVariantId: item.supplierVariantId,
          supplierSku: item.supplierSku,
          price: item.price ?? 0,
          stock: item.stock ?? 0,
          sizeRaw: item.sizeRaw,
          supplierBrand: item.sourcePayload.brand_name ?? null,
          supplierProductName: item.sourcePayload.product_name ?? null,
          images: item.images.length ? item.images : undefined,
          leadTimeDays: item.leadTimeDays,
          lastSyncAt: new Date(),
        },
      });
      created += 1;
    }

    // Persist supplier GTIN when provided.
    const supplierGtin = item.sourcePayload?.barcode ?? null;
    if (supplierGtin) {
      const providerKey = buildProviderKey(supplierGtin, item.supplierVariantId);
      await prisma.variantMapping.upsert({
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

  return { processed: slicedItems.length, updated, created };
}
