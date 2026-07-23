import { prisma } from "@/app/lib/prisma";
import { normalizeSize } from "@/app/lib/normalize";
import { buildProviderKey } from "@/galaxus/supplier/providerKey";
import { runImageSync } from "@/galaxus/jobs/imageSync";
import type { ScraperShop } from "@/app/lib/scraperShops";
import {
  fetchSnowleaderProductBySku,
  fetchSnowleaderProductSkusPage,
  isRetryableSnowleaderGraphqlError,
  snowleaderGraphqlConfig,
  type SnowleaderGqlVariant,
} from "@/app/lib/snowleaderGraphqlClient";
import { startRun, hasRunningRun, recoverStaleRuns } from "@/app/lib/shopifyScrape";
import { scraperQuery } from "@/app/lib/scraperDb";

export { startRun, hasRunningRun, recoverStaleRuns };

const IMAGE_SYNC_CONCURRENCY = 5;
const IMAGE_SYNC_BATCH = 200;

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
    sizeSourceLabel: variant.sizeSourceLabel,
    sizeConversion: variant.sizeConversion,
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

async function flushImageSyncQueue(imageSyncQueue: Set<string>) {
  if (!imageSyncQueue.size) return { synced: 0, failed: 0 };
  const batch = [...imageSyncQueue].slice(0, IMAGE_SYNC_BATCH);
  for (const id of batch) imageSyncQueue.delete(id);
  const result = await runImageSync({
    supplierVariantIds: batch,
    limit: batch.length,
    concurrency: IMAGE_SYNC_CONCURRENCY,
  });
  return { synced: result.synced, failed: result.failed };
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
  const sizeNormalized = normalizeSize(input.sizeRaw) ?? input.sizeRaw;
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
      sizeNormalized,
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
      sizeNormalized,
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

async function ingestSnowleaderProduct(
  prismaAny: any,
  shop: ScraperShop,
  product: Awaited<ReturnType<typeof fetchSnowleaderProductBySku>>,
  seenGtins: Set<string>,
  existingById: Map<string, ExistingVariantImage>,
  imageSyncQueue: Set<string>
) {
  if (!product?.variants.length) return { wrote: 0, gtinMatched: 0, parseErrors: 0 };
  let wrote = 0;
  let gtinMatched = 0;
  let parseErrors = 0;

  for (const variant of product.variants) {
    if (!variant.galaxusKind) continue;
    if (seenGtins.has(variant.gtin)) continue;
    seenGtins.add(variant.gtin);
    try {
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
    } catch {
      parseErrors++;
    }
  }

  return { wrote, gtinMatched, parseErrors };
}

/** Snowleader sync — light category list + per-SKU detail (avoids CF 504 on fat pages). */
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
  let requestErrors = 0;
  let totalListed = 0;
  let imageSynced = 0;
  let imageFailed = 0;
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

      try {
        for (;;) {
          const listPage = await fetchSnowleaderProductSkusPage({
            page: currentPage,
            categoryId,
            pageSize: cfg.pageSize,
          });
          if (!categoryTotal) {
            categoryTotal = listPage.totalCount;
            totalListed += categoryTotal;
          }
          await updateRun(runId, { products_listed: totalListed });

          if (!listPage.skus.length) break;

          for (const sku of listPage.skus) {
            if (maxProducts && processedProducts >= maxProducts) break;
            processedProducts++;

            try {
              const product = await fetchSnowleaderProductBySku(sku);
              const result = await ingestSnowleaderProduct(
                prismaAny,
                shop,
                product,
                seenGtins,
                existingById,
                imageSyncQueue
              );
              wrote += result.wrote;
              gtinMatched += result.gtinMatched;
              parseErrors += result.parseErrors;
            } catch (err) {
              requestErrors++;
              if (!isRetryableSnowleaderGraphqlError(err)) throw err;
            }

            if (imageSyncQueue.size >= IMAGE_SYNC_BATCH) {
              const img = await flushImageSyncQueue(imageSyncQueue);
              imageSynced += img.synced;
              imageFailed += img.failed;
            }

            if (processedProducts % 10 === 0) {
              await updateRun(runId, {
                with_gtin: gtinMatched,
                variants_upserted: wrote,
                errors: parseErrors + requestErrors,
              });
            }
          }

          await updateRun(runId, {
            with_gtin: gtinMatched,
            variants_upserted: wrote,
            errors: parseErrors + requestErrors,
          });

          if (maxProducts && processedProducts >= maxProducts) break;
          if (currentPage * listPage.pageSize >= listPage.totalCount) break;
          currentPage += 1;
        }
      } catch (err) {
        requestErrors++;
        console.error(`[SCRAPER] snl category ${categoryId} skipped:`, (err as Error)?.message || err);
      }

      if (maxProducts && processedProducts >= maxProducts) break;
    }

    while (imageSyncQueue.size > 0) {
      const img = await flushImageSyncQueue(imageSyncQueue);
      imageSynced += img.synced;
      imageFailed += img.failed;
    }

    await updateRun(runId, {
      status: "ok",
      finished_at: new Date(),
      variants_upserted: wrote,
      with_gtin: gtinMatched,
      errors: parseErrors + requestErrors,
      message: `source=graphql-per-sku store=${cfg.store} categories=${cfg.categoryIds.length} products=${processedProducts} gtin_rows=${gtinMatched} req_errors=${requestErrors} images_synced=${imageSynced} images_failed=${imageFailed}`,
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
