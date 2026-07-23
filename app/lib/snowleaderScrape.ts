import { prisma } from "@/app/lib/prisma";
import { buildProviderKey } from "@/galaxus/supplier/providerKey";
import { runImageSync } from "@/galaxus/jobs/imageSync";
import type { ScraperShop } from "@/app/lib/scraperShops";
import {
  fetchSnowleaderProductsPage,
  snowleaderGraphqlConfig,
  type SnowleaderGqlVariant,
} from "@/app/lib/snowleaderGraphqlClient";
import { startRun, hasRunningRun, recoverStaleRuns } from "@/app/lib/shopifyScrape";
import { scraperQuery } from "@/app/lib/scraperDb";

export { startRun, hasRunningRun, recoverStaleRuns };

const IMAGE_SYNC_CONCURRENCY = 5;

type ExistingVariantImage = {
  sourceImageUrl: string | null;
  hostedImageUrl: string | null;
  imageSyncStatus: string | null;
};

function formatGraphqlNote(variant: SnowleaderGqlVariant) {
  return JSON.stringify({
    type: "snowleader_gql",
    parentSku: variant.parentSku,
    childSku: variant.childSku,
    urlKey: variant.urlKey,
    sizeLabel: variant.sizeLabel,
    galaxusKind: variant.galaxusKind,
    buyPriceSource: "website_final_price",
    regularPriceChf: variant.regularPriceChf,
    discountPercentOff: variant.discountPercentOff,
    categoryIds: variant.categories.map((cat) => cat.id).filter(Boolean),
    categoryNames: variant.categories.map((cat) => cat.name).filter(Boolean),
    imageCount: variant.imageUrls.length,
    stockSource: "graphql_inventory_status",
  });
}

function needsImageHosting(
  existing: ExistingVariantImage | undefined,
  sourceImageUrl: string | null
): boolean {
  if (!sourceImageUrl) return false;
  if (!existing) return true;
  return String(existing.sourceImageUrl ?? "").trim() !== sourceImageUrl.trim();
}

async function updateRun(runId: number, fields: Record<string, unknown>) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
  await scraperQuery(`UPDATE scraper.scrape_runs SET ${sets} WHERE id = $1`, [runId, ...keys.map((k) => fields[k])]);
}

async function upsertSnowleaderVariant(
  prismaAny: any,
  shop: ScraperShop,
  input: {
    gtin: string;
    supplierSku: string;
    price: number;
    stock: number;
    brand: string | null;
    name: string;
    productType: string | null;
    sizeRaw: string | null;
    imageUrl: string | null;
    images: string[];
    gender: string | null;
    color: string | null;
    manualNote: string;
  },
  existingById: Map<string, ExistingVariantImage>,
  imageSyncQueue: Set<string>
) {
  const supplierVariantId = `${shop.key}_${input.gtin}`;
  const providerKey = buildProviderKey(input.gtin, supplierVariantId);
  if (!providerKey) return false;

  const existing = existingById.get(supplierVariantId);
  const queueImage = needsImageHosting(existing, input.imageUrl);
  const now = new Date();

  await prismaAny.supplierVariant.upsert({
    where: { supplierVariantId },
    create: {
      supplierVariantId,
      supplierSku: input.supplierSku,
      providerKey,
      gtin: input.gtin,
      price: input.price,
      stock: input.stock,
      sizeRaw: input.sizeRaw,
      supplierBrand: input.brand,
      supplierProductName: input.name,
      supplierProductType: input.productType,
      supplierGender: input.gender,
      supplierColorway: input.color,
      sourceImageUrl: input.imageUrl,
      images: input.images,
      manualNote: input.manualNote,
      imageSyncStatus: input.imageUrl ? "PENDING" : null,
      lastSyncAt: now,
    },
    update: {
      supplierSku: input.supplierSku,
      providerKey,
      gtin: input.gtin,
      price: input.price,
      stock: input.stock,
      sizeRaw: input.sizeRaw,
      supplierBrand: input.brand,
      supplierProductName: input.name,
      supplierProductType: input.productType,
      supplierGender: input.gender,
      supplierColorway: input.color,
      sourceImageUrl: input.imageUrl,
      images: input.images,
      manualNote: input.manualNote,
      ...(queueImage
        ? {
            imageSyncStatus: "PENDING",
            imageSyncError: null,
            hostedImageUrl: null,
          }
        : {}),
      lastSyncAt: now,
    },
  });

  await prismaAny.variantMapping.upsert({
    where: { supplierVariantId },
    create: {
      supplierVariantId,
      gtin: input.gtin,
      providerKey,
      supplierKey: shop.key,
      status: "SUPPLIER_GTIN",
    },
    update: {
      gtin: input.gtin,
      providerKey,
      supplierKey: shop.key,
      status: "SUPPLIER_GTIN",
    },
  });

  existingById.set(supplierVariantId, {
    sourceImageUrl: input.imageUrl,
    hostedImageUrl: queueImage ? null : existing?.hostedImageUrl ?? null,
    imageSyncStatus: queueImage ? "PENDING" : existing?.imageSyncStatus ?? null,
  });
  if (queueImage) imageSyncQueue.add(supplierVariantId);
  return true;
}

/** Snowleader sync via Magento GraphQL — real price/stock/gtin per size. Config is hardcoded in code. */
export async function scrapeSnowleaderShop(
  shop: ScraperShop,
  runId: number,
  maxProducts?: number
): Promise<void> {
  const prismaAny = prisma as any;
  const cfg = snowleaderGraphqlConfig();
  let processedProducts = 0;
  let wrote = 0;
  let gtinMatched = 0;
  let parseErrors = 0;
  let totalListed = 0;
  const seenGtins = new Set<string>();
  const imageSyncQueue = new Set<string>();

  const existingRows = (await prismaAny.supplierVariant.findMany({
    where: { supplierVariantId: { startsWith: `${shop.key}_` } },
    select: {
      supplierVariantId: true,
      sourceImageUrl: true,
      hostedImageUrl: true,
      imageSyncStatus: true,
    },
  })) as Array<ExistingVariantImage & { supplierVariantId: string }>;
  const existingById = new Map(
    existingRows.map((row) => [
      row.supplierVariantId,
      {
        sourceImageUrl: row.sourceImageUrl ?? null,
        hostedImageUrl: row.hostedImageUrl ?? null,
        imageSyncStatus: row.imageSyncStatus ?? null,
      },
    ])
  );

  try {
    for (const categoryId of cfg.categoryIds) {
      let currentPage = 1;
      let categoryTotal = 0;

      for (;;) {
        const page = await fetchSnowleaderProductsPage({
          page: currentPage,
          categoryId,
          pageSize: cfg.pageSize,
        });
        if (!categoryTotal) {
          categoryTotal = page.totalCount;
          totalListed += categoryTotal;
        }
        await updateRun(runId, { products_listed: totalListed });

        if (!page.products.length) break;

        for (const product of page.products) {
          if (maxProducts && processedProducts >= maxProducts) break;
          processedProducts++;

          try {
            if (!product.variants.length) continue;
          for (const variant of product.variants) {
            if (!variant.galaxusKind) continue;
            if (seenGtins.has(variant.gtin)) continue;
            seenGtins.add(variant.gtin);

            const ok = await upsertSnowleaderVariant(
              prismaAny,
              shop,
              {
                gtin: variant.gtin,
                supplierSku: variant.parentSku,
                price: variant.buyPriceChf,
                stock: variant.stock,
                brand: variant.brand,
                name: variant.parentName,
                productType: variant.productType,
                sizeRaw: variant.sizeLabel,
                imageUrl: variant.imageUrl,
                images: variant.imageUrls,
                gender: variant.gender,
                color: variant.color,
                manualNote: formatGraphqlNote(variant),
              },
                existingById,
                imageSyncQueue
              );
              if (!ok) continue;
              wrote++;
              gtinMatched++;
            }
          } catch {
            parseErrors++;
          }
        }

        await updateRun(runId, {
          with_gtin: gtinMatched,
          variants_upserted: wrote,
          errors: parseErrors,
        });

        if (maxProducts && processedProducts >= maxProducts) break;
        if (currentPage * page.pageSize >= page.totalCount) break;
        currentPage += 1;
      }

      if (maxProducts && processedProducts >= maxProducts) break;
    }

    let imageSynced = 0;
    let imageFailed = 0;
    if (imageSyncQueue.size > 0) {
      const imageResult = await runImageSync({
        supplierVariantIds: [...imageSyncQueue],
        limit: imageSyncQueue.size,
        concurrency: IMAGE_SYNC_CONCURRENCY,
      });
      imageSynced = imageResult.synced;
      imageFailed = imageResult.failed;
    }

    await updateRun(runId, {
      status: "ok",
      finished_at: new Date(),
      variants_upserted: wrote,
      with_gtin: gtinMatched,
      errors: parseErrors,
      message: `source=graphql store=${cfg.store} categories=${cfg.categoryIds.length} products=${processedProducts} gtin_rows=${gtinMatched} images_synced=${imageSynced} images_failed=${imageFailed}`,
    });
  } catch (err: any) {
    await updateRun(runId, {
      status: "error",
      finished_at: new Date(),
      message: String(err?.message || err).slice(0, 2000),
    });
    throw err;
  }
}
