/**
 * TURBO reprice — no per-product Shopify reads.
 * Uses ChannelListingState.externalVariantId + ShopifySyncState.shopifyProductId
 * → productVariantsBulkUpdate, then express metafields (express_available / express_price)
 * via syncExpressForVariants in the same pass. Disable with --no-express.
 *
 *   npx tsx scripts/reprice-shopify-turbo.ts --apply --concurrency=12
 */
import "dotenv/config";
import { prisma } from "@/app/lib/prisma";
import { formatShopifyApiMetricsLine, shopifyGraphQL } from "@/lib/shopifyAdmin";
import { syncExpressForVariants } from "@/shopify/inventory/expressRepriceSync";
import { computeStxSellPrices } from "@/shopify/stx/syncShopifyStxPrices";

function num(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const APPLY = process.argv.includes("--apply");
const SYNC_EXPRESS = !process.argv.includes("--no-express");
const CONCURRENCY = Math.max(1, Math.min(16, Math.floor(num("concurrency", 12))));
const MAX_PRICE = num("max-price", 5000);
const LIMIT = Math.max(1, Math.floor(num("limit", 500_000)));
const PROGRESS_EVERY = Math.max(1, Math.floor(num("progress-every", 100)));
const SHARDS = Math.max(1, Math.floor(num("shards", 1)));
const SHARD = Math.min(SHARDS - 1, Math.floor(num("shard", 0)));

const BULK_UPDATE = /* GraphQL */ `
mutation TurboRepriceBulk($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    userErrors { field message }
  }
}`;

type Row = {
  supplierVariantId: string;
  providerKey: string;
  gtin: string | null;
  deliveryType: string | null;
  price: number | null;
  standardBuyPrice: number | null;
  expressBuyPrice: number | null;
  supplierProductName: string | null;
  supplierBrand: string | null;
  shopifyProductId: string;
  productHandle: string | null;
  lastPushedPrice: number | null;
  externalVariantId: string;
};

function toProductGid(id: string): string {
  return id.startsWith("gid://") ? id : `gid://shopify/Product/${id}`;
}
function toVariantGid(id: string): string {
  if (id.startsWith("gid://")) return id;
  if (/^\d+$/.test(id)) return `gid://shopify/ProductVariant/${id}`;
  return id;
}

async function main() {
  console.log(
    `${APPLY ? "APPLY" : "DRY-RUN"} | TURBO | shard ${SHARD}/${SHARDS} | concurrency=${CONCURRENCY} | max-price=${MAX_PRICE} | limit=${LIMIT}`
  );
  const startedAt = Date.now();
  const shardClause =
    SHARDS > 1
      ? `AND (abs(hashtextextended(cls."externalProductId", 0)) % ${SHARDS}) = ${SHARD}`
      : "";

  // CLS already has Shopify GIDs — no KickDB/ShopifySyncState join (was timing out).
  const rows = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '900s'`);
      return tx.$queryRawUnsafe<Row[]>(`
    SELECT sv."supplierVariantId",
           sv."providerKey",
           sv."gtin",
           sv."deliveryType",
           sv."price"::float AS price,
           sv."standardBuyPrice"::float AS "standardBuyPrice",
           sv."expressBuyPrice"::float AS "expressBuyPrice",
           sv."supplierProductName",
           sv."supplierBrand",
           cls."externalProductId" AS "shopifyProductId",
           NULL::text AS "productHandle",
           cls."lastPushedPrice"::float AS "lastPushedPrice",
           cls."externalVariantId"
    FROM "ChannelListingState" cls
    JOIN "SupplierVariant" sv ON sv."providerKey" = cls."providerKey"
    WHERE cls.channel = 'SHOPIFY'
      AND cls."externalVariantId" IS NOT NULL
      AND cls."externalVariantId" <> ''
      AND cls."externalProductId" IS NOT NULL
      AND cls."externalProductId" <> ''
      AND sv.stock > 0
      AND sv."manualLock" IS DISTINCT FROM TRUE
      AND sv."supplierVariantId" LIKE 'stx_%'
      AND COALESCE(sv."standardBuyPrice", sv.price) > 0
      AND NOT EXISTS (
        SELECT 1 FROM "ShopifyVariantLocationStock" ph
        WHERE ph."sourceType" = 'physical' AND ph.available > 0
          AND regexp_replace(ph."shopifyVariantId", '[^0-9]', '', 'g') = regexp_replace(cls."externalVariantId", '[^0-9]', '', 'g')
      )
      ${shardClause}
    ORDER BY cls."externalProductId"
    LIMIT ${LIMIT}
  `);
    },
    { timeout: 930_000, maxWait: 30_000 }
  );

  type Target = { providerKey: string; supplierVariantId: string; gtin: string; variantId: string; price: number; priceFresh: boolean };
  const byProduct = new Map<string, Target[]>();
  let skippedNoSell = 0;
  let skippedCeiling = 0;
  let skippedFresh = 0;
  let expressChanged = 0;

  for (const r of rows) {
    if (!r.providerKey) continue;
    const { normalSell } = computeStxSellPrices({
      stxRow: {
        deliveryType: r.deliveryType,
        price: r.price,
        standardBuyPrice: r.standardBuyPrice,
        expressBuyPrice: r.expressBuyPrice,
        supplierProductName: r.supplierProductName,
        supplierBrand: r.supplierBrand,
      },
      productHandle: r.productHandle,
    });
    if (normalSell == null) {
      skippedNoSell += 1;
      continue;
    }
    if (normalSell > MAX_PRICE) {
      skippedCeiling += 1;
      continue;
    }
    const priceFresh = r.lastPushedPrice != null && Math.abs(r.lastPushedPrice - normalSell) < 0.005;
    if (priceFresh) {
      skippedFresh += 1;
      // Price already current: only revisit for express metafields.
      if (!SYNC_EXPRESS) continue;
    }
    // externalProductId may already be a GID — normalize to bare id for grouping key,
    // but pass full GID to the API via toProductGid.
    const pid = String(r.shopifyProductId).replace(/^gid:\/\/shopify\/Product\//, "");
    let list = byProduct.get(pid);
    if (!list) {
      list = [];
      byProduct.set(pid, list);
    }
    list.push({
      providerKey: r.providerKey,
      supplierVariantId: r.supplierVariantId,
      gtin: String(r.gtin ?? ""),
      variantId: toVariantGid(r.externalVariantId),
      price: normalSell,
      priceFresh,
    });
  }

  const entries = Array.from(byProduct.entries());
  console.log(
    `rows=${rows.length} products=${entries.length} variantsToPush=${entries.reduce((n, [, v]) => n + v.length, 0)} skippedFresh=${skippedFresh} noSell=${skippedNoSell} ceiling=${skippedCeiling}`
  );

  let productsDone = 0;
  let variantsPushed = 0;
  let productErrors = 0;
  let nextIdx = 0;

  // Skip CLS stamp on hot path (was ~1s/product). Stamp once at end via bulk SQL.
  const stamped: Array<Target & { productGid: string }> = [];

  async function flushStamps() {
    if (stamped.length === 0) return;
    const now = new Date();
    console.log(`  stamping CLS rows=${stamped.length}...`);
    for (let i = 0; i < stamped.length; i += 400) {
      const slice = stamped.slice(i, i + 400);
      const values = slice
        .map((_, idx) => `($${idx * 3 + 2}::text, $${idx * 3 + 3}::numeric, $${idx * 3 + 4}::text)`)
        .join(",");
      const params: unknown[] = [now];
      for (const t of slice) params.push(t.providerKey, t.price, t.productGid);
      await prisma.$executeRawUnsafe(
        `UPDATE "ChannelListingState" AS cls
         SET "lastPushedPrice" = v.price,
             "lastSyncedAt" = $1::timestamptz,
             "externalProductId" = v.product_gid,
             "lastError" = NULL
         FROM (VALUES ${values}) AS v(provider_key, price, product_gid)
         WHERE cls.channel = 'SHOPIFY' AND cls."providerKey" = v.provider_key`,
        ...params
      );
    }
  }

  async function processOne(productId: string, targets: Target[]) {
    const productGid = toProductGid(productId);
    const seen = new Set<string>();
    const unique = targets.filter((t) => {
      if (seen.has(t.variantId)) return false;
      seen.add(t.variantId);
      return true;
    });
    for (let i = 0; i < unique.length; i += 100) {
      const chunk = unique.slice(i, i + 100);
      const toPush = chunk.filter((t) => !t.priceFresh);
      const variants = toPush.map((t) => ({ id: t.variantId, price: t.price.toFixed(2) }));
      if (!APPLY) {
        variantsPushed += toPush.length;
        continue;
      }
      try {
        if (variants.length > 0) {
        const upd = await shopifyGraphQL<{
          productVariantsBulkUpdate: { userErrors: Array<{ message: string }> };
        }>(BULK_UPDATE, { productId: productGid, variants }, { estimatedQueryCost: 15, reservePoints: 5 });
        const ue = [
          ...(upd.errors ?? []).map((e) => e.message),
          ...(upd.data?.productVariantsBulkUpdate?.userErrors ?? []).map((e) => e.message),
        ];
        if (ue.length) throw new Error(ue.join("; "));
        for (const t of toPush) stamped.push({ ...t, productGid });
        variantsPushed += toPush.length;
        }
        if (SYNC_EXPRESS) {
          // Reads the new Shopify price, then fixes express_available / express_price diffs.
          const ex = await syncExpressForVariants(chunk.map((t) => t.variantId));
          expressChanged += ex.changed.length;
        }
      } catch (err) {
        productErrors += 1;
        console.error(`  product ${productGid} failed:`, err instanceof Error ? err.message.slice(0, 180) : err);
        return;
      }
    }
    productsDone += 1;
    if (productsDone % PROGRESS_EVERY === 0) {
      const elapsed = (Date.now() - startedAt) / 1000;
      const rate = productsDone / Math.max(elapsed, 1);
      const left = entries.length - productsDone;
      console.log(
        `  ${productsDone}/${entries.length} products | pushed ${variantsPushed} | errors ${productErrors} | ${rate.toFixed(1)}/s ETA ${Math.round(left / Math.max(rate, 0.01))}s`
      );
    }
  }

  async function worker() {
    for (;;) {
      const i = nextIdx++;
      if (i >= entries.length) return;
      const [pid, targets] = entries[i]!;
      await processOne(pid, targets);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(entries.length, 1)) }, () => worker()));
  await flushStamps();

  console.log(
    `\nRESUME TURBO shard ${SHARD}/${SHARDS}: products=${productsDone} pushedVariants=${variantsPushed} expressChanged=${expressChanged} productErrors=${productErrors} durationSec=${Math.round((Date.now() - startedAt) / 1000)}`
  );
  console.log(formatShopifyApiMetricsLine("SHOPIFY_API][turbo"));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
