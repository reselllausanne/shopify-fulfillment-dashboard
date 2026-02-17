import { prisma } from "@/app/lib/prisma";
import { validateGtin } from "@/app/lib/normalize";
import { runKickdbEnrich } from "@/galaxus/kickdb/enrichJob";
import { createTrmSupplierClient } from "@/galaxus/supplier/trmClient";
import { buildProviderKey } from "@/galaxus/supplier/providerKey";

type TrmSyncOptions = {
  limit?: number;
  offset?: number;
  enrichMissingGtin?: boolean;
};

type TrmSyncResult = {
  processed: number;
  created: number;
  updated: number;
  supplierGtinRows: number;
  missingGtinRows: number;
  invalidGtinRows: number;
  enrichedRows: number;
  enrichErrors: number;
};

function parsePrice(value: unknown): number {
  const parsed = Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function parseStock(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function normalizeGtin(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const gtin = String(value).trim();
  return gtin.length ? gtin : null;
}

export async function runTrmSync(options: TrmSyncOptions = {}): Promise<TrmSyncResult> {
  const prismaAny = prisma as any;
  const client = createTrmSupplierClient();
  const products = await client.fetchProductsFullList();
  const flattened = products.flatMap((product) =>
    (product.variants ?? [])
      .map((variant) => {
        const variantId = String(variant.variant_id ?? "").trim();
        if (!variantId) return null;
        return {
          supplierVariantId: `trm:${variantId}`,
          supplierSku: product.sku,
          supplierBrand: product.brand ?? null,
          supplierProductName: product.name ?? null,
          sizeRaw: variant.eu_size ?? variant.size ?? null,
          price: parsePrice(variant.price),
          stock: parseStock(variant.stock),
          gtin: normalizeGtin(variant.ean),
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
  );

  const offset = Math.max(options.offset ?? 0, 0);
  const limit = options.limit ? Math.max(options.limit, 0) : flattened.length;
  const rows = flattened.slice(offset, offset + limit);

  let created = 0;
  let updated = 0;
  let supplierGtinRows = 0;
  let missingGtinRows = 0;
  let invalidGtinRows = 0;
  let enrichedRows = 0;
  let enrichErrors = 0;

  const missingOrInvalidVariantIds: string[] = [];

  for (const row of rows) {
    const now = new Date();
    const gtin = row.gtin;
    const hasGtin = Boolean(gtin);
    const validSupplierGtin = hasGtin && validateGtin(gtin) ? gtin : null;
    const existing = await prismaAny.supplierVariant.findUnique({
      where: { supplierVariantId: row.supplierVariantId },
      select: { supplierVariantId: true },
    });

    try {
      await prismaAny.supplierVariant.upsert({
        where: { supplierVariantId: row.supplierVariantId },
        create: {
          supplierVariantId: row.supplierVariantId,
          supplierSku: row.supplierSku,
          providerKey: "TRM",
          gtin: gtin,
          price: row.price,
          stock: row.stock,
          sizeRaw: row.sizeRaw,
          supplierBrand: row.supplierBrand,
          supplierProductName: row.supplierProductName,
          lastSyncAt: now,
        },
        update: {
          supplierSku: row.supplierSku,
          providerKey: "TRM",
          gtin: gtin,
          price: row.price,
          stock: row.stock,
          sizeRaw: row.sizeRaw,
          supplierBrand: row.supplierBrand,
          supplierProductName: row.supplierProductName,
          lastSyncAt: now,
        },
      });
    } catch (error: any) {
      if (error?.code === "P2002" && validSupplierGtin) {
        // Keep the row synced but clear duplicate GTIN; candidate selection handles GTIN-based inclusion.
        await prismaAny.supplierVariant.upsert({
          where: { supplierVariantId: row.supplierVariantId },
          create: {
            supplierVariantId: row.supplierVariantId,
            supplierSku: row.supplierSku,
            providerKey: "TRM",
            gtin: null,
            price: row.price,
            stock: row.stock,
            sizeRaw: row.sizeRaw,
            supplierBrand: row.supplierBrand,
            supplierProductName: row.supplierProductName,
            lastSyncAt: now,
          },
          update: {
            supplierSku: row.supplierSku,
            providerKey: "TRM",
            gtin: null,
            price: row.price,
            stock: row.stock,
            sizeRaw: row.sizeRaw,
            supplierBrand: row.supplierBrand,
            supplierProductName: row.supplierProductName,
            lastSyncAt: now,
          },
        });
      } else {
        throw error;
      }
    }

    if (existing) updated += 1;
    else created += 1;

    if (validSupplierGtin) {
      supplierGtinRows += 1;
      const providerKey = buildProviderKey(validSupplierGtin, row.supplierVariantId);
      await prismaAny.variantMapping.upsert({
        where: { supplierVariantId: row.supplierVariantId },
        create: {
          supplierVariantId: row.supplierVariantId,
          gtin: validSupplierGtin,
          providerKey: providerKey ?? null,
          status: "SUPPLIER_GTIN",
        },
        update: {
          gtin: validSupplierGtin,
          providerKey: providerKey ?? null,
          status: "SUPPLIER_GTIN",
        },
      });
    } else {
      if (!hasGtin) missingGtinRows += 1;
      else invalidGtinRows += 1;
      missingOrInvalidVariantIds.push(row.supplierVariantId);
      await prismaAny.variantMapping.upsert({
        where: { supplierVariantId: row.supplierVariantId },
        create: {
          supplierVariantId: row.supplierVariantId,
          gtin: gtin,
          providerKey: null,
          status: "PENDING_GTIN",
        },
        update: {
          gtin: gtin,
          providerKey: null,
          status: "PENDING_GTIN",
        },
      });
    }
  }

  if (options.enrichMissingGtin !== false) {
    for (const supplierVariantId of missingOrInvalidVariantIds) {
      try {
        const { results } = await runKickdbEnrich({
          supplierVariantId,
          force: true,
        });
        enrichedRows += results.length;
      } catch {
        enrichErrors += 1;
      }
    }
  }

  return {
    processed: rows.length,
    created,
    updated,
    supplierGtinRows,
    missingGtinRows,
    invalidGtinRows,
    enrichedRows,
    enrichErrors,
  };
}

