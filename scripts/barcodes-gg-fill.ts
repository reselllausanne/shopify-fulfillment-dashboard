/**
 * Fill missing barcodes via barcodes.gg — efficient, no double calls.
 *
 * Strategy:
 *  1. Free cross-fill CLS ↔ SV ↔ KickDB (0 API)
 *  2. One /product/details/{style} per distinct supplierSku (cached hits+misses)
 *  3. Stamp valid GTINs onto SupplierVariant (+ CLS); batch Shopify barcode writes per product
 *
 * Usage:
 *   npx tsx scripts/barcodes-gg-fill.ts --inventory
 *   npx tsx scripts/barcodes-gg-fill.ts --cross-fill [--apply]
 *   npx tsx scripts/barcodes-gg-fill.ts --fill --limit=200 [--apply] [--shopify]
 *   npx tsx scripts/barcodes-gg-fill.ts --fill --priority=listed_stock --limit=500 --apply --shopify
 *
 * Env: BARCODES_GG_API_KEY, DATABASE_URL, Shopify admin env for --shopify
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { isValidGtin } from "@/galaxus/exports/feedValidation";
import { classifySuggestedSellCategory } from "@/galaxus/pricing/suggestedSellPrice";
import { isLegoStxSlug } from "@/galaxus/stx/legoProduct";
import { fetchTokenUsage, lookupStyleDetails } from "@/lib/barcodesGg/client";
import { matchSizeToPicked, normalizeStyleCode } from "@/lib/barcodesGg/gtinPick";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { setVariantBarcode } from "@/shopify/restock/shopifyRestockInventory";

/** Catalogue STX: lego → clothing, then sneaker/listed pools. */
type Priority = "lego" | "clothing" | "listed_stock" | "listed" | "in_stock" | "all";

function argFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function argVal(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const APPLY = argFlag("apply");
const DO_SHOPIFY = argFlag("shopify");
const LIMIT = Math.max(1, Number(argVal("limit", "100")) || 100);
const PRIORITY = argVal("priority", "listed_stock") as Priority;
const SLEEP_MS = Math.max(0, Number(argVal("sleep-ms", "50")) || 50);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withDbRetry<T>(fn: () => Promise<T>, label: string, attempts = 6): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fn();
    } catch (e: any) {
      last = e;
      const msg = String(e?.message ?? e);
      const code = String(e?.code ?? "");
      const transient =
        /Can't reach database server|Server has closed the connection|Closed|P1001|P1017|Connection reset|ECONNRESET|ETIMEDOUT|timed out|timeout/i.test(
          msg
        ) || code === "P1001" || code === "P1017";
      if (!transient || i === attempts) throw e;
      const wait = Math.min(45_000, 1500 * 2 ** (i - 1));
      console.warn(`[db-retry] ${label} attempt ${i}/${attempts} wait ${wait}ms: ${msg.slice(0, 140)}`);
      try {
        await prisma.$disconnect();
      } catch {
        /* ignore */
      }
      await sleep(wait);
      try {
        await prisma.$connect();
      } catch {
        /* next attempt will retry */
      }
    }
  }
  throw last;
}

type MissingSkuRow = {
  supplierSku: string;
  variant_count: bigint;
  in_stock_count: bigint;
  listed: boolean;
};

async function inventory(): Promise<void> {
  const usage = await fetchTokenUsage().catch((e) => ({ error: String(e) }));
  console.log("[usage]", usage);

  const mirror = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(DISTINCT "shopifyVariantId")::bigint AS n
    FROM "ShopifyVariantLocationStock"
    WHERE gtin IS NULL OR btrim(gtin) = ''
  `;
  console.log("[mirror] variants missing gtin:", Number(mirror[0]?.n ?? 0));

  const clsMissing = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*)::bigint AS n
    FROM "ChannelListingState"
    WHERE channel = 'SHOPIFY'
      AND "externalVariantId" IS NOT NULL
      AND (gtin IS NULL OR btrim(gtin) = '')
  `;
  console.log("[cls] SHOPIFY listed missing gtin:", Number(clsMissing[0]?.n ?? 0));

  const cache = await prisma.$queryRaw<
    Array<{ status: string; n: bigint; debited: bigint }>
  >`
    SELECT status, COUNT(*)::bigint AS n,
           COUNT(*) FILTER (WHERE "requestDebited")::bigint AS debited
    FROM "BarcodesGgStyleCache"
    GROUP BY status
    ORDER BY status
  `.catch(() => [] as Array<{ status: string; n: bigint; debited: bigint }>);
  console.log("[cache]", cache);

  // Sample: CLS missing → SV (capped CTE avoids full-catalog join timeout)
  await prisma.$executeRawUnsafe(`SET statement_timeout = '120s'`);
  const sample = await prisma.$queryRaw<MissingSkuRow[]>`
    WITH missing_cls AS (
      SELECT cls."supplierVariantId"
      FROM "ChannelListingState" cls
      WHERE cls.channel = 'SHOPIFY'
        AND cls."externalVariantId" IS NOT NULL
        AND cls.gtin IS NULL
        AND cls."supplierVariantId" IS NOT NULL
      LIMIT 30000
    )
    SELECT sv."supplierSku" AS "supplierSku",
           COUNT(*)::bigint AS variant_count,
           COUNT(*) FILTER (WHERE sv.stock > 0)::bigint AS in_stock_count,
           TRUE AS listed
    FROM missing_cls m
    JOIN "SupplierVariant" sv ON sv."supplierVariantId" = m."supplierVariantId"
    WHERE sv.gtin IS NULL
      AND sv."supplierSku" IS NOT NULL
      AND btrim(sv."supplierSku") <> ''
    GROUP BY sv."supplierSku"
    ORDER BY COUNT(*) FILTER (WHERE sv.stock > 0) DESC, COUNT(*) DESC
    LIMIT 20
  `;
  console.log("[sample top listed-missing skus]", sample.slice(0, 10));
}

async function crossFill(): Promise<void> {
  // CLS ← SV via SQL update (indexed supplierVariantId) — capped
  if (APPLY) {
    const clsFromSv = await prisma.$executeRaw`
      UPDATE "ChannelListingState" cls
      SET gtin = sv.gtin, "updatedAt" = NOW()
      FROM "SupplierVariant" sv
      WHERE cls."supplierVariantId" = sv."supplierVariantId"
        AND cls.channel = 'SHOPIFY'
        AND cls.gtin IS NULL
        AND sv.gtin IS NOT NULL
        AND cls.id IN (
          SELECT cls2.id
          FROM "ChannelListingState" cls2
          JOIN "SupplierVariant" sv2 ON sv2."supplierVariantId" = cls2."supplierVariantId"
          WHERE cls2.channel = 'SHOPIFY'
            AND cls2.gtin IS NULL
            AND sv2.gtin IS NOT NULL
          LIMIT 5000
        )
    `;
    console.log(`[cross] CLS←SV rows touched:`, clsFromSv);
  } else {
    const n = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n
      FROM "ChannelListingState" cls
      JOIN "SupplierVariant" sv ON sv."supplierVariantId" = cls."supplierVariantId"
      WHERE cls.channel = 'SHOPIFY' AND cls.gtin IS NULL AND sv.gtin IS NOT NULL
      LIMIT 1
    `.catch(() => [{ n: 0n }]);
    console.log(`[cross] CLS←SV candidates (approx query):`, Number(n[0]?.n ?? 0));
  }

  // Mirror → SV (tiny set)
  const mirror = await prisma.$queryRaw<
    Array<{ supplierVariantId: string; gtin: string; providerKey: string | null }>
  >`
    SELECT DISTINCT ON (sv."supplierVariantId")
           sv."supplierVariantId", m.gtin, sv."providerKey"
    FROM "ShopifyVariantLocationStock" m
    JOIN "ChannelListingState" cls ON cls."externalVariantId" = m."shopifyVariantId" AND cls.channel = 'SHOPIFY'
    JOIN "SupplierVariant" sv ON sv."supplierVariantId" = cls."supplierVariantId"
    WHERE m.gtin IS NOT NULL AND btrim(m.gtin) <> ''
      AND sv.gtin IS NULL
    LIMIT 200
  `;
  console.log(`[cross] SV←mirror candidates: ${mirror.length}`);
  if (APPLY) {
    let n = 0;
    for (const row of mirror) {
      const stamped = String(row.gtin).replace(/\D/g, "");
      if (!isValidGtin(stamped) && !isValidGtin(stamped.padStart(13, "0"))) continue;
      const gtin = stamped.length === 12 ? `0${stamped}` : stamped;
      try {
        await prisma.supplierVariant.update({
          where: { supplierVariantId: row.supplierVariantId },
          data: {
            gtin,
            providerKey: row.providerKey?.startsWith("STX_") ? row.providerKey : `STX_${gtin}`,
          },
        });
        n += 1;
      } catch {
        /* unique conflict */
      }
    }
    console.log(`[cross] SV←mirror applied: ${n}`);
  }
}

/**
 * Catalogue buckets first (lego → clothing), then Shopify-listed / in_stock.
 * Skip styles already in BarcodesGgStyleCache (hits+misses) to avoid recycle.
 */
async function loadPrioritySkus(limit: number): Promise<string[]> {
  if (PRIORITY === "lego") {
    const rows = await prisma.$queryRaw<Array<{ supplierSku: string }>>`
      SELECT sv."supplierSku"
      FROM "SupplierVariant" sv
      LEFT JOIN "BarcodesGgStyleCache" c
        ON c."styleCode" = UPPER(TRIM(sv."supplierSku"))
      WHERE sv."supplierVariantId" LIKE 'stx_%'
        AND (sv.gtin IS NULL OR btrim(sv.gtin) = '')
        AND sv."supplierSku" IS NOT NULL
        AND btrim(sv."supplierSku") <> ''
        AND c."styleCode" IS NULL
        AND (
          lower(coalesce(sv."supplierBrand", '')) LIKE '%lego%'
          OR lower(coalesce(sv."supplierProductName", '')) LIKE '%lego%'
          OR lower(coalesce(sv."supplierSku", '')) LIKE '%lego%'
        )
      GROUP BY sv."supplierSku"
      ORDER BY SUM(GREATEST(sv.stock, 0)) DESC, COUNT(*) DESC
      LIMIT ${limit}
    `;
    return rows
      .map((r) => normalizeStyleCode(r.supplierSku))
      .filter((s): s is string => Boolean(s));
  }

  if (PRIORITY === "clothing") {
    const pool = Math.min(Math.max(limit * 20, 3000), 40000);
    const candidates = await prisma.$queryRaw<
      Array<{
        supplierSku: string;
        name: string | null;
        urlKey: string | null;
        brand: string | null;
        supplierProductName: string | null;
      }>
    >`
      SELECT sv."supplierSku" AS "supplierSku",
             MAX(kp.name) AS name,
             MAX(kp."urlKey") AS "urlKey",
             MAX(COALESCE(kp.brand, sv."supplierBrand")) AS brand,
             MAX(sv."supplierProductName") AS "supplierProductName"
      FROM "SupplierVariant" sv
      LEFT JOIN "KickDBProduct" kp ON kp."styleId" = sv."supplierSku"
      LEFT JOIN "BarcodesGgStyleCache" c
        ON c."styleCode" = UPPER(TRIM(sv."supplierSku"))
      WHERE sv."supplierVariantId" LIKE 'stx_%'
        AND (sv.gtin IS NULL OR btrim(sv.gtin) = '')
        AND sv."supplierSku" IS NOT NULL
        AND btrim(sv."supplierSku") <> ''
        AND sv.stock > 0
        AND c."styleCode" IS NULL
      GROUP BY sv."supplierSku"
      ORDER BY SUM(sv.stock) DESC
      LIMIT ${pool}
    `;

    const out: string[] = [];
    const seen = new Set<string>();
    for (const c of candidates) {
      const sku = normalizeStyleCode(c.supplierSku);
      if (!sku || seen.has(sku)) continue;
      const handle = String(c.urlKey ?? c.supplierSku ?? "");
      const name = String(c.supplierProductName ?? c.name ?? c.brand ?? "");
      if (isLegoStxSlug(handle) || /lego/i.test(name) || /lego/i.test(handle)) continue;
      const cat = classifySuggestedSellCategory({
        productHandle: handle,
        productName: name,
      });
      if (cat !== "clothing") continue;
      seen.add(sku);
      out.push(sku);
      if (out.length >= limit) break;
    }
    return out;
  }

  if (PRIORITY === "listed_stock" || PRIORITY === "listed") {
    const stockOnly = PRIORITY === "listed_stock";
    const pool = Math.min(Math.max(limit * 8, 800), 15000);
    const candidates = await prisma.$queryRaw<Array<{ styleId: string }>>`
      SELECT UPPER(TRIM(kp."styleId")) AS "styleId"
      FROM "ShopifySyncState" ss
      JOIN "KickDBProduct" kp ON kp."kickdbProductId" = ss."kickdbProductId"
      LEFT JOIN "BarcodesGgStyleCache" c
        ON c."styleCode" = UPPER(TRIM(kp."styleId"))
      WHERE ss."shopifyProductId" IS NOT NULL
        AND ss."syncStatus" IN ('synced', 'pending')
        AND kp."styleId" IS NOT NULL
        AND btrim(kp."styleId") <> ''
      ORDER BY
        CASE WHEN c."styleCode" IS NULL THEN 0 ELSE 1 END,
        ss."priorityScore" DESC NULLS LAST,
        ss."shopifySyncedAt" DESC NULLS LAST
      LIMIT ${pool}
    `;

    const out: string[] = [];
    const seen = new Set<string>();
    const skus = [
      ...new Set(
        candidates
          .map((c) => normalizeStyleCode(c.styleId))
          .filter((s): s is string => Boolean(s))
      ),
    ];
    for (let i = 0; i < skus.length && out.length < limit; i += 250) {
      const chunk = skus.slice(i, i + 250);
      const misses = stockOnly
        ? await prisma.$queryRaw<Array<{ supplierSku: string }>>`
            SELECT DISTINCT "supplierSku" FROM "SupplierVariant"
            WHERE "supplierSku" IN (${Prisma.join(chunk)})
              AND gtin IS NULL AND stock > 0
              AND "supplierVariantId" LIKE 'stx_%'
          `
        : await prisma.$queryRaw<Array<{ supplierSku: string }>>`
            SELECT DISTINCT "supplierSku" FROM "SupplierVariant"
            WHERE "supplierSku" IN (${Prisma.join(chunk)})
              AND gtin IS NULL
              AND "supplierVariantId" LIKE 'stx_%'
          `;
      const missSet = new Set(
        misses.map((m) => normalizeStyleCode(m.supplierSku)).filter(Boolean) as string[]
      );
      for (const sku of chunk) {
        if (!missSet.has(sku) || seen.has(sku)) continue;
        seen.add(sku);
        out.push(sku);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  if (PRIORITY === "in_stock") {
    // Prefer never-looked-up styles; otherwise recycle forever on top stock.
    const rows = await prisma.$queryRaw<Array<{ supplierSku: string }>>`
      SELECT sv."supplierSku"
      FROM "SupplierVariant" sv
      LEFT JOIN "BarcodesGgStyleCache" c
        ON c."styleCode" = UPPER(TRIM(sv."supplierSku"))
      WHERE (sv.gtin IS NULL OR btrim(sv.gtin) = '')
        AND sv.stock > 0
        AND sv."supplierVariantId" LIKE 'stx_%'
        AND sv."supplierSku" IS NOT NULL
        AND btrim(sv."supplierSku") <> ''
        AND c."styleCode" IS NULL
      GROUP BY sv."supplierSku"
      ORDER BY SUM(sv.stock) DESC
      LIMIT ${limit}
    `;
    return rows
      .map((r) => normalizeStyleCode(r.supplierSku))
      .filter((s): s is string => Boolean(s));
  }

  const rows = await prisma.$queryRaw<Array<{ supplierSku: string }>>`
    SELECT sv."supplierSku"
    FROM "SupplierVariant" sv
    LEFT JOIN "BarcodesGgStyleCache" c
      ON c."styleCode" = UPPER(TRIM(sv."supplierSku"))
    WHERE (sv.gtin IS NULL OR btrim(sv.gtin) = '')
      AND sv."supplierVariantId" LIKE 'stx_%'
      AND sv."supplierSku" IS NOT NULL
      AND btrim(sv."supplierSku") <> ''
      AND c."styleCode" IS NULL
    GROUP BY sv."supplierSku"
    LIMIT ${limit}
  `;
  return rows
    .map((r) => normalizeStyleCode(r.supplierSku))
    .filter((s): s is string => Boolean(s));
}

type SvNeed = {
  id: string;
  supplierVariantId: string;
  supplierSku: string;
  sizeRaw: string | null;
  sizeNormalized: string | null;
  providerKey: string | null;
  externalVariantId: string | null;
  externalProductId: string | null;
};

async function loadVariantsForSku(sku: string): Promise<SvNeed[]> {
  return prisma.$queryRaw<SvNeed[]>`
    SELECT sv.id, sv."supplierVariantId", sv."supplierSku", sv."sizeRaw", sv."sizeNormalized",
           sv."providerKey",
           cls."externalVariantId", cls."externalProductId"
    FROM "SupplierVariant" sv
    LEFT JOIN "ChannelListingState" cls
      ON cls."supplierVariantId" = sv."supplierVariantId" AND cls.channel = 'SHOPIFY'
    WHERE sv."supplierSku" = ${sku}
      AND (sv.gtin IS NULL OR btrim(sv.gtin) = '')
  `;
}

async function gtinAlreadyOwned(gtin: string, exceptSvId: string): Promise<boolean> {
  const hit = await prisma.supplierVariant.findFirst({
    where: {
      gtin,
      NOT: { supplierVariantId: exceptSvId },
      supplierVariantId: { startsWith: "stx_" },
    },
    select: { supplierVariantId: true },
  });
  return Boolean(hit);
}

type ShopifyPatch = { productId: string; variantId: string; barcode: string };

async function fillFromApi(): Promise<void> {
  const usage = await fetchTokenUsage();
  console.log("[usage before]", usage);

  const skus = await loadPrioritySkus(LIMIT);
  console.log(`[fill] priority=${PRIORITY} skus=${skus.length} apply=${APPLY} shopify=${DO_SHOPIFY}`);

  const stats = {
    skus: 0,
    cacheHits: 0,
    apiCalls: 0,
    debited: 0,
    notFound: 0,
    found: 0,
    variantsMatched: 0,
    variantsWritten: 0,
    shopifyQueued: 0,
    shopifyWritten: 0,
    skippedOwned: 0,
    skippedNoSize: 0,
  };

  const shopifyPatches: ShopifyPatch[] = [];

  for (const sku of skus) {
    stats.skus += 1;
    const style = normalizeStyleCode(sku);
    if (!style) continue;

    const lookup = await withDbRetry(() => lookupStyleDetails(style), `lookup:${style}`);
    if (lookup.fromCache) stats.cacheHits += 1;
    else {
      stats.apiCalls += 1;
      if (lookup.requestDebited) stats.debited += 1;
    }

    if (lookup.status === "not_found") {
      stats.notFound += 1;
      continue;
    }
    if (lookup.status !== "found" || lookup.picks.length === 0) continue;
    stats.found += 1;

    const variants = await withDbRetry(() => loadVariantsForSku(sku), `variants:${sku}`);
    for (const v of variants) {
      const pick = matchSizeToPicked(v.sizeRaw, v.sizeNormalized, lookup.picks);
      if (!pick) {
        stats.skippedNoSize += 1;
        continue;
      }
      stats.variantsMatched += 1;

      if (APPLY) {
        try {
          await withDbRetry(async () => {
            await prisma.supplierVariant.update({
              where: { supplierVariantId: v.supplierVariantId },
              data: {
                gtin: pick.gtin,
                ...(v.providerKey?.startsWith("STX_")
                  ? {}
                  : { providerKey: `STX_${pick.gtin}` }),
              },
            });
            if (v.externalVariantId) {
              await prisma.channelListingState.updateMany({
                where: {
                  supplierVariantId: v.supplierVariantId,
                  channel: "SHOPIFY",
                },
                data: { gtin: pick.gtin },
              });
            }
          }, `write:${v.supplierVariantId}`);
          stats.variantsWritten += 1;
        } catch (e: any) {
          const msg = String(e?.message ?? e);
          if (/Unique constraint/i.test(msg)) stats.skippedOwned += 1;
          else console.warn(`[fill] write fail ${v.supplierVariantId}:`, msg.slice(0, 180));
          continue;
        }
      } else {
        stats.variantsWritten += 1;
      }

      if (DO_SHOPIFY && v.externalVariantId && v.externalProductId) {
        shopifyPatches.push({
          productId: v.externalProductId,
          variantId: v.externalVariantId,
          barcode: pick.gtin,
        });
        stats.shopifyQueued += 1;
      }
    }

    // Only sleep after debited API calls (stay under ~120/min)
    if (SLEEP_MS && !lookup.fromCache && lookup.requestDebited) await sleep(SLEEP_MS);
    if (stats.skus % 50 === 0) {
      console.log(
        `[fill] progress skus=${stats.skus} api=${stats.apiCalls} cache=${stats.cacheHits} written=${stats.variantsWritten}`
      );
    }
  }

  if (DO_SHOPIFY && shopifyPatches.length) {
    // Deduplicate: one write per variantId (never double-call same variant)
    const byVariant = new Map<string, ShopifyPatch>();
    for (const p of shopifyPatches) byVariant.set(p.variantId, p);

    // Check existing barcodes in batches — skip if already set
    const ids = [...byVariant.keys()];
    const existing = new Map<string, string | null>();
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const res = await shopifyGraphQL<{
        nodes: Array<{ id: string; barcode: string | null } | null>;
      }>(
        `query($ids:[ID!]!){ nodes(ids:$ids){ ... on ProductVariant { id barcode } } }`,
        { ids: chunk }
      );
      for (const n of res.data?.nodes ?? []) {
        if (n?.id) existing.set(n.id, n.barcode ?? null);
      }
    }

    // Group by product for bulk update, but use setVariantBarcode (1 variant) when needed;
    // prefer one mutation per product with all empty-barcode variants.
    const byProduct = new Map<string, ShopifyPatch[]>();
    for (const p of byVariant.values()) {
      const cur = String(existing.get(p.variantId) ?? "").trim();
      if (cur) continue; // already has barcode — do not overwrite / double-write
      const list = byProduct.get(p.productId) ?? [];
      list.push(p);
      byProduct.set(p.productId, list);
    }

    console.log(
      `[shopify] products=${byProduct.size} variants_to_set=${[...byProduct.values()].reduce((a, b) => a + b.length, 0)}`
    );

    if (APPLY) {
      for (const [productId, patches] of byProduct) {
        // Batch via productVariantsBulkUpdate — one call per product
        const { data, errors } = await shopifyGraphQL<{
          productVariantsBulkUpdate: {
            productVariants: Array<{ id: string; barcode: string | null }>;
            userErrors: Array<{ message: string }>;
          };
        }>(
          `mutation($productId:ID!,$variants:[ProductVariantsBulkInput!]!){
            productVariantsBulkUpdate(productId:$productId, variants:$variants) {
              productVariants { id barcode }
              userErrors { message }
            }
          }`,
          {
            productId,
            variants: patches.map((p) => ({ id: p.variantId, barcode: p.barcode })),
          }
        );
        if (errors?.length) {
          console.warn(`[shopify] gql errors product=${productId}`, errors.map((e) => e.message));
          // fallback one-by-one
          for (const p of patches) {
            try {
              await setVariantBarcode(p);
              stats.shopifyWritten += 1;
            } catch (e: any) {
              console.warn(`[shopify] fail ${p.variantId}`, e?.message ?? e);
            }
          }
          continue;
        }
        const ue = data?.productVariantsBulkUpdate?.userErrors ?? [];
        if (ue.length) {
          console.warn(`[shopify] userErrors product=${productId}`, ue.map((e) => e.message));
        }
        stats.shopifyWritten += data?.productVariantsBulkUpdate?.productVariants?.length ?? 0;
        await sleep(100);
      }
    }
  }

  const usageAfter = await fetchTokenUsage().catch(() => null);
  console.log("[stats]", stats);
  console.log("[usage after]", usageAfter);
}

async function main() {
  if (argFlag("inventory")) {
    await inventory();
    return;
  }
  if (argFlag("cross-fill")) {
    await crossFill();
    return;
  }
  if (argFlag("fill")) {
    await fillFromApi();
    return;
  }
  console.log(`Usage:
  --inventory
  --cross-fill [--apply]
  --fill --priority=lego|clothing|listed_stock|listed|in_stock|all --limit=N [--apply] [--shopify] [--sleep-ms=50]

Catalogue order: lego → clothing → then sneaker/listed pools.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
