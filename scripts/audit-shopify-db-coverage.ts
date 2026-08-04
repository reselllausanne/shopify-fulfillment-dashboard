/**
 * Cross-audit: live Shopify catalog vs KickDB buffer / ShopifySyncState / STX rows.
 *
 * Answers:
 * - How many Shopify products/variants are NOT reachable by SSE → main_from_db (handle/slug gap)
 * - How many DB-tracked products are missing on Shopify (and vice versa)
 * - Variant-level price_locked blocks
 *
 * Usage:
 *   npx tsx scripts/audit-shopify-db-coverage.ts
 *   npx tsx scripts/audit-shopify-db-coverage.ts --json
 *   npx tsx scripts/audit-shopify-db-coverage.ts --sample 20
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../app/lib/prisma";
import { shopifyGraphQL } from "../lib/shopifyAdmin";

type ShopifyVariantRow = {
  id: string;
  barcode: string | null;
  sku: string | null;
  price: string | null;
  priceLocked: boolean;
};

type ShopifyProductRow = {
  id: string;
  handle: string;
  status: string;
  publishedAt: string | null;
  variants: ShopifyVariantRow[];
};

const CACHE_PATH = path.join(process.cwd(), "artifacts/shopify-catalog-audit-cache.json");

function loadShopifyCache(): ShopifyProductRow[] | null {
  try {
    if (!process.argv.includes("--from-cache")) return null;
    const raw = fs.readFileSync(CACHE_PATH, "utf8");
    return JSON.parse(raw) as ShopifyProductRow[];
  } catch {
    return null;
  }
}

function saveShopifyCache(products: ShopifyProductRow[]) {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(products));
}

const PRODUCTS_QUERY = /* GraphQL */ `
query AuditProducts($cursor: String) {
  products(first: 100, after: $cursor) {
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      id
      handle
      status
      publishedAt
      variants(first: 100) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          barcode
          sku
          price
          priceLocked: metafield(namespace: "custom", key: "price_locked") {
            value
          }
        }
      }
    }
  }
}
`;

const VARIANTS_PAGE_QUERY = /* GraphQL */ `
query AuditProductVariants($id: ID!, $cursor: String) {
  product(id: $id) {
    variants(first: 100, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        barcode
        sku
        price
        priceLocked: metafield(namespace: "custom", key: "price_locked") {
          value
        }
      }
    }
  }
}
`;

function normHandle(h: string | null | undefined): string {
  return String(h ?? "")
    .trim()
    .toLowerCase();
}

function isPriceLocked(value: string | null | undefined): boolean {
  return String(value ?? "").toLowerCase() === "true";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function shopifyGqlWithRetry<T>(
  query: string,
  variables: Record<string, unknown>,
  attempt = 0
): Promise<{ data: T; errors?: Array<{ message: string }> }> {
  const res = await shopifyGraphQL<T>(query, variables);
  const throttled = (res.errors ?? []).some((e) => /thrott/i.test(e.message));
  if (throttled && attempt < 8) {
    const waitMs = Math.min(30_000, 2000 * 2 ** attempt);
    process.stderr.write(`[shopify] throttled — wait ${waitMs}ms (attempt ${attempt + 1})\n`);
    await sleep(waitMs);
    return shopifyGqlWithRetry(query, variables, attempt + 1);
  }
  return res;
}

async function fetchAllShopifyProducts(): Promise<ShopifyProductRow[]> {
  const out: ShopifyProductRow[] = [];
  let cursor: string | null = null;
  let page = 0;

  while (true) {
    page += 1;
    const { data, errors } = await shopifyGqlWithRetry<{
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{
          id: string;
          handle: string;
          status: string;
          publishedAt: string | null;
          variants: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: Array<{
              id: string;
              barcode: string | null;
              sku: string | null;
              price: string | null;
              priceLocked: { value: string | null } | null;
            }>;
          };
        }>;
      };
    }>(PRODUCTS_QUERY, { cursor });

    if (errors?.length) {
      throw new Error(errors.map((e) => e.message).join("; "));
    }

    const batch = data?.products?.nodes ?? [];
    for (const p of batch) {
      const variants: ShopifyVariantRow[] = (p.variants?.nodes ?? []).map((v) => ({
        id: v.id,
        barcode: v.barcode,
        sku: v.sku,
        price: v.price,
        priceLocked: isPriceLocked(v.priceLocked?.value),
      }));

      let vCursor = p.variants?.pageInfo?.hasNextPage ? p.variants.pageInfo.endCursor : null;
      while (vCursor) {
        const vp = await shopifyGqlWithRetry<{
          product: {
            variants: {
              pageInfo: { hasNextPage: boolean; endCursor: string | null };
              nodes: Array<{
                id: string;
                barcode: string | null;
                sku: string | null;
                price: string | null;
                priceLocked: { value: string | null } | null;
              }>;
            };
          } | null;
        }>(VARIANTS_PAGE_QUERY, { id: p.id, cursor: vCursor });
        if (vp.errors?.length) break;
        const extra = vp.data?.product?.variants?.nodes ?? [];
        variants.push(
          ...extra.map((v) => ({
            id: v.id,
            barcode: v.barcode,
            sku: v.sku,
            price: v.price,
            priceLocked: isPriceLocked(v.priceLocked?.value),
          }))
        );
        vCursor = vp.data?.product?.variants?.pageInfo?.hasNextPage
          ? vp.data.product.variants.pageInfo.endCursor
          : null;
      }

      out.push({
        id: p.id,
        handle: p.handle,
        status: p.status,
        publishedAt: p.publishedAt,
        variants,
      });
    }

    process.stderr.write(`[shopify] page ${page}: +${batch.length} products (total ${out.length})\n`);
    await sleep(650);

    if (!data?.products?.pageInfo?.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor;
  }

  return out;
}

async function main() {
  const asJson = process.argv.includes("--json");
  const sampleN = (() => {
    const i = process.argv.indexOf("--sample");
    if (i === -1) return 0;
    return Math.max(0, Number.parseInt(process.argv[i + 1] ?? "0", 10) || 0);
  })();

  const cached = loadShopifyCache();
  const shopifyProducts = cached ?? (await fetchAllShopifyProducts());
  if (!cached) saveShopifyCache(shopifyProducts);
  if (cached) process.stderr.write(`[shopify] loaded ${cached.length} products from cache\n`);

  const [kickdbMeta, syncStates, stxGtins, mirrorGtins] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        total: bigint;
        withRaw: bigint;
        notFound: bigint;
        withUrlKey: bigint;
      }>
    >`
      SELECT
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (WHERE "rawJson" IS NOT NULL)::bigint AS "withRaw",
        COUNT(*) FILTER (WHERE "notFound" = true)::bigint AS "notFound",
        COUNT(*) FILTER (WHERE "urlKey" IS NOT NULL AND length(trim("urlKey")) > 0)::bigint AS "withUrlKey"
      FROM "public"."KickDBProduct"
    `,
    prisma.shopifySyncState.findMany({
      select: {
        kickdbProductId: true,
        shopifyProductId: true,
        shopifyHandle: true,
        syncStatus: true,
        shopifySyncedAt: true,
        lastError: true,
      },
    }),
    prisma.supplierVariant.findMany({
      where: { supplierVariantId: { startsWith: "stx_" }, gtin: { not: null } },
      select: { gtin: true, supplierVariantId: true },
    }),
    prisma.$queryRaw<Array<{ gtin: string }>>`
      SELECT DISTINCT trim("gtin") AS gtin
      FROM "public"."ShopifyVariantLocationStock"
      WHERE "gtin" IS NOT NULL AND length(trim("gtin")) > 0
    `,
  ]);

  const kickdbHandles = await prisma.$queryRaw<
    Array<{ kickdbProductId: string; urlKey: string | null; hasRaw: boolean }>
  >`
    SELECT
      "kickdbProductId",
      "urlKey",
      ("rawJson" IS NOT NULL) AS "hasRaw"
    FROM "public"."KickDBProduct"
  `;

  const kickdbProducts = kickdbHandles.map((p) => ({
    kickdbProductId: p.kickdbProductId,
    urlKey: p.urlKey,
    rawJson: p.hasRaw ? true : null,
    notFound: false,
  }));

  const kickdbStats = kickdbMeta[0] ?? {
    total: 0n,
    withRaw: 0n,
    notFound: 0n,
    withUrlKey: 0n,
  };
  const kickdbByHandle = new Map<string, (typeof kickdbProducts)[0]>();
  const kickdbById = new Map<string, (typeof kickdbProducts)[0]>();
  for (const p of kickdbProducts) {
    kickdbById.set(p.kickdbProductId, p);
    const h = normHandle(p.urlKey);
    if (h && !kickdbByHandle.has(h)) kickdbByHandle.set(h, p);
  }

  const syncByKickdbId = new Map(syncStates.map((s) => [s.kickdbProductId, s]));
  const syncByHandle = new Map<string, (typeof syncStates)[0]>();
  for (const s of syncStates) {
    const h = normHandle(s.shopifyHandle);
    if (h && !syncByHandle.has(h)) syncByHandle.set(h, s);
  }

  const shopifyByHandle = new Map<string, ShopifyProductRow>();
  for (const p of shopifyProducts) {
    shopifyByHandle.set(normHandle(p.handle), p);
  }

  const shopifyGtins = new Set<string>();
  let shopifyVariantTotal = 0;
  let shopifyVariantsLocked = 0;
  let shopifyVariantsWithBarcode = 0;
  let shopifyActiveProducts = 0;
  let shopifyPublishedProducts = 0;

  type ProductBucket =
    | "sse_ok"
    | "shopify_orphan_no_kickdb"
    | "kickdb_handle_missing_raw"
    | "sync_state_missing"
    | "sync_not_synced"
    | "sync_error_or_blocked"
    | "handle_mismatch"
    | "archived_or_draft";

  const productBuckets: Record<ProductBucket, string[]> = {
    sse_ok: [],
    shopify_orphan_no_kickdb: [],
    kickdb_handle_missing_raw: [],
    sync_state_missing: [],
    sync_not_synced: [],
    sync_error_or_blocked: [],
    handle_mismatch: [],
    archived_or_draft: [],
  };

  for (const sp of shopifyProducts) {
    const handle = normHandle(sp.handle);
    const isActive = sp.status === "ACTIVE";
    if (isActive) shopifyActiveProducts += 1;
    if (sp.publishedAt) shopifyPublishedProducts += 1;

    for (const v of sp.variants) {
      shopifyVariantTotal += 1;
      if (v.priceLocked) shopifyVariantsLocked += 1;
      const bc = String(v.barcode ?? "").trim();
      if (bc) shopifyGtins.add(bc);
      if (bc) shopifyVariantsWithBarcode += 1;
    }

    if (!isActive) {
      productBuckets.archived_or_draft.push(sp.handle);
      continue;
    }

    const kd = kickdbByHandle.get(handle);
    if (!kd) {
      productBuckets.shopify_orphan_no_kickdb.push(sp.handle);
      continue;
    }

    if (!kd.rawJson) {
      productBuckets.kickdb_handle_missing_raw.push(sp.handle);
      continue;
    }

    const sync = syncByKickdbId.get(kd.kickdbProductId);
    if (!sync) {
      productBuckets.sync_state_missing.push(sp.handle);
      continue;
    }

    const syncHandle = normHandle(sync.shopifyHandle);
    if (syncHandle && syncHandle !== handle) {
      productBuckets.handle_mismatch.push(`${sp.handle} (sync=${sync.shopifyHandle})`);
      continue;
    }

    if (sync.syncStatus === "synced") {
      productBuckets.sse_ok.push(sp.handle);
      continue;
    }

    if (
      sync.syncStatus === "error" ||
      sync.syncStatus === "blocked_no_images" ||
      sync.syncStatus === "create_candidate"
    ) {
      productBuckets.sync_error_or_blocked.push(`${sp.handle}:${sync.syncStatus}`);
      continue;
    }

    productBuckets.sync_not_synced.push(`${sp.handle}:${sync.syncStatus}`);
  }

  // DB products not on Shopify (by handle)
  const dbNotOnShopify: Array<{
    urlKey: string;
    syncStatus: string;
    reason: string;
  }> = [];

  for (const kd of kickdbProducts) {
    const handle = normHandle(kd.urlKey);
    if (!handle) {
      dbNotOnShopify.push({
        urlKey: kd.urlKey ?? "(null)",
        syncStatus: syncByKickdbId.get(kd.kickdbProductId)?.syncStatus ?? "no_sync_row",
        reason: "missing_urlKey",
      });
      continue;
    }
    const onShopify = shopifyByHandle.get(handle);
    if (!onShopify) {
      const sync = syncByKickdbId.get(kd.kickdbProductId);
      dbNotOnShopify.push({
        urlKey: kd.urlKey!,
        syncStatus: sync?.syncStatus ?? "no_sync_row",
        reason: sync?.syncStatus === "synced" ? "ghost_sync_marked_synced" : "never_on_shopify",
      });
    }
  }

  const stxGtinSet = new Set(
    stxGtins.map((r) => String(r.gtin ?? "").trim()).filter(Boolean)
  );
  const mirrorGtinSet = new Set(mirrorGtins.map((r) => String(r.gtin).trim()).filter(Boolean));

  const stxNotOnShopify = [...stxGtinSet].filter((g) => !shopifyGtins.has(g));
  const shopifyBarcodeNotInStx = [...shopifyGtins].filter((g) => !stxGtinSet.has(g));

  const sseGapProducts =
    productBuckets.shopify_orphan_no_kickdb.length +
    productBuckets.kickdb_handle_missing_raw.length +
    productBuckets.sync_state_missing.length +
    productBuckets.sync_not_synced.length +
    productBuckets.sync_error_or_blocked.length +
    productBuckets.handle_mismatch.length +
    productBuckets.archived_or_draft.length;

  const sseGapVariantsEstimate = shopifyProducts
    .filter((p) => {
      const handle = normHandle(p.handle);
      if (p.status !== "ACTIVE") return true;
      const kd = kickdbByHandle.get(handle);
      if (!kd?.rawJson) return true;
      const sync = syncByKickdbId.get(kd.kickdbProductId);
      if (!sync || sync.syncStatus !== "synced") return true;
      if (sync.shopifyHandle && normHandle(sync.shopifyHandle) !== handle) return true;
      return false;
    })
    .reduce((n, p) => n + p.variants.length, 0);

  const sseOkVariants = shopifyProducts
    .filter((p) => productBuckets.sse_ok.includes(p.handle))
    .reduce((n, p) => n + p.variants.length, 0);

  const sseOkVariantsUnlocked = shopifyProducts
    .filter((p) => productBuckets.sse_ok.includes(p.handle))
    .reduce((n, p) => n + p.variants.filter((v) => !v.priceLocked).length, 0);

  const syncStatusCounts: Record<string, number> = {};
  for (const s of syncStates) {
    syncStatusCounts[s.syncStatus] = (syncStatusCounts[s.syncStatus] ?? 0) + 1;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    shopify: {
      productsTotal: shopifyProducts.length,
      productsActive: shopifyActiveProducts,
      productsPublished: shopifyPublishedProducts,
      variantsTotal: shopifyVariantTotal,
      variantsWithBarcode: shopifyVariantsWithBarcode,
      variantsPriceLocked: shopifyVariantsLocked,
      distinctGtins: shopifyGtins.size,
    },
    db: {
      kickdbProducts: Number(kickdbStats.total),
      kickdbWithRawJson: Number(kickdbStats.withRaw),
      kickdbNotFound: Number(kickdbStats.notFound),
      kickdbWithUrlKey: Number(kickdbStats.withUrlKey),
      shopifySyncStateRows: syncStates.length,
      syncStatusCounts,
      stxVariantsWithGtin: stxGtinSet.size,
      mirrorDistinctGtins: mirrorGtinSet.size,
    },
    ssePipeline: {
      /** ACTIVE Shopify products fully wired: KickDB urlKey + rawJson + syncStatus=synced + handle match */
      productsSseOk: productBuckets.sse_ok.length,
      productsSseGap: sseGapProducts,
      variantsOnSseOkProducts: sseOkVariants,
      variantsOnSseOkProductsUnlocked: sseOkVariantsUnlocked,
      variantsOnSseGapProducts: sseGapVariantsEstimate,
      variantsPriceLockedOnSseOk: sseOkVariants - sseOkVariantsUnlocked,
      productBuckets: Object.fromEntries(
        Object.entries(productBuckets).map(([k, v]) => [k, v.length])
      ),
    },
    crossGap: {
      shopifyActiveNotSseOk: sseGapProducts - productBuckets.archived_or_draft.length,
      dbKickdbNotOnShopify: dbNotOnShopify.length,
      dbKickdbNotOnShopifyMarkedSynced: dbNotOnShopify.filter((r) => r.reason === "ghost_sync_marked_synced")
        .length,
      stxGtinNotOnShopify: stxNotOnShopify.length,
      shopifyGtinNotInStx: shopifyBarcodeNotInStx.length,
    },
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("=== Shopify ↔ DB coverage audit ===\n");
    console.log("SHOPIFY LIVE");
    console.log(`  products: ${report.shopify.productsTotal} (${report.shopify.productsActive} ACTIVE)`);
    console.log(`  variants: ${report.shopify.variantsTotal} (${report.shopify.variantsWithBarcode} w/ barcode)`);
    console.log(`  price_locked variants: ${report.shopify.variantsPriceLocked}`);
    console.log("");
    console.log("DB BUFFER");
    console.log(`  KickDBProduct: ${report.db.kickdbProducts} (${report.db.kickdbWithRawJson} w/ rawJson)`);
    console.log(`  ShopifySyncState: ${report.db.shopifySyncStateRows}`, report.db.syncStatusCounts);
    console.log(`  STX SupplierVariant (gtin): ${report.db.stxVariantsWithGtin}`);
    console.log(`  Mirror physical gtins: ${report.db.mirrorDistinctGtins}`);
    console.log("");
    console.log("SSE → main_from_db (slug/handle path)");
    console.log(`  ✅ wired (synced + rawJson + handle match): ${report.ssePipeline.productsSseOk} products`);
    console.log(`     → ${report.ssePipeline.variantsOnSseOkProducts} variants (${report.ssePipeline.variantsOnSseOkProductsUnlocked} unlocked)`);
    console.log(`  ❌ gap (won't reliably reprice on SSE): ${report.ssePipeline.productsSseGap} products`);
    console.log(`     → ~${report.ssePipeline.variantsOnSseGapProducts} variants`);
    console.log("  gap breakdown:", report.ssePipeline.productBuckets);
    console.log("");
    console.log("CROSS GAPS");
    console.log(`  KickDB in DB, NOT on Shopify: ${report.crossGap.dbKickdbNotOnShopify}`);
    console.log(`    (marked synced but missing): ${report.crossGap.dbKickdbNotOnShopifyMarkedSynced}`);
    console.log(`  Shopify ACTIVE not SSE-wired: ${report.crossGap.shopifyActiveNotSseOk}`);
    console.log(`  STX gtin in DB, not on Shopify barcode: ${report.crossGap.stxGtinNotOnShopify}`);
    console.log(`  Shopify barcode not in STX: ${report.crossGap.shopifyGtinNotInStx}`);
  }

  if (sampleN > 0) {
    const samples = {
      shopify_orphans: productBuckets.shopify_orphan_no_kickdb.slice(0, sampleN),
      missing_raw: productBuckets.kickdb_handle_missing_raw.slice(0, sampleN),
      sync_errors: productBuckets.sync_error_or_blocked.slice(0, sampleN),
      db_not_on_shopify: dbNotOnShopify.slice(0, sampleN),
      ghost_sync: dbNotOnShopify.filter((r) => r.reason === "ghost_sync_marked_synced").slice(0, sampleN),
    };
    const outPath = path.join(process.cwd(), "artifacts/shopify-db-coverage-samples.json");
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(samples, null, 2));
    if (!asJson) console.log(`\nSamples → ${outPath}`);
  }

  const fullPath = path.join(process.cwd(), "artifacts/shopify-db-coverage.json");
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(
    fullPath,
    JSON.stringify(
      {
        ...report,
        samples: {
          shopify_orphans: productBuckets.shopify_orphan_no_kickdb.slice(0, 100),
          db_not_on_shopify: dbNotOnShopify.slice(0, 100),
        },
      },
      null,
      2
    )
  );
  if (!asJson) console.log(`Full report → ${fullPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
