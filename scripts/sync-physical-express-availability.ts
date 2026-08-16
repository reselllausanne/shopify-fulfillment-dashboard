/**
 * Backfill express_available + delivery_48h from physical warehouse stock.
 * Normal sell price is never changed.
 *
 * Usage:
 *   npx tsx scripts/sync-physical-express-availability.ts           # dry-run
 *   npx tsx scripts/sync-physical-express-availability.ts --write
 */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { prisma } from "@/app/lib/prisma";
import { PHYSICAL_LOCATIONS } from "@/shopify/inventory/locationConfig";
import { IN_STOCK_FIXED_PRICE_RULES } from "@/shopify/inventory/inStockFixedPrice";
import { syncPhysicalExpressAvailability } from "@/shopify/inventory/syncPhysicalExpressAvailability";

const WRITE = process.argv.includes("--write");

function productGids(): string[] {
  const ids = new Set<string>();
  for (const rule of IN_STOCK_FIXED_PRICE_RULES) {
    for (const id of rule.productIds ?? []) {
      const n = String(id).replace(/\D/g, "");
      if (n) ids.add(`gid://shopify/Product/${n}`);
    }
  }
  return [...ids];
}

async function main() {
  const physicalLocIds = PHYSICAL_LOCATIONS.map((l) => l.id);
  const report: Array<Record<string, unknown>> = [];

  // 1) Known fixed-price product IDs
  const gids = productGids();

  // 2) Also search Essentials / Bape titles for products not in the ID list
  const searches = [
    "title:Essentials",
    "title:Fear of God Essentials",
    "title:BAPE Tee",
    "title:Audemars",
  ];
  const found = new Map<string, true>();
  for (const gid of gids) found.set(gid, true);

  for (const q of searches) {
    const { data } = await shopifyGraphQL<{
      products: { nodes: Array<{ id: string }> };
    }>(
      `query($q: String!) {
        products(first: 50, query: $q) { nodes { id } }
      }`,
      { q }
    );
    for (const p of data?.products?.nodes ?? []) found.set(p.id, true);
  }

  for (const productId of found.keys()) {
    const { data, errors } = await shopifyGraphQL<{
      product: {
        id: string;
        handle: string;
        title: string;
        variants: {
          nodes: Array<{
            id: string;
            legacyResourceId: string;
            title: string;
            sku: string | null;
            barcode: string | null;
            price: string;
            expressAvailable: { value: string | null } | null;
            delivery48h: { value: string | null } | null;
          }>;
        };
      } | null;
    }>(
      `query($id: ID!) {
        product(id: $id) {
          id handle title
          variants(first: 100) {
            nodes {
              id legacyResourceId title sku barcode price
              expressAvailable: metafield(namespace: "custom", key: "express_available") { value }
              delivery48h: metafield(namespace: "custom", key: "delivery_48h") { value }
            }
          }
        }
      }`,
      { id: productId }
    );
    if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
    const product = data?.product;
    if (!product) continue;

    for (const v of product.variants.nodes) {
      const vid = v.id; // gid://shopify/ProductVariant/… (mirror key)
      const rows = await (prisma as any).$queryRaw`
        SELECT COALESCE(SUM(s."available"), 0)::int AS qty
        FROM "public"."ShopifyVariantLocationStock" s
        WHERE s."shopifyVariantId" = ${vid}
          AND s."locationId" = ANY(${physicalLocIds}::text[])
          AND s."sourceType" = 'physical'
      `;
      const physicalQty = Number(rows?.[0]?.qty ?? 0);

      const before = {
        express: v.expressAvailable?.value ?? null,
        delivery48h: v.delivery48h?.value ?? null,
        price: v.price,
      };

      let syncResult: Awaited<ReturnType<typeof syncPhysicalExpressAvailability>> | null = null;
      if (WRITE) {
        syncResult = await syncPhysicalExpressAvailability({
          variantId: v.id,
          physicalQty,
          sku: v.sku,
          title: product.title,
          productId: product.id,
        });
      }

      report.push({
        handle: product.handle,
        size: v.title,
        variantId: vid,
        physicalQty,
        price: v.price,
        before,
        wouldExpress: physicalQty > 0,
        changes: syncResult?.changes ?? [],
      });
      console.log(
        `${WRITE ? "SYNC" : "WOULD"} ${product.handle} ${v.title} phys=${physicalQty} express→${
          physicalQty > 0
        } price=${v.price}`
      );
    }
  }

  const outDir = path.join(process.cwd(), "tmp");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "sync-physical-express.json");
  writeFileSync(
    outPath,
    JSON.stringify({ at: new Date().toISOString(), write: WRITE, count: report.length, report }, null, 2)
  );
  console.log(JSON.stringify({ write: WRITE, count: report.length, outPath }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
