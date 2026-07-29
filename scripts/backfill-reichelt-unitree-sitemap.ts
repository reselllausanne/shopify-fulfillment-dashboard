/**
 * Backfill all Unitree products found in Reichelt product sitemaps.
 *
 * Usage:
 *   npx tsx scripts/backfill-reichelt-unitree-sitemap.ts
 *   npx tsx scripts/backfill-reichelt-unitree-sitemap.ts --dry-run
 *   npx tsx scripts/backfill-reichelt-unitree-sitemap.ts --scan-only
 *   npx tsx scripts/backfill-reichelt-unitree-sitemap.ts --fallback-only
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../app/lib/prisma";
import { buildProviderKey } from "../galaxus/supplier/providerKey";
import { findScraperShop } from "../app/lib/scraperShops";
import {
  ReicheltClient,
  extractReicheltArticleIdFromUrl,
  reicheltConfig,
  toReicheltChFrProductUrl,
  type ReicheltProduct,
} from "../app/lib/reicheltClient";
import {
  classifyReicheltGalaxusKind,
  reicheltCategoryPathLabel,
} from "../app/lib/reicheltGalaxusCategories";
import {
  computeReicheltLandedCost,
  isPlausibleReicheltSellPrice,
  type ReicheltLandedCost,
} from "../app/lib/reicheltPricing";

const UNITREE_URL = /unitree|go2_edu_plu_40_tops|humanoid.*roboter|humanoid_robot/i;
const FALLBACK_URLS_FILE = path.join(process.cwd(), "artifacts/reichelt-unitree-sitemap-urls.txt");
const LIVE_SITEMAP_FILE = path.join(process.cwd(), "artifacts/reichelt-unitree-sitemap-live.txt");

function loadUrlList(filePath: string): Array<{ articleId: string; productUrl: string }> {
  if (!fs.existsSync(filePath)) return [];
  const out: Array<{ articleId: string; productUrl: string }> = [];
  const seen = new Set<string>();
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const url = trimmed;
    if (!UNITREE_URL.test(url)) continue;
    const articleId = extractReicheltArticleIdFromUrl(url);
    if (!articleId || seen.has(articleId)) continue;
    seen.add(articleId);
    out.push({
      articleId,
      productUrl: toReicheltChFrProductUrl(url) ?? url,
    });
  }
  return out;
}

function loadFallbackTargets(): Array<{ articleId: string; productUrl: string }> {
  const merged = [...loadUrlList(FALLBACK_URLS_FILE), ...loadUrlList(LIVE_SITEMAP_FILE)];
  const seen = new Set<string>();
  return merged.filter((t) => {
    if (seen.has(t.articleId)) return false;
    seen.add(t.articleId);
    return true;
  });
}

function productUrlCandidates(articleId: string, primaryUrl: string): string[] {
  const slug = primaryUrl.match(/\/shop\/(?:product|produit)\/([^/?#]+)/i)?.[1];
  const urls = new Set<string>([primaryUrl]);
  if (slug) {
    urls.add(`https://www.reichelt.com/ch/fr/shop/produit/${slug}`);
    urls.add(`https://www.reichelt.de/de/de/shop/produkt/${slug}-${articleId}`);
    urls.add(`https://www.reichelt.com/de/en/shop/product/${slug}-${articleId}`);
  }
  urls.add(`https://www.reichelt.com/ch/fr/shop/produit/-${articleId}`);
  return [...urls];
}

async function fetchUnitreeProduct(
  client: ReicheltClient,
  articleId: string,
  productUrl: string
): Promise<ReicheltProduct | null> {
  for (const url of productUrlCandidates(articleId, productUrl)) {
    try {
      const product = await client.fetchProductByArticleId(articleId, url);
      if (product) return product;
    } catch {
      /* try next URL */
    }
  }
  return null;
}

async function collectUnitreeTargets(client: ReicheltClient): Promise<Array<{ articleId: string; productUrl: string }>> {
  const out: Array<{ articleId: string; productUrl: string }> = [];
  const seen = new Set<string>();

  for await (const { urls } of client.iterProductSitemapShards()) {
    for (const url of urls) {
      if (!UNITREE_URL.test(url)) continue;
      const articleId = extractReicheltArticleIdFromUrl(url);
      if (!articleId || seen.has(articleId)) continue;
      seen.add(articleId);
      out.push({
        articleId,
        productUrl: toReicheltChFrProductUrl(url) ?? url,
      });
    }
  }
  return out.sort((a, b) => Number(a.articleId) - Number(b.articleId));
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
    backfill: "unitree_sitemap",
  });
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const scanOnly = process.argv.includes("--scan-only");
  const fallbackOnly = process.argv.includes("--fallback-only");
  const shop = findScraperShop("rei");
  if (!shop) throw new Error("REI shop not configured in SCRAPER_SHOPS");

  const client = new ReicheltClient(shop.baseUrl);
  const cfg = reicheltConfig();
  const prismaAny = prisma as any;

  let targets: Array<{ articleId: string; productUrl: string }>;
  if (fallbackOnly) {
    targets = loadFallbackTargets();
    console.log(`[unitree] fallback-only — ${targets.length} URLs`);
  } else {
    console.log("[unitree] scanning sitemap…");
    targets = await collectUnitreeTargets(client);
    if (!targets.length) {
      targets = loadFallbackTargets();
      console.log(`[unitree] sitemap empty/unreachable — using ${targets.length} fallback URLs`);
    }
  }
  console.log(`[unitree] found ${targets.length} product URLs`);
  for (const t of targets) console.log(`  ${t.articleId} ${t.productUrl}`);

  if (scanOnly) {
    await prisma.$disconnect();
    return;
  }

  const stats = {
    processed: 0,
    wrote: 0,
    skippedNoGtin: 0,
    skippedNoPrice: 0,
    skippedUnmapped: 0,
    errors: 0,
  };

  for (const { articleId, productUrl } of targets) {
    stats.processed++;
    try {
      const product = await fetchUnitreeProduct(client, articleId, productUrl);
      if (!product) {
        stats.skippedNoGtin++;
        console.warn(`[unitree] skip no gtin ${articleId} ${productUrl}`);
        continue;
      }
      const cost = computeReicheltLandedCost({
        priceChf: product.priceChf,
        priceEur: product.priceEur,
        weightGrams: product.weightGrams,
      });
      if (!cost || !isPlausibleReicheltSellPrice(cost)) {
        stats.skippedNoPrice++;
        console.warn(`[unitree] skip no price ${articleId} ${product.name}`);
        continue;
      }
      const galaxusKind = classifyReicheltGalaxusKind({
        breadcrumbs: product.breadcrumbs,
        title: product.name,
        supplierProductType: reicheltCategoryPathLabel(product.breadcrumbs),
      });
      if (!galaxusKind) {
        stats.skippedUnmapped++;
        console.warn(`[unitree] skip unmapped ${articleId} ${product.name}`);
        continue;
      }

      const supplierVariantId = `${shop.key}_${product.gtin}`;
      const providerKey = buildProviderKey(product.gtin, supplierVariantId);
      if (!providerKey) {
        stats.skippedNoGtin++;
        continue;
      }

      console.log(
        `[unitree] ${dryRun ? "DRY" : "upsert"} ${articleId} ${product.reicheltSku} gtin=${product.gtin} kind=${galaxusKind} chf=${cost.sellPriceChf}`
      );

      if (dryRun) {
        stats.wrote++;
        continue;
      }

      const stock = product.inStock ? cfg.defaultStock : 0;
      const now = new Date();
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
      console.warn(`[unitree] error ${articleId}:`, (err as Error)?.message || err);
    }
  }

  const dbCount = await prismaAny.supplierVariant.count({
    where: {
      supplierVariantId: { startsWith: `${shop.key}_` },
      supplierProductName: { contains: "UNITREE", mode: "insensitive" },
    },
  });

  console.log(JSON.stringify({ ...stats, unitreeInDb: dbCount, dryRun }, null, 2));
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
