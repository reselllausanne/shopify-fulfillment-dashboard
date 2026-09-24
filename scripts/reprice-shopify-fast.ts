/**
 * FAST one-shot Shopify reprice — product-batched.
 *
 * The per-GTIN sync (`reprice-shopify-stock.ts` / the worker) issues ~5-6
 * Shopify calls per variant. Shopify serves this shop's Admin API at a fixed
 * request ceiling, so draining ~474k in-stock STX variants that way takes days.
 *
 * This walks the catalogue grouped by Shopify PRODUCT and issues ONE
 * `productVariantsBulkUpdate` for every in-stock size at once (a shoe = ~12
 * sizes in a single mutation), plus one batched `metafieldsSet` for express.
 * That cuts total requests ~10x. Prices come from `computeStxSellPrices` — the
 * exact locked formula SSE ingest and the nightly worker use, so this can never
 * diverge from steady-state pricing.
 *
 * It is idempotent: it stamps `ChannelListingState.lastPushedPrice` /
 * `lastSyncedAt` just like the sync path, so the worker's 48h skip and diff-skip
 * treat these variants as fresh and never re-walk them.
 *
 * Shard across processes to reach the shop's request ceiling:
 *   for i in 0..7: reprice-shopify-fast --apply --shards=8 --shard=$i
 *
 * Dry-run by default.
 *   npx tsx scripts/reprice-shopify-fast.ts --limit=200
 *   npx tsx scripts/reprice-shopify-fast.ts --apply --shards=8 --shard=0
 */
import "dotenv/config";

import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { computeStxSellPrices } from "@/shopify/stx/syncShopifyStxPrices";
import { isAdminOnlyShopifyVariant } from "@/shopify/protection/adminOnlyProducts";

function num(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const APPLY = process.argv.includes("--apply");
const LIMIT = num("limit", 1000);
const SHARDS = Math.max(1, Math.floor(num("shards", 1)));
const SHARD = Math.min(SHARDS - 1, Math.floor(num("shard", 0)));
const SKIP_FRESH_HOURS = num("skip-fresh-hours", 24);
const MAX_PRICE = num("max-price", 5000);
const PROGRESS_EVERY = Math.max(1, Math.floor(num("progress-every", 200)));

const VARIANTS_QUERY = /* GraphQL */ `
query FastRepriceProduct($id: ID!) {
  product(id: $id) {
    id
    variants(first: 250) {
      nodes {
        id
        barcode
        priceLocked: metafield(namespace: "custom", key: "price_locked") { value }
      }
    }
  }
}`;

const BULK_UPDATE = /* GraphQL */ `
mutation FastRepriceBulk($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    userErrors { field message }
  }
}`;

const METAFIELDS_SET = /* GraphQL */ `
mutation FastRepriceMeta($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    userErrors { message }
  }
}`;

type Row = {
  supplierVariantId: string;
  providerKey: string | null;
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
};

function toProductGid(id: string): string {
  return id.startsWith("gid://") ? id : `gid://shopify/Product/${id}`;
}

function truthy(v: string | null | undefined): boolean {
  return String(v ?? "").trim().toLowerCase() === "true";
}

async function main() {
  console.log(
    `${APPLY ? "APPLY" : "DRY-RUN"} | shard ${SHARD}/${SHARDS} | skip-fresh=${SKIP_FRESH_HOURS}h | max-price=${MAX_PRICE} | limit=${LIMIT}`
  );

  const shardClause =
    SHARDS > 1
      ? `AND (abs(hashtextextended(sss."shopifyProductId", 0)) % ${SHARDS}) = ${SHARD}`
      : "";
  const skipFreshClause = SKIP_FRESH_HOURS
    ? `AND (cls."lastSyncedAt" IS NULL OR cls."lastSyncedAt" < NOW() - INTERVAL '${Math.round(SKIP_FRESH_HOURS)} hours')`
    : "";

  const rows = await prisma.$queryRawUnsafe<Row[]>(`
    SELECT sv."supplierVariantId",
           sv."providerKey",
           sv."gtin",
           sv."deliveryType",
           sv."price"::float AS price,
           sv."standardBuyPrice"::float AS "standardBuyPrice",
           sv."expressBuyPrice"::float AS "expressBuyPrice",
           sv."supplierProductName",
           sv."supplierBrand",
           sss."shopifyProductId",
           p."urlKey" AS "productHandle",
           cls."lastPushedPrice"::float AS "lastPushedPrice"
    FROM "SupplierVariant" sv
    JOIN "KickDBVariant" kv
      ON kv."gtin" = sv."gtin" OR kv."ean" = sv."gtin"
    JOIN "KickDBProduct" p ON p."id" = kv."productId"
    JOIN "ShopifySyncState" sss
      ON sss."kickdbProductId" = p."kickdbProductId"
    LEFT JOIN "ChannelListingState" cls
      ON cls."channel" = 'SHOPIFY' AND cls."providerKey" = sv."providerKey"
    WHERE sv.stock > 0
      AND sv."manualLock" IS DISTINCT FROM TRUE
      AND sv."supplierVariantId" LIKE 'stx_%'
      AND sv."gtin" IS NOT NULL
      AND COALESCE(sv."standardBuyPrice", sv.price) > 0
      AND sss."syncStatus" = 'synced'
      AND sss."shopifyProductId" IS NOT NULL
      ${shardClause}
      ${skipFreshClause}
    ORDER BY sss."shopifyProductId"
    LIMIT ${Math.max(1, Math.floor(LIMIT))}
  `);

  // Group rows by Shopify product, keyed by barcode(=gtin) for local matching.
  const byProduct = new Map<string, Map<string, Row>>();
  for (const r of rows) {
    const pid = String(r.shopifyProductId);
    const gtin = String(r.gtin ?? "").trim();
    if (!gtin) continue;
    let m = byProduct.get(pid);
    if (!m) {
      m = new Map();
      byProduct.set(pid, m);
    }
    m.set(gtin, r);
  }

  console.log(`Rows: ${rows.length} | products: ${byProduct.size}`);
  if (byProduct.size === 0) return;

  let productsDone = 0;
  let variantsPushed = 0;
  let variantsUnchanged = 0;
  let variantsLocked = 0;
  let variantsNoMatch = 0;
  let variantsCeiling = 0;
  let variantsAdminOnly = 0;
  let productErrors = 0;

  for (const [rawProductId, gtinMap] of byProduct) {
    const productGid = toProductGid(rawProductId);
    let productData: {
      product: {
        id: string;
        variants: {
          nodes: Array<{
            id: string;
            barcode: string | null;
            priceLocked: { value: string | null } | null;
          }>;
        };
      } | null;
    };
    try {
      const res = await shopifyGraphQL<typeof productData>(VARIANTS_QUERY, {
        id: productGid,
      });
      if (res.errors?.length) throw new Error(res.errors.map((e) => e.message).join("; "));
      productData = res.data;
    } catch (err) {
      productErrors += 1;
      console.error(`  product ${productGid} query failed:`, err instanceof Error ? err.message : err);
      continue;
    }

    const nodes = productData?.product?.variants?.nodes ?? [];
    const bulkVariants: Array<{ id: string; price: string }> = [];
    const metafields: Array<{
      ownerId: string;
      namespace: string;
      key: string;
      type: string;
      value: string;
    }> = [];
    const stamped: Array<{ providerKey: string; supplierVariantId: string; gtin: string; variantId: string; price: number }> = [];

    for (const node of nodes) {
      const barcode = String(node.barcode ?? "").trim();
      if (!barcode) continue;
      const row = gtinMap.get(barcode);
      if (!row) continue; // size not in stock / not our row
      if (truthy(node.priceLocked?.value)) {
        variantsLocked += 1;
        continue;
      }
      if (isAdminOnlyShopifyVariant(node.id, productGid)) {
        variantsAdminOnly += 1;
        continue;
      }
      const { normalSell, expressSell } = computeStxSellPrices({
        stxRow: {
          deliveryType: row.deliveryType,
          price: row.price,
          standardBuyPrice: row.standardBuyPrice,
          expressBuyPrice: row.expressBuyPrice,
          supplierProductName: row.supplierProductName,
          supplierBrand: row.supplierBrand,
        },
        productHandle: row.productHandle,
      });
      if (normalSell == null) continue;
      if (normalSell > MAX_PRICE) {
        variantsCeiling += 1;
        continue;
      }
      if (row.lastPushedPrice != null && Math.abs(row.lastPushedPrice - normalSell) < 0.005) {
        variantsUnchanged += 1;
        continue;
      }

      bulkVariants.push({ id: node.id, price: normalSell.toFixed(2) });
      if (expressSell != null) {
        metafields.push({
          ownerId: node.id,
          namespace: "custom",
          key: "express_price",
          type: "money",
          value: JSON.stringify({ amount: expressSell.toFixed(2), currency_code: "CHF" }),
        });
        metafields.push({
          ownerId: node.id,
          namespace: "custom",
          key: "express_available",
          type: "boolean",
          value: "true",
        });
      } else {
        // No express lane: hide it so the theme never shows a stale/inverted price.
        metafields.push({
          ownerId: node.id,
          namespace: "custom",
          key: "express_available",
          type: "boolean",
          value: "false",
        });
      }
      if (row.providerKey) {
        stamped.push({
          providerKey: row.providerKey,
          supplierVariantId: row.supplierVariantId,
          gtin: barcode,
          variantId: node.id,
          price: normalSell,
        });
      }
    }

    for (const gtin of gtinMap.keys()) {
      if (!nodes.some((n) => String(n.barcode ?? "").trim() === gtin)) variantsNoMatch += 1;
    }

    if (bulkVariants.length === 0) {
      productsDone += 1;
      continue;
    }

    if (!APPLY) {
      variantsPushed += bulkVariants.length;
      productsDone += 1;
      if (productsDone % PROGRESS_EVERY === 0) {
        console.log(`  [dry] ${productsDone} products, would push ${variantsPushed} variants`);
      }
      continue;
    }

    try {
      const upd = await shopifyGraphQL<{
        productVariantsBulkUpdate: { userErrors: Array<{ message: string }> };
      }>(BULK_UPDATE, { productId: productGid, variants: bulkVariants });
      const ue = [
        ...(upd.errors ?? []).map((e) => e.message),
        ...(upd.data?.productVariantsBulkUpdate?.userErrors ?? []).map((e) => e.message),
      ];
      if (ue.length) throw new Error(ue.join("; "));
    } catch (err) {
      productErrors += 1;
      console.error(`  product ${productGid} bulk update failed:`, err instanceof Error ? err.message : err);
      continue;
    }

    // Express metafields (best-effort; chunk to Shopify's 25-per-call limit).
    for (let i = 0; i < metafields.length; i += 25) {
      const chunk = metafields.slice(i, i + 25);
      try {
        await shopifyGraphQL(METAFIELDS_SET, { metafields: chunk });
      } catch (err) {
        console.error(`  product ${productGid} metafields chunk failed:`, err instanceof Error ? err.message : err);
      }
    }

    // Stamp ChannelListingState so the worker treats these as fresh.
    const cls = (prisma as any).channelListingState;
    if (cls?.upsert) {
      const now = new Date();
      for (const s of stamped) {
        try {
          await cls.upsert({
            where: { channel_providerKey: { channel: "SHOPIFY", providerKey: s.providerKey } },
            create: {
              channel: "SHOPIFY",
              providerKey: s.providerKey,
              supplierVariantId: s.supplierVariantId,
              gtin: s.gtin,
              externalVariantId: s.variantId,
              externalProductId: productGid,
              lastPushedPrice: s.price,
              lastSyncedAt: now,
              lastError: null,
            },
            update: {
              supplierVariantId: s.supplierVariantId,
              gtin: s.gtin,
              externalVariantId: s.variantId,
              externalProductId: productGid,
              lastPushedPrice: s.price,
              lastSyncedAt: now,
              lastError: null,
            },
          });
        } catch {
          /* best-effort bookkeeping */
        }
      }
    }

    variantsPushed += bulkVariants.length;
    productsDone += 1;
    if (productsDone % PROGRESS_EVERY === 0) {
      console.log(
        `  ${productsDone}/${byProduct.size} products | pushed ${variantsPushed} variants | unchanged ${variantsUnchanged} | errors ${productErrors}`
      );
    }
  }

  console.log(
    `\nRESUME shard ${SHARD}/${SHARDS}: products=${productsDone} pushedVariants=${variantsPushed} unchanged=${variantsUnchanged} locked=${variantsLocked} adminOnly=${variantsAdminOnly} ceiling=${variantsCeiling} noMatch=${variantsNoMatch} productErrors=${productErrors}`
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
