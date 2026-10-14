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
 * Modes (API budget: every product read costs ~50-300 points of a 100 pts/s bucket):
 *   default        DB diff first: only sizes whose formula price differs from
 *                  `ChannelListingState.lastPushedPrice` are read + pushed.
 *   --verify-bulk  Full verification: one bulk export of every variant, compared
 *                  locally (catches prices/express overwritten outside this
 *                  script); only real diffs are pushed, no per-product reads.
 *   --full-read    Legacy: read every product of the shard (no DB diff).
 *
 * Dry-run by default.
 *   npx tsx scripts/reprice-shopify-fast.ts --limit=200
 *   npx tsx scripts/reprice-shopify-fast.ts --apply
 *   npx tsx scripts/reprice-shopify-fast.ts --apply --verify-bulk
 */
import "dotenv/config";

import { prisma } from "@/app/lib/prisma";
import { formatShopifyApiMetricsLine, shopifyGraphQL } from "@/lib/shopifyAdmin";
import {
  exportVariantSnapshot,
  groupSnapshotByProduct,
  type SnapshotVariantNode,
} from "@/shopify/bulk/variantSnapshot";
import { computeStxSellPrices, pickShopifyVariantBySize } from "@/shopify/stx/syncShopifyStxPrices";
import { isAdminOnlyShopifyVariant } from "@/shopify/protection/adminOnlyProducts";
import { cleanGtin } from "@/shopify/restock/gtinNormalize";

/** Zero-padding-tolerant GTIN key (UPC-A vs EAN-13 vs GTIN-14). */
function gtinKey(value: string | null | undefined): string {
  return cleanGtin(String(value ?? "")).replace(/^0+/, "");
}

function num(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const APPLY = process.argv.includes("--apply");
const ONLY_UNPRICED = process.argv.includes("--only-unpriced");
const LIMIT = num("limit", 1000);
const SHARDS = Math.max(1, Math.floor(num("shards", 1)));
const SHARD = Math.min(SHARDS - 1, Math.floor(num("shard", 0)));
const SKIP_FRESH_HOURS = num("skip-fresh-hours", 24);
const MAX_PRICE = num("max-price", 5000);
const PROGRESS_EVERY = Math.max(1, Math.floor(num("progress-every", 200)));
/**
 * Only sizes whose DB row changed after the last Shopify write AND whose formula
 * price differs from that write. Newest changes first, capped by --max-products.
 */
const ONLY_DRIFTED = process.argv.includes("--only-drifted");
const MAX_PRODUCTS = Math.max(1, Math.floor(num("max-products", 1_000_000)));
const DRIFT_WINDOW_HOURS = Math.max(1, num("drift-window-hours", 12));
const VERIFY_BULK = process.argv.includes("--verify-bulk");
const FULL_READ = process.argv.includes("--full-read");
const MODE = VERIFY_BULK ? "verify-bulk" : FULL_READ ? "full-read" : ONLY_DRIFTED ? "drift" : "db-diff";

const VARIANTS_QUERY = /* GraphQL */ `
query FastRepriceProduct($id: ID!, $first: Int!) {
  product(id: $id) {
    id
    variants(first: $first) {
      pageInfo { hasNextPage }
      nodes {
        id
        title
        barcode
        price
        priceLocked: metafield(namespace: "custom", key: "price_locked") { value }
        usSize: metafield(namespace: "custom", key: "us_size") { value }
        expressPrice: metafield(namespace: "custom", key: "express_price") { value }
      }
    }
  }
}`;

function liveExpressAmount(raw: string | null | undefined): number | null {
  if (!raw) return null;
  try {
    const n = Number((JSON.parse(raw) as { amount?: string }).amount);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

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
  ean: string | null;
  sizeEu: string | null;
  sizeUs: string | null;
  sizeRaw: string | null;
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

type StampRow = {
  providerKey: string;
  supplierVariantId: string;
  gtin: string;
  variantId: string;
  price: number;
};

async function stampListingState(rows: StampRow[], productGid: string): Promise<void> {
  const cls = (prisma as any).channelListingState;
  if (!cls?.upsert || rows.length === 0) return;
  const now = new Date();
  for (const s of rows) {
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

function isPriceDrifted(r: Row): boolean {
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
  if (normalSell == null) return false;
  return r.lastPushedPrice == null || Math.abs(r.lastPushedPrice - normalSell) >= 0.005;
}

function truthy(v: string | null | undefined): boolean {
  return String(v ?? "").trim().toLowerCase() === "true";
}

async function main() {
  console.log(
    `${APPLY ? "APPLY" : "DRY-RUN"} | mode=${MODE} | shard ${SHARD}/${SHARDS} | skip-fresh=${VERIFY_BULK ? 0 : SKIP_FRESH_HOURS}h | only-unpriced=${ONLY_UNPRICED} | only-drifted=${ONLY_DRIFTED} | max-price=${MAX_PRICE} | limit=${LIMIT}`
  );
  const startedAt = Date.now();

  const shardClause =
    SHARDS > 1
      ? `AND (abs(hashtextextended(sss."shopifyProductId", 0)) % ${SHARDS}) = ${SHARD}`
      : "";
  const skipFreshClause = SKIP_FRESH_HOURS && !VERIFY_BULK
    ? `AND (cls."lastSyncedAt" IS NULL OR cls."lastSyncedAt" < NOW() - INTERVAL '${Math.round(SKIP_FRESH_HOURS)} hours')`
    : "";
  const onlyUnpricedClause = ONLY_UNPRICED ? `AND cls."lastPushedPrice" IS NULL` : "";
  // Window keeps the drift scan on the SupplierVariant.updatedAt index; older drift is
  // covered by the full shard passes (~7.5h cycle).
  const onlyDriftedClause = ONLY_DRIFTED
    ? `AND sv."updatedAt" > NOW() - INTERVAL '${Math.round(DRIFT_WINDOW_HOURS)} hours'
       AND (cls."lastSyncedAt" IS NULL OR sv."updatedAt" > cls."lastSyncedAt")`
    : "";
  const orderBy = ONLY_DRIFTED ? `sv."updatedAt" DESC` : `sss."shopifyProductId"`;

  // Pooled 2min statement_timeout cancels the catalogue join when the DB is busy.
  const rows = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '300s'`);
      return tx.$queryRawUnsafe<Row[]>(`
    SELECT sv."supplierVariantId",
           sv."providerKey",
           sv."gtin",
           kv."ean" AS "ean",
           kv."sizeEu" AS "sizeEu",
           kv."sizeUs" AS "sizeUs",
           sv."sizeRaw" AS "sizeRaw",
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
      ${onlyUnpricedClause}
      ${onlyDriftedClause}
    ORDER BY ${orderBy}
    LIMIT ${Math.max(1, Math.floor(LIMIT))}
  `);
    },
    { timeout: 330_000, maxWait: 30_000 }
  );
  // Sizes whose formula price equals our last push are skipped without a Shopify
  // read; external overwrites of those are caught by the --verify-bulk pass.
  const dbDiff = MODE === "db-diff" || MODE === "drift";
  const loaded = dbDiff ? rows.filter(isPriceDrifted) : rows;
  const neverPushed = loaded.filter((r) => r.lastPushedPrice == null).length;

  // Group rows by Shopify product. Barcode map for primary match; full list for
  // size-EU fallback when Shopify has the size but an empty/wrong barcode.
  const byProduct = new Map<string, { byBarcode: Map<string, Row>; rows: Row[] }>();
  const seenSv = new Set<string>();
  for (const r of loaded) {
    if (seenSv.has(r.supplierVariantId)) continue;
    seenSv.add(r.supplierVariantId);
    const pid = String(r.shopifyProductId);
    let bucket = byProduct.get(pid);
    if (!bucket) {
      if (byProduct.size >= MAX_PRODUCTS) continue;
      bucket = { byBarcode: new Map(), rows: [] };
      byProduct.set(pid, bucket);
    }
    bucket.rows.push(r);
    for (const k of [gtinKey(r.gtin), gtinKey(r.ean)].filter(Boolean)) {
      bucket.byBarcode.set(k, r);
    }
  }

  console.log(
    `Rows: ${rows.length}${dbDiff ? ` | drifted: ${loaded.length} (never pushed: ${neverPushed})` : ""} | products: ${byProduct.size}`
  );
  if (byProduct.size === 0) {
    console.log(formatShopifyApiMetricsLine(`SHOPIFY_API][${MODE}`));
    return;
  }

  let snapshotNodes: Map<string, SnapshotVariantNode[]> | null = null;
  if (VERIFY_BULK) {
    const t0 = Date.now();
    const snapshot = await exportVariantSnapshot({ metafieldKeys: ["price_locked", "us_size", "express_price"] });
    snapshotNodes = groupSnapshotByProduct(snapshot);
    console.log(
      `Bulk snapshot: variants=${snapshot.size} products=${snapshotNodes.size} in ${Math.round((Date.now() - t0) / 1000)}s`
    );
    snapshot.clear();
  }
  let productsMissingInSnapshot = 0;
  let verifiedStampSkipped = 0;

  let productsDone = 0;
  let variantsPushed = 0;
  let variantsUnchanged = 0;
  let variantsLocked = 0;
  let variantsNoMatch = 0;
  let variantsMatchedBySize = 0;
  let variantsCeiling = 0;
  let variantsAdminOnly = 0;
  let productErrors = 0;

  for (const [rawProductId, bucket] of byProduct) {
    const productGid = toProductGid(rawProductId);
    let productData: {
      product: {
        id: string;
        variants: {
          pageInfo: { hasNextPage: boolean };
          nodes: Array<{
            id: string;
            title: string | null;
            barcode: string | null;
            price: string | null;
            priceLocked: { value: string | null } | null;
            usSize: { value: string | null } | null;
            expressPrice: { value: string | null } | null;
          }>;
        };
      } | null;
    };
    if (snapshotNodes) {
      const fromSnapshot = snapshotNodes.get(productGid);
      if (!fromSnapshot) {
        productsMissingInSnapshot += 1;
        continue;
      }
      productData = { product: { id: productGid, variants: { pageInfo: { hasNextPage: false }, nodes: fromSnapshot } } };
    } else {
      try {
        // Shopify throttles on *requested* cost (scales with `first`); most
        // products have < 40 sizes, so ask small and refetch only when truncated.
        let res = await shopifyGraphQL<typeof productData>(VARIANTS_QUERY, {
          id: productGid,
          first: 80,
        });
        if (res.errors?.length) throw new Error(res.errors.map((e) => e.message).join("; "));
        if (res.data?.product?.variants?.pageInfo?.hasNextPage) {
          res = await shopifyGraphQL<typeof productData>(VARIANTS_QUERY, {
            id: productGid,
            first: 250,
          });
          if (res.errors?.length) throw new Error(res.errors.map((e) => e.message).join("; "));
        }
        productData = res.data;
      } catch (err) {
        productErrors += 1;
        console.error(`  product ${productGid} query failed:`, err instanceof Error ? err.message : err);
        continue;
      }
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
    const stamped: StampRow[] = [];
    // Live price already correct: stamp too, so a restarted pass (deploy) skips
    // them via --skip-fresh-hours instead of re-walking from zero.
    const verified: StampRow[] = [];
    const matchedSv = new Set<string>();
    const claimedVariantIds = new Set<string>();

    // Pass 1: barcode match (preferred when present and unique).
    const pairings: Array<{ row: Row; node: (typeof nodes)[number]; via: "barcode" | "size" }> = [];
    for (const node of nodes) {
      const barcode = gtinKey(node.barcode);
      if (!barcode) continue;
      const row = bucket.byBarcode.get(barcode);
      if (!row) continue;
      if (matchedSv.has(row.supplierVariantId)) continue;
      matchedSv.add(row.supplierVariantId);
      claimedVariantIds.add(node.id);
      pairings.push({ row, node, via: "barcode" });
    }

    // Pass 2: size EU/US fallback for leftover DB rows (empty/wrong Shopify barcode).
    const unmatchedRows = bucket.rows.filter((r) => !matchedSv.has(r.supplierVariantId));
    const freeNodes = nodes.filter((n) => !claimedVariantIds.has(n.id));
    for (const row of unmatchedRows) {
      const sizeEu = row.sizeEu ?? row.sizeRaw;
      const hit = pickShopifyVariantBySize(freeNodes, sizeEu, row.sizeUs);
      if (!hit) continue;
      matchedSv.add(row.supplierVariantId);
      claimedVariantIds.add(hit.id);
      // Remove claimed node from free pool for subsequent size matches.
      const idx = freeNodes.findIndex((n) => n.id === hit.id);
      if (idx >= 0) freeNodes.splice(idx, 1);
      pairings.push({ row, node: hit, via: "size" });
      variantsMatchedBySize += 1;
    }

    for (const { row, node, via } of pairings) {
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
      // Compare against the live Shopify price, not our last push: another writer
      // (legacy SSE consumer) may have overwritten it since.
      const livePrice = node.price != null ? Number(node.price) : null;
      const liveExpress = liveExpressAmount(node.expressPrice?.value);
      const expressCurrent =
        expressSell == null || (liveExpress != null && Math.abs(liveExpress - expressSell) < 0.005);
      if (
        livePrice != null &&
        Number.isFinite(livePrice) &&
        Math.abs(livePrice - normalSell) < 0.005 &&
        expressCurrent
      ) {
        variantsUnchanged += 1;
        // Bulk verify walks the whole catalogue: only rewrite rows whose DB view is stale.
        const dbAlreadyCurrent =
          row.lastPushedPrice != null && Math.abs(row.lastPushedPrice - normalSell) < 0.005;
        if (VERIFY_BULK && dbAlreadyCurrent) {
          verifiedStampSkipped += 1;
        } else if (row.providerKey) {
          verified.push({
            providerKey: row.providerKey,
            supplierVariantId: row.supplierVariantId,
            gtin: String(row.gtin ?? ""),
            variantId: node.id,
            price: normalSell,
          });
        }
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
          gtin: String(row.gtin ?? ""),
          variantId: node.id,
          price: normalSell,
        });
      }
      void via; // counted above for size; barcode is default
    }

    for (const r of bucket.rows) if (!matchedSv.has(r.supplierVariantId)) variantsNoMatch += 1;

    if (APPLY) await stampListingState(verified, productGid);

    if (bulkVariants.length === 0) {
      productsDone += 1;
      continue;
    }

    if (!APPLY) {
      variantsPushed += bulkVariants.length;
      productsDone += 1;
      if (productsDone % PROGRESS_EVERY === 0) {
        console.log(
          `  [dry] ${productsDone} products, would push ${variantsPushed} variants (size-fallback ${variantsMatchedBySize})`
        );
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

    for (let i = 0; i < metafields.length; i += 25) {
      const chunk = metafields.slice(i, i + 25);
      try {
        await shopifyGraphQL(METAFIELDS_SET, { metafields: chunk });
      } catch (err) {
        console.error(
          `  product ${productGid} metafields chunk failed:`,
          err instanceof Error ? err.message : err
        );
      }
    }

    await stampListingState(stamped, productGid);

    variantsPushed += bulkVariants.length;
    productsDone += 1;
    if (productsDone % PROGRESS_EVERY === 0) {
      console.log(
        `  ${productsDone}/${byProduct.size} products | pushed ${variantsPushed} variants | size-fallback ${variantsMatchedBySize} | unchanged ${variantsUnchanged} | errors ${productErrors}`
      );
    }
  }

  console.log(
    `\nRESUME shard ${SHARD}/${SHARDS}: products=${productsDone} pushedVariants=${variantsPushed} matchedBySize=${variantsMatchedBySize} unchanged=${variantsUnchanged} locked=${variantsLocked} adminOnly=${variantsAdminOnly} ceiling=${variantsCeiling} noMatch=${variantsNoMatch} productErrors=${productErrors}${
      VERIFY_BULK ? ` missingInSnapshot=${productsMissingInSnapshot} verifiedStampSkipped=${verifiedStampSkipped}` : ""
    } mode=${MODE} durationSec=${Math.round((Date.now() - startedAt) / 1000)}`
  );
  console.log(formatShopifyApiMetricsLine(`SHOPIFY_API][${MODE}`));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
