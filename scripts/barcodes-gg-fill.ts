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
import { prisma } from "@/app/lib/prisma";
import { isValidGtin } from "@/galaxus/exports/feedValidation";
import { fetchTokenUsage, lookupStyleDetails } from "@/lib/barcodesGg/client";
import { matchSizeToPicked, normalizeStyleCode } from "@/lib/barcodesGg/gtinPick";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { setVariantBarcode } from "@/shopify/restock/shopifyRestockInventory";

type Priority = "listed_stock" | "listed" | "in_stock" | "all";

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

  // Sample top listed-missing SKUs (cheap: CLS first, then SV)
  const sample = await prisma.$queryRaw<MissingSkuRow[]>`
    SELECT sv."supplierSku" AS "supplierSku",
           COUNT(*)::bigint AS variant_count,
           COUNT(*) FILTER (WHERE sv.stock > 0)::bigint AS in_stock_count,
           TRUE AS listed
    FROM "ChannelListingState" cls
    JOIN "SupplierVariant" sv ON sv."supplierVariantId" = cls."supplierVariantId"
    WHERE cls.channel = 'SHOPIFY'
      AND cls."externalVariantId" IS NOT NULL
      AND (cls.gtin IS NULL OR btrim(cls.gtin) = '')
      AND (sv.gtin IS NULL OR btrim(sv.gtin) = '')
      AND sv."supplierSku" IS NOT NULL
      AND btrim(sv."supplierSku") <> ''
    GROUP BY sv."supplierSku"
    ORDER BY COUNT(*) FILTER (WHERE sv.stock > 0) DESC, COUNT(*) DESC
    LIMIT 20
  `;
  console.log("[sample top listed-missing skus]", sample.slice(0, 10));
}

async function crossFill(): Promise<void> {
  // CLS ← SV
  const clsFromSv = await prisma.$queryRaw<Array<{ id: string; gtin: string }>>`
    SELECT cls.id, sv.gtin
    FROM "ChannelListingState" cls
    JOIN "SupplierVariant" sv ON sv."supplierVariantId" = cls."supplierVariantId"
    WHERE cls.channel = 'SHOPIFY'
      AND (cls.gtin IS NULL OR btrim(cls.gtin) = '')
      AND sv.gtin IS NOT NULL AND btrim(sv.gtin) <> ''
    LIMIT 5000
  `;
  console.log(`[cross] CLS←SV candidates: ${clsFromSv.length}`);
  if (APPLY && clsFromSv.length) {
    let n = 0;
    for (const row of clsFromSv) {
      await prisma.channelListingState.update({
        where: { id: row.id },
        data: { gtin: row.gtin },
      });
      n += 1;
    }
    console.log(`[cross] CLS←SV applied: ${n}`);
  }

  // SV ← CLS
  const svFromCls = await prisma.$queryRaw<
    Array<{ supplierVariantId: string; gtin: string; providerKey: string | null }>
  >`
    SELECT sv."supplierVariantId", cls.gtin, sv."providerKey"
    FROM "SupplierVariant" sv
    JOIN "ChannelListingState" cls
      ON cls."supplierVariantId" = sv."supplierVariantId" AND cls.channel = 'SHOPIFY'
    WHERE (sv.gtin IS NULL OR btrim(sv.gtin) = '')
      AND cls.gtin IS NOT NULL AND btrim(cls.gtin) <> ''
    LIMIT 5000
  `;
  console.log(`[cross] SV←CLS candidates: ${svFromCls.length}`);
  if (APPLY) {
    let n = 0;
    for (const row of svFromCls) {
      const gtin = String(row.gtin).replace(/\D/g, "");
      if (!isValidGtin(gtin) && !isValidGtin(gtin.padStart(13, "0"))) continue;
      const stamped = gtin.length === 12 ? `0${gtin}` : gtin;
      try {
        await prisma.supplierVariant.update({
          where: { supplierVariantId: row.supplierVariantId },
          data: {
            gtin: stamped,
            providerKey: row.providerKey?.startsWith("STX_")
              ? row.providerKey
              : `STX_${stamped}`,
          },
        });
        n += 1;
      } catch (e: any) {
        console.warn(`[cross] SV←CLS skip ${row.supplierVariantId}:`, e?.message ?? e);
      }
    }
    console.log(`[cross] SV←CLS applied: ${n}`);
  }

  // SV ← KickDB (mapped)
  const kick = await prisma.$queryRaw<
    Array<{ supplierVariantId: string; gtin: string | null; ean: string | null; providerKey: string | null }>
  >`
    SELECT sv."supplierVariantId", kv.gtin, kv.ean, sv."providerKey"
    FROM "SupplierVariant" sv
    JOIN "VariantMapping" vm ON vm."supplierVariantId" = sv."supplierVariantId"
    JOIN "KickDBVariant" kv ON kv.id = vm."kickdbVariantId"
    WHERE (sv.gtin IS NULL OR btrim(sv.gtin) = '')
      AND (
        (kv.gtin IS NOT NULL AND btrim(kv.gtin) <> '')
        OR (kv.ean IS NOT NULL AND btrim(kv.ean) <> '')
      )
    LIMIT 5000
  `;
  console.log(`[cross] SV←KickDB candidates: ${kick.length}`);
  if (APPLY) {
    let n = 0;
    for (const row of kick) {
      const raw = String(row.gtin || row.ean || "").replace(/\D/g, "");
      if (!raw) continue;
      const stamped =
        isValidGtin(raw) ? raw : isValidGtin(raw.padStart(13, "0")) ? raw.padStart(13, "0") : null;
      if (!stamped) continue;
      try {
        await prisma.supplierVariant.update({
          where: { supplierVariantId: row.supplierVariantId },
          data: {
            gtin: stamped,
            providerKey: row.providerKey?.startsWith("STX_")
              ? row.providerKey
              : `STX_${stamped}`,
          },
        });
        n += 1;
      } catch (e: any) {
        console.warn(`[cross] SV←Kick skip ${row.supplierVariantId}:`, e?.message ?? e);
      }
    }
    console.log(`[cross] SV←KickDB applied: ${n}`);
  }

  // Mirror → SV for the tiny hole
  const mirror = await prisma.$queryRaw<
    Array<{ supplierVariantId: string; gtin: string; providerKey: string | null }>
  >`
    SELECT sv."supplierVariantId", m.gtin, sv."providerKey"
    FROM "SupplierVariant" sv
    JOIN "ChannelListingState" cls
      ON cls."supplierVariantId" = sv."supplierVariantId" AND cls.channel = 'SHOPIFY'
    JOIN "ShopifyVariantLocationStock" m ON m."shopifyVariantId" = cls."externalVariantId"
    WHERE (sv.gtin IS NULL OR btrim(sv.gtin) = '')
      AND m.gtin IS NOT NULL AND btrim(m.gtin) <> ''
    LIMIT 500
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

async function loadPrioritySkus(limit: number): Promise<string[]> {
  if (PRIORITY === "listed_stock" || PRIORITY === "listed") {
    const stockOnly = PRIORITY === "listed_stock";
    const rows = await prisma.$queryRaw<Array<{ supplierSku: string }>>`
      SELECT sv."supplierSku" AS "supplierSku"
      FROM "ChannelListingState" cls
      JOIN "SupplierVariant" sv ON sv."supplierVariantId" = cls."supplierVariantId"
      WHERE cls.channel = 'SHOPIFY'
        AND cls."externalVariantId" IS NOT NULL
        AND (cls.gtin IS NULL OR btrim(cls.gtin) = '')
        AND (sv.gtin IS NULL OR btrim(sv.gtin) = '')
        AND sv."supplierSku" IS NOT NULL
        AND btrim(sv."supplierSku") <> ''
        AND (${!stockOnly} OR sv.stock > 0)
      GROUP BY sv."supplierSku"
      ORDER BY COUNT(*) FILTER (WHERE sv.stock > 0) DESC, COUNT(*) DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => r.supplierSku).filter(Boolean);
  }

  if (PRIORITY === "in_stock") {
    const rows = await prisma.$queryRaw<Array<{ supplierSku: string }>>`
      SELECT "supplierSku"
      FROM "SupplierVariant"
      WHERE (gtin IS NULL OR btrim(gtin) = '')
        AND stock > 0
        AND "supplierVariantId" LIKE 'stx_%'
        AND "supplierSku" IS NOT NULL
      GROUP BY "supplierSku"
      ORDER BY SUM(stock) DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => r.supplierSku);
  }

  const rows = await prisma.$queryRaw<Array<{ supplierSku: string }>>`
    SELECT "supplierSku"
    FROM "SupplierVariant"
    WHERE (gtin IS NULL OR btrim(gtin) = '')
      AND "supplierVariantId" LIKE 'stx_%'
      AND "supplierSku" IS NOT NULL
    GROUP BY "supplierSku"
    LIMIT ${limit}
  `;
  return rows.map((r) => r.supplierSku);
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

    const lookup = await lookupStyleDetails(style);
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

    const variants = await loadVariantsForSku(sku);
    for (const v of variants) {
      const pick = matchSizeToPicked(v.sizeRaw, v.sizeNormalized, lookup.picks);
      if (!pick) {
        stats.skippedNoSize += 1;
        continue;
      }
      stats.variantsMatched += 1;

      if (await gtinAlreadyOwned(pick.gtin, v.supplierVariantId)) {
        stats.skippedOwned += 1;
        continue;
      }

      if (APPLY) {
        try {
          await prisma.supplierVariant.update({
            where: { supplierVariantId: v.supplierVariantId },
            data: {
              gtin: pick.gtin,
              providerKey: v.providerKey?.startsWith("STX_")
                ? v.providerKey
                : `STX_${pick.gtin}`,
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
          stats.variantsWritten += 1;
        } catch (e: any) {
          console.warn(`[fill] write fail ${v.supplierVariantId}:`, e?.message ?? e);
          continue;
        }
      } else {
        stats.variantsWritten += 1; // would-write
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

    if (SLEEP_MS) await sleep(SLEEP_MS);
    if (stats.skus % 25 === 0) {
      console.log(`[fill] progress skus=${stats.skus} api=${stats.apiCalls} written=${stats.variantsWritten}`);
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
  --fill --priority=listed_stock|listed|in_stock|all --limit=N [--apply] [--shopify] [--sleep-ms=50]`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
