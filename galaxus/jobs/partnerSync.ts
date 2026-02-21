import { prisma } from "@/app/lib/prisma";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import { normalizeSize, normalizeSku, validateGtin } from "@/app/lib/normalize";

type PartnerSyncOptions = {
  limit?: number;
  offset?: number;
};

type PartnerSyncResult = {
  processed: number;
  created: number;
  updated: number;
  skippedInvalid: number;
};

function buildSupplierVariantId(providerKey: string, sku: string, sizeNormalized: string) {
  const cleanKey = providerKey.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const cleanSku = sku.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  const cleanSize = sizeNormalized.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  return `${cleanKey}:${cleanSku}-${cleanSize}`;
}

export async function runPartnerSync(options: PartnerSyncOptions = {}): Promise<PartnerSyncResult> {
  const prismaAny = prisma as any;
  const limit = Math.min(Math.max(options.limit ?? 500, 1), 2000);
  const offset = Math.max(options.offset ?? 0, 0);

  const rows = await prismaAny.partnerUploadRow.findMany({
    where: {
      status: "RESOLVED",
      gtinResolved: { not: null },
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
    skip: offset,
  });

  let processed = 0;
  let created = 0;
  let updated = 0;
  let skippedInvalid = 0;

  for (const row of rows) {
    const providerKey = normalizeProviderKey(row.providerKey);
    const gtin = validateGtin(row.gtinResolved) ? row.gtinResolved : null;
    if (!providerKey || !gtin) {
      skippedInvalid += 1;
      continue;
    }
    const sku = normalizeSku(row.sku) ?? row.sku;
    const sizeNormalized = normalizeSize(row.sizeNormalized ?? row.sizeRaw) ?? row.sizeRaw;
    if (!sku || !sizeNormalized) {
      skippedInvalid += 1;
      continue;
    }
    const supplierVariantId = buildSupplierVariantId(providerKey, sku, sizeNormalized);
    const now = new Date();

    const existing = await prismaAny.supplierVariant.findFirst({
      where: { providerKey, gtin },
      select: { supplierVariantId: true },
    });

    const offer = await prismaAny.supplierVariant.upsert({
      where: { providerKey_gtin: { providerKey, gtin } },
      create: {
        supplierVariantId,
        supplierSku: sku,
        providerKey,
        gtin,
        sizeRaw: row.sizeRaw,
        sizeNormalized,
        stock: row.rawStock,
        price: row.price,
        lastSyncAt: now,
      },
      update: {
        supplierSku: sku,
        providerKey,
        gtin,
        sizeRaw: row.sizeRaw,
        sizeNormalized,
        stock: row.rawStock,
        price: row.price,
        lastSyncAt: now,
      },
    });

    if (existing) updated += 1;
    else created += 1;
    processed += 1;

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

    await prismaAny.variantMapping.upsert({
      where: { supplierVariantId: offer.supplierVariantId },
      create: {
        supplierVariantId: offer.supplierVariantId,
        gtin,
        providerKey: `${providerKey}_${gtin}`,
        status: "PARTNER_GTIN",
      },
      update: {
        gtin,
        providerKey: `${providerKey}_${gtin}`,
        status: "PARTNER_GTIN",
      },
    });
  }

  return { processed, created, updated, skippedInvalid };
}
