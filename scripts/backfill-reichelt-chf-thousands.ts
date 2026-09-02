/**
 * Backfill REI rows where CHF parse likely clipped thousands separator.
 *
 * Usage:
 *   npx tsx scripts/backfill-reichelt-chf-thousands.ts --dry-run
 *   npx tsx scripts/backfill-reichelt-chf-thousands.ts --limit=200
 *   npx tsx scripts/backfill-reichelt-chf-thousands.ts --ratio=0.6 --min-eur=100 --limit=500
 */
import "dotenv/config";
import { prisma } from "@/app/lib/prisma";
import { findScraperShop } from "@/app/lib/scraperShops";
import { buildProviderKey } from "@/galaxus/supplier/providerKey";
import { ReicheltClient, type ReicheltProduct, reicheltConfig } from "@/app/lib/reicheltClient";
import { classifyReicheltGalaxusKind, reicheltCategoryPathLabel } from "@/app/lib/reicheltGalaxusCategories";
import {
  computeReicheltLandedCost,
  isPlausibleReicheltSellPrice,
  type ReicheltLandedCost,
} from "@/app/lib/reicheltPricing";

type CandidateRow = {
  supplierVariantId: string;
  providerKey: string | null;
  manualNote: string | null;
};

type NoteShape = {
  articleId?: string;
  productUrl?: string;
  reicheltSku?: string;
};

function parseNumArg(prefix: string, fallback: number): number {
  const arg = process.argv.find((a) => a.startsWith(`${prefix}=`));
  if (!arg) return fallback;
  const value = Number(arg.split("=")[1]);
  return Number.isFinite(value) ? value : fallback;
}

function formatNote(product: ReicheltProduct, galaxusKind: string, cost: ReicheltLandedCost) {
  return JSON.stringify({
    type: "reichelt_landed_cost",
    articleId: product.articleId,
    reicheltSku: product.reicheltSku,
    manufacturerPartNo: product.manufacturerPartNo,
    galaxusKind,
    productPriceSource: cost.productPriceSource,
    rawPriceChf: cost.rawPriceChf,
    priceEur: cost.priceEur,
    productChf: cost.productChf,
    shippingEur: cost.shippingEur,
    shippingChf: cost.shippingChf,
    landedChf: cost.landedChf,
    marginPercent: cost.marginPercent,
    sellPriceChf: cost.sellPriceChf,
    weightGrams: cost.weightGrams,
    eurChfRate: cost.eurChfRate,
    vatRate: cost.vatRate,
    stockStatus: product.stockStatus,
    stockText: product.stockText,
    breadcrumbs: product.breadcrumbs,
    productUrl: product.productUrl,
    imageStoredInDb: false,
    stockSource: "availability_status",
    backfill: "chf_thousands_fix",
  });
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const limit = Math.max(1, Math.floor(parseNumArg("--limit", 200)));
  const ratio = Math.max(0.1, Math.min(0.95, parseNumArg("--ratio", 0.6)));
  const minEur = Math.max(20, parseNumArg("--min-eur", 100));
  const shop = findScraperShop("rei");
  if (!shop) throw new Error("REI shop not configured in SCRAPER_SHOPS");

  const candidates = (await prisma.$queryRawUnsafe(
    `
    SELECT "supplierVariantId", "providerKey", "manualNote"
    FROM "SupplierVariant"
    WHERE "providerKey" LIKE 'REI_%'
      AND "manualNote" LIKE '%"type":"reichelt_landed_cost"%'
      AND "manualNote" LIKE '%"productPriceSource":"chf_paren"%'
      AND (("manualNote"::json->>'priceEur')::numeric >= $1)
      AND (("manualNote"::json->>'rawPriceChf')::numeric < ("manualNote"::json->>'priceEur')::numeric * $2)
    ORDER BY "updatedAt" DESC
    LIMIT $3
    `,
    minEur,
    ratio,
    limit
  )) as CandidateRow[];

  console.log(`[rei-chf-backfill] candidates=${candidates.length} ratio<${ratio} minEur=${minEur} dryRun=${dryRun}`);
  if (!candidates.length) {
    await prisma.$disconnect();
    return;
  }

  const client = new ReicheltClient(shop.baseUrl);
  const cfg = reicheltConfig();
  const prismaAny = prisma as any;
  const stats = {
    processed: 0,
    wrote: 0,
    skippedMissingArticleId: 0,
    skippedNoGtin: 0,
    skippedNoPrice: 0,
    skippedUnmapped: 0,
    errors: 0,
  };

  for (const row of candidates) {
    stats.processed++;
    let note: NoteShape = {};
    try {
      note = JSON.parse(String(row.manualNote ?? "")) as NoteShape;
    } catch {
      stats.skippedMissingArticleId++;
      continue;
    }
    const articleId = String(note.articleId ?? "").trim();
    const productUrl = String(note.productUrl ?? "").trim() || undefined;
    if (!articleId) {
      stats.skippedMissingArticleId++;
      continue;
    }

    try {
      const product = await client.fetchProductByArticleId(articleId, productUrl);
      if (!product) {
        stats.skippedNoGtin++;
        continue;
      }
      const cost = computeReicheltLandedCost({
        priceChf: product.priceChf,
        priceEur: product.priceEur,
        weightGrams: product.weightGrams,
      });
      if (!cost || !isPlausibleReicheltSellPrice(cost)) {
        stats.skippedNoPrice++;
        continue;
      }
      const galaxusKind = classifyReicheltGalaxusKind({
        breadcrumbs: product.breadcrumbs,
        title: product.name,
        supplierProductType: reicheltCategoryPathLabel(product.breadcrumbs),
      });
      if (!galaxusKind) {
        stats.skippedUnmapped++;
        continue;
      }

      const supplierVariantId = `${shop.key}_${product.gtin}`;
      const providerKey = buildProviderKey(product.gtin, supplierVariantId);
      if (!providerKey) {
        stats.skippedNoGtin++;
        continue;
      }
      const stock = product.inStock ? cfg.defaultStock : 0;
      const now = new Date();

      console.log(
        `[rei-chf-backfill] ${dryRun ? "DRY" : "upsert"} article=${articleId} sku=${product.reicheltSku} old=${row.supplierVariantId} new=${supplierVariantId} chf=${cost.productChf} eur=${cost.priceEur} sell=${cost.sellPriceChf}`
      );
      if (dryRun) {
        stats.wrote++;
        continue;
      }

      await prismaAny.supplierVariant.upsert({
        where: { supplierVariantId },
        create: {
          supplierVariantId,
          supplierSku: product.reicheltSku,
          providerKey,
          gtin: product.gtin,
          price: cost.sellPriceChf,
          stock,
          supplierBrand: product.brand,
          supplierProductName: product.name,
          supplierProductType: reicheltCategoryPathLabel(product.breadcrumbs),
          sourceImageUrl: product.imageUrl,
          images: [],
          weightGrams: cost.weightGrams,
          manualNote: formatNote(product, galaxusKind, cost),
          imageSyncStatus: product.imageUrl ? "PENDING" : null,
          lastSyncAt: now,
        },
        update: {
          supplierSku: product.reicheltSku,
          providerKey,
          gtin: product.gtin,
          price: cost.sellPriceChf,
          stock,
          supplierBrand: product.brand,
          supplierProductName: product.name,
          supplierProductType: reicheltCategoryPathLabel(product.breadcrumbs),
          sourceImageUrl: product.imageUrl,
          weightGrams: cost.weightGrams,
          manualNote: formatNote(product, galaxusKind, cost),
          lastSyncAt: now,
        },
      });
      await prismaAny.variantMapping.upsert({
        where: { supplierVariantId },
        create: {
          supplierVariantId,
          gtin: product.gtin,
          providerKey,
          supplierKey: shop.key,
          status: "SUPPLIER_GTIN",
        },
        update: {
          gtin: product.gtin,
          providerKey,
          supplierKey: shop.key,
          status: "SUPPLIER_GTIN",
        },
      });
      stats.wrote++;
    } catch (err) {
      stats.errors++;
      console.warn(`[rei-chf-backfill] error article=${articleId}:`, (err as Error)?.message || err);
    }
  }

  console.log(JSON.stringify(stats, null, 2));
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
