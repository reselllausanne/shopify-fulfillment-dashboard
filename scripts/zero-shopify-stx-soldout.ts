/**
 * Zero Shopify "Website stock" for StockX sizes that are sold out live.
 *
 * Shopify quantities are only written by the Python SSE consumer, which never
 * sees sold-outs detected by `stx-refresh` (no KickDB raw refresh → no queue
 * entry). Those sizes keep qty>0 on Shopify and oversell.
 *
 * The DB is NOT trusted on its own (no-GTIN sizes were zeroed in DB while still
 * offered). Per product this re-fetches KicksDB live and zeroes a Shopify
 * variant only when:
 *   - it has available > 0 at the online location (Chemin / Website stock),
 *   - it matches exactly one live StockX variant (barcode, else exact size),
 *   - that StockX variant has 0 asks across every lane,
 *   - it is not price_locked and not an admin-only product.
 * Physical locations are never touched. Unmatched sizes are skipped.
 *
 * Dry-run by default.
 *   npx tsx scripts/zero-shopify-stx-soldout.ts --limit=200
 *   npx tsx scripts/zero-shopify-stx-soldout.ts --apply --shards=4 --shard=0 --limit=100000
 */
import "dotenv/config";
import crypto from "node:crypto";

import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import {
  extractVariantEan,
  extractVariantGtin,
  fetchStockxProductByIdOrSlugRaw,
} from "@/galaxus/kickdb/client";
import { kickdbStockxFetchId } from "@/galaxus/jobs/stxSync";
import { ONLINE_LOCATION } from "@/shopify/inventory/locationConfig";
import { isAdminOnlyShopifyVariant } from "@/shopify/protection/adminOnlyProducts";
import { cleanGtin } from "@/shopify/restock/gtinNormalize";

function num(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const APPLY = process.argv.includes("--apply");
const ALL_ZERO = process.argv.includes("--all-zero");
const LIMIT = Math.max(1, Math.floor(num("limit", 200)));
const SHARDS = Math.max(1, Math.floor(num("shards", 1)));
const SHARD = Math.min(SHARDS - 1, Math.floor(num("shard", 0)));
const PROGRESS_EVERY = Math.max(1, Math.floor(num("progress-every", 100)));
const LOCATION_ID = ONLINE_LOCATION.id;

const VARIANTS_QUERY = /* GraphQL */ `
query ZeroSoldoutVariants($id: ID!, $loc: ID!) {
  product(id: $id) {
    id
    variants(first: 100) {
      nodes {
        id
        title
        barcode
        usSize: metafield(namespace: "custom", key: "us_size") { value }
        priceLocked: metafield(namespace: "custom", key: "price_locked") { value }
        inventoryItem {
          id
          inventoryLevel(locationId: $loc) {
            quantities(names: ["available"]) { quantity }
          }
        }
      }
    }
  }
}`;

const SET_QUANTITIES = /* GraphQL */ `
mutation ZeroSoldout($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) {
  inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
    userErrors { field message }
  }
}`;

type ShopifyVariant = {
  id: string;
  title: string | null;
  barcode: string | null;
  usSize: { value: string | null } | null;
  priceLocked: { value: string | null } | null;
  inventoryItem: {
    id: string;
    inventoryLevel: { quantities: Array<{ quantity: number }> } | null;
  } | null;
};

type LiveVariant = {
  barcodes: Set<string>;
  sizes: Set<string>;
  asks: number;
};

function gtinKey(value: string | null | undefined): string {
  return cleanGtin(String(value ?? "")).replace(/^0+/, "");
}

/** "EU 37 1/3" / "US M 7" / "7,5" → "37 1/3" / "7" / "7.5". Exact compare only. */
function normSize(raw: unknown): string {
  return String(raw ?? "")
    .toUpperCase()
    .replace(",", ".")
    .replace(/^(EU|US|UK)\s*/, "")
    .replace(/^(M|W|Y|C|K|MEN'?S|WOMEN'?S)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function liveVariantsFromPayload(payload: any): LiveVariant[] {
  const variants = Array.isArray(payload?.variants) ? payload.variants : [];
  return variants.map((v: any) => {
    const barcodes = new Set<string>();
    for (const b of [extractVariantGtin(v), extractVariantEan(v)]) {
      const k = gtinKey(b);
      if (k) barcodes.add(k);
    }
    for (const id of Array.isArray(v?.identifiers) ? v.identifiers : []) {
      const k = gtinKey(id?.identifier);
      if (k.length >= 8) barcodes.add(k);
    }
    const sizes = new Set<string>();
    for (const s of [v?.size, v?.size_eu, v?.size_us]) {
      const n = normSize(s);
      if (n) sizes.add(n);
    }
    for (const entry of Array.isArray(v?.sizes) ? v.sizes : []) {
      const type = String(entry?.type ?? "").toLowerCase();
      if (type === "eu" || type.startsWith("us")) {
        const n = normSize(entry?.size);
        if (n) sizes.add(n);
      }
    }
    const asks = (Array.isArray(v?.prices) ? v.prices : []).reduce(
      (sum: number, p: any) => sum + (Number(p?.asks) > 0 ? Number(p.asks) : 0),
      0
    );
    return { barcodes, sizes, asks };
  });
}

function matchLive(node: ShopifyVariant, live: LiveVariant[]): LiveVariant | null {
  const barcode = gtinKey(node.barcode);
  if (barcode) {
    const hits = live.filter((l) => l.barcodes.has(barcode));
    if (hits.length === 1) return hits[0]!;
    if (hits.length > 1) return null;
  }
  const keys = [normSize(node.title), normSize(node.usSize?.value)].filter(Boolean);
  const hits = live.filter((l) => keys.some((k) => l.sizes.has(k)));
  return hits.length === 1 ? hits[0]! : null;
}

function availableOnline(node: ShopifyVariant): number {
  return node.inventoryItem?.inventoryLevel?.quantities?.[0]?.quantity ?? 0;
}

async function main() {
  console.log(
    `${APPLY ? "APPLY" : "DRY-RUN"} | shard ${SHARD}/${SHARDS} | location=${LOCATION_ID} | all-zero=${ALL_ZERO} | limit=${LIMIT}`
  );

  const shardClause =
    SHARDS > 1 ? `AND (abs(hashtextextended(sss."shopifyProductId", 0)) % ${SHARDS}) = ${SHARD}` : "";
  const freshClause = ALL_ZERO ? "" : `AND sv."updatedAt" > sss."shopifySyncedAt"`;

  const products = await prisma.$queryRawUnsafe<
    Array<{ kickdbProductId: string; urlKey: string | null; shopifyProductId: string }>
  >(`
    SELECT DISTINCT p."kickdbProductId", p."urlKey", sss."shopifyProductId"
    FROM "SupplierVariant" sv
    JOIN "VariantMapping" vm ON vm."supplierVariantId" = sv."supplierVariantId"
    JOIN "KickDBVariant" kv ON kv.id = vm."kickdbVariantId"
    JOIN "KickDBProduct" p ON p.id = kv."productId"
    JOIN "ShopifySyncState" sss ON sss."kickdbProductId" = p."kickdbProductId"
    WHERE sv."supplierVariantId" LIKE 'stx_%'
      AND sv.stock = 0
      AND sss."syncStatus" = 'synced'
      AND sss."shopifyProductId" IS NOT NULL
      ${freshClause}
      ${shardClause}
    ORDER BY sss."shopifyProductId"
    LIMIT ${LIMIT}
  `);
  console.log(`Products: ${products.length}`);

  const stats = {
    products: 0,
    noOnlineQty: 0,
    kicksFail: 0,
    shopifyFail: 0,
    checked: 0,
    stillOffered: 0,
    unmatched: 0,
    locked: 0,
    adminOnly: 0,
    zeroed: 0,
    applyFail: 0,
  };
  const examples: string[] = [];

  for (const p of products) {
    stats.products += 1;
    if (stats.products % PROGRESS_EVERY === 0) console.log(`  progress ${stats.products}/${products.length}`, stats);

    const productGid = p.shopifyProductId.startsWith("gid://")
      ? p.shopifyProductId
      : `gid://shopify/Product/${p.shopifyProductId}`;

    let nodes: ShopifyVariant[];
    try {
      const res = await shopifyGraphQL<{ product: { variants: { nodes: ShopifyVariant[] } } | null }>(
        VARIANTS_QUERY,
        { id: productGid, loc: LOCATION_ID }
      );
      if (res.errors?.length) throw new Error(res.errors.map((e) => e.message).join("; "));
      nodes = res.data?.product?.variants?.nodes ?? [];
    } catch (err) {
      stats.shopifyFail += 1;
      console.error(`  shopify ${productGid}:`, err instanceof Error ? err.message : err);
      continue;
    }

    const withQty = nodes.filter((n) => availableOnline(n) > 0);
    if (withQty.length === 0) {
      stats.noOnlineQty += 1;
      continue;
    }

    let live: LiveVariant[];
    try {
      const { product } = await fetchStockxProductByIdOrSlugRaw(kickdbStockxFetchId(p));
      live = liveVariantsFromPayload(product);
      if (live.length === 0) throw new Error("no variants in payload");
    } catch (err) {
      stats.kicksFail += 1;
      console.error(`  kicks ${p.urlKey ?? p.kickdbProductId}:`, err instanceof Error ? err.message.slice(0, 160) : err);
      continue;
    }

    const toZero: Array<{ node: ShopifyVariant; qty: number }> = [];
    for (const node of withQty) {
      stats.checked += 1;
      const hit = matchLive(node, live);
      if (!hit) {
        stats.unmatched += 1;
        continue;
      }
      if (hit.asks > 0) {
        stats.stillOffered += 1;
        continue;
      }
      if (String(node.priceLocked?.value ?? "").trim().toLowerCase() === "true") {
        stats.locked += 1;
        continue;
      }
      if (isAdminOnlyShopifyVariant(node.id, productGid)) {
        stats.adminOnly += 1;
        continue;
      }
      toZero.push({ node, qty: availableOnline(node) });
    }
    if (toZero.length === 0) continue;

    if (examples.length < 15) {
      examples.push(`${p.urlKey} → ${toZero.map((z) => `${z.node.title}(${z.qty})`).join(", ")}`);
    }

    if (!APPLY) {
      stats.zeroed += toZero.length;
      continue;
    }

    try {
      const res = await shopifyGraphQL<{ inventorySetQuantities: { userErrors: Array<{ message: string }> } }>(
        SET_QUANTITIES,
        {
          input: {
            name: "available",
            reason: "correction",
            referenceDocumentUri: `gid://resell-lausanne/StxSoldoutZero/${Date.now()}`,
            quantities: toZero.map((z) => ({
              inventoryItemId: z.node.inventoryItem!.id,
              locationId: LOCATION_ID,
              quantity: 0,
              changeFromQuantity: z.qty,
            })),
          },
          idempotencyKey: crypto.randomUUID(),
        }
      );
      const errs = [
        ...(res.errors ?? []).map((e) => e.message),
        ...(res.data?.inventorySetQuantities?.userErrors ?? []).map((e) => e.message),
      ];
      if (errs.length) throw new Error(errs.join("; "));
      stats.zeroed += toZero.length;
      await prisma.channelListingState.updateMany({
        where: { channel: "SHOPIFY", externalVariantId: { in: toZero.map((z) => z.node.id) } },
        data: { lastPushedStock: 0, soldOutAt: new Date(), lastSyncedAt: new Date() },
      });
    } catch (err) {
      stats.applyFail += toZero.length;
      console.error(`  apply ${productGid}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`\nEXAMPLES:\n  ${examples.join("\n  ")}`);
  console.log(`\nRESUME shard ${SHARD}/${SHARDS} ${APPLY ? "" : "(dry-run, zeroed = would zero)"}:`, stats);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
