/**
 * Reprice every in-stock warehouse variant to StockX Buy Now (after fees) / 2.
 *
 * compareAt = Buy Now after fees, recalculated each call from KickDB
 *             (raw ask × multiplier + 20 CHF). Stored stx price only if KickDB misses.
 * price     = Math.floor(buyNow * 0.5 * 2) / 2
 * Locks: variant price_locked, variant delivery_48h, product soldes_48h
 *
 * Locations: Bussigny, Antica, THE LAB, COLD BIEN, available > 0.
 * No GTIN exclusions. Skip only when no Buy Now can be derived.
 * Pricing only — does not change inventory quantities.
 *
 * Usage:
 *   npx tsx scripts/reprice-physical-buynow-half.ts            # dry-run
 *   npx tsx scripts/reprice-physical-buynow-half.ts --execute  # live
 */
import "dotenv/config";
import { prisma } from "../app/lib/prisma";
import { shopifyGraphQL } from "../lib/shopifyAdmin";
import { isInStockFixedPriceProduct } from "../shopify/inventory/inStockFixedPrice";
import { isEssentialsShopifyVariant } from "../shopify/inventory/essentialsProduct";
import { isAdminOnlyShopifyVariant } from "../shopify/protection/adminOnlyProducts";
import { applyLiquidationSaleDisplay } from "../shopify/restock/liquidationPricing";
import {
  resolvePhysicalRestockPricing,
  warehouseHalfBuyNowPrice,
} from "../shopify/restock/physicalRestockPricing";
import {
  getShopifyVariantDetail,
  type ShopifyVariantDetail,
} from "../shopify/restock/shopifyRestockInventory";

const EXECUTE = process.argv.includes("--execute");

const PHYSICAL_LOCATIONS = [
  { id: "gid://shopify/Location/111267971458", name: "Bussigny" },
  { id: "gid://shopify/Location/111267217794", name: "Antica" },
  { id: "gid://shopify/Location/111267250562", name: "Lab" },
  { id: "gid://shopify/Location/111272100226", name: "Cold Bien" },
];
const PHYSICAL_LOCATION_IDS = PHYSICAL_LOCATIONS.map((l) => l.id);

const NODES_QUERY = /* GraphQL */ `
query RepriceBuyNowHalfNodes($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on ProductVariant {
      id
      sku
      barcode
      price
      compareAtPrice
      title
      product { id title handle status }
    }
  }
}
`;

type PhysicalHit = {
  variantId: string;
  productId: string | null;
  sku: string | null;
  barcode: string | null;
  gtin: string | null;
  title: string | null;
  handle: string | null;
  status: string | null;
  size: string | null;
  price: number | null;
  compareAt: number | null;
  physicalQty: number;
  locationNames: string[];
};

async function loadPhysicalStockByVariant(): Promise<
  Map<string, { gtin: string | null; sku: string | null; qty: number; locs: string[] }>
> {
  const stock = await prisma.shopifyVariantLocationStock.findMany({
    where: {
      locationId: { in: PHYSICAL_LOCATION_IDS },
      available: { gt: 0 },
    },
    select: {
      shopifyVariantId: true,
      gtin: true,
      sku: true,
      available: true,
      locationName: true,
    },
  });

  const byVariant = new Map<
    string,
    { gtin: string | null; sku: string | null; qty: number; locs: string[] }
  >();
  for (const row of stock) {
    const cur = byVariant.get(row.shopifyVariantId) ?? {
      gtin: row.gtin,
      sku: row.sku,
      qty: 0,
      locs: [],
    };
    cur.qty += Number(row.available ?? 0);
    if (row.locationName && !cur.locs.includes(row.locationName)) cur.locs.push(row.locationName);
    if (!cur.gtin && row.gtin) cur.gtin = row.gtin;
    if (!cur.sku && row.sku) cur.sku = row.sku;
    byVariant.set(row.shopifyVariantId, cur);
  }
  return byVariant;
}

async function fetchShopifyPrices(variantIds: string[]): Promise<Map<string, PhysicalHit>> {
  const out = new Map<string, PhysicalHit>();
  for (let i = 0; i < variantIds.length; i += 50) {
    const batch = variantIds.slice(i, i + 50);
    const { data, errors } = await shopifyGraphQL<{
      nodes: Array<{
        id?: string;
        sku?: string | null;
        barcode?: string | null;
        price?: string | null;
        compareAtPrice?: string | null;
        title?: string | null;
        product?: { id: string; title: string | null; handle: string | null; status: string | null } | null;
      } | null>;
    }>(NODES_QUERY, { ids: batch });
    if (errors?.length) {
      throw new Error(`Shopify nodes query failed: ${errors.map((e) => e.message).join("; ")}`);
    }
    for (const node of data?.nodes ?? []) {
      if (!node?.id) continue;
      const price = node.price != null ? Number(node.price) : null;
      out.set(node.id, {
        variantId: node.id,
        productId: node.product?.id ?? null,
        sku: node.sku ?? null,
        barcode: node.barcode ?? null,
        gtin: (node.barcode ?? "").trim() || null,
        title: node.product?.title ?? null,
        handle: node.product?.handle ?? null,
        status: node.product?.status ?? null,
        size: node.title ?? null,
        price: Number.isFinite(price as number) ? (price as number) : null,
        compareAt:
          node.compareAtPrice != null && Number.isFinite(Number(node.compareAtPrice))
            ? Number(node.compareAtPrice)
            : null,
        physicalQty: 0,
        locationNames: [],
      });
    }
    if (i + 50 < variantIds.length) await new Promise((r) => setTimeout(r, 80));
  }
  return out;
}

function toVariantDetail(hit: PhysicalHit): ShopifyVariantDetail {
  return {
    variantId: hit.variantId,
    productId: hit.productId ?? "",
    productTitle: hit.title,
    productStatus: hit.status,
    productHandle: hit.handle,
    productTags: [],
    variantTitle: hit.size,
    inventoryItemId: null,
    sku: hit.sku,
    barcode: hit.barcode,
    price: hit.price,
    compareAtPrice: hit.compareAt,
    onSale: hit.compareAt != null && hit.price != null && hit.compareAt > hit.price,
  };
}

type Row = {
  gtin: string;
  title: string | null;
  buyNow: number;
  sale: number;
  compareAt: number;
  storedBuyPrice: number | null;
  source: string;
};

async function main() {
  console.log(`\n=== WAREHOUSE BUY NOW (AFTER FEES) / 2 (execute=${EXECUTE}) ===`);
  console.log("buyNow = AFTER fees. price = Math.floor(buyNow * 0.5 * 2) / 2 ; compareAt = buyNow");
  console.log("Locations: Bussigny, Antica, THE LAB, COLD BIEN. Quantities untouched.\n");

  const phys = await loadPhysicalStockByVariant();
  console.log(`Physical variants available>0: ${phys.size}`);
  const shop = await fetchShopifyPrices([...phys.keys()]);

  const hits: PhysicalHit[] = [];
  for (const [variantId, meta] of phys) {
    const s = shop.get(variantId);
    if (!s) continue;
    hits.push({
      ...s,
      sku: s.sku ?? meta.sku,
      gtin: (meta.gtin || s.barcode || s.gtin || "").trim() || null,
      physicalQty: meta.qty,
      locationNames: meta.locs,
    });
  }

  const repriced: Row[] = [];
  const noStx: Array<{ gtin: string | null; title: string | null; reason: string }> = [];
  const skipped: Array<{ gtin: string | null; title: string | null; reason: string }> = [];
  const failures: Array<{ gtin: string | null; error: string }> = [];
  let verified = false;

  for (const hit of hits) {
    const gtin = hit.gtin;
    const label = hit.title ?? hit.sku ?? hit.variantId;
    if (!gtin) {
      skipped.push({ gtin: null, title: label, reason: "no GTIN/barcode" });
      continue;
    }
    if (hit.physicalQty <= 0) {
      skipped.push({ gtin, title: label, reason: "no physical stock > 0" });
      continue;
    }
    if (!hit.productId) {
      skipped.push({ gtin, title: label, reason: "missing productId" });
      continue;
    }

    const match = (await getShopifyVariantDetail(hit.variantId)) ?? toVariantDetail(hit);
    if (!match.productId) {
      skipped.push({ gtin, title: label, reason: "Shopify variant detail missing" });
      continue;
    }
    if (isEssentialsShopifyVariant(match) || isInStockFixedPriceProduct({
      sku: match.sku,
      title: match.productTitle,
      productId: match.productId,
    })) {
      skipped.push({ gtin, title: match.productTitle ?? label, reason: "fixed-price registry (Essentials/Bape/boxers/AP) — convergence keeps retail" });
      continue;
    }
    if (isAdminOnlyShopifyVariant(match.variantId, match.productId)) {
      skipped.push({ gtin, title: match.productTitle ?? label, reason: "admin-only product" });
      continue;
    }

    let pricing;
    try {
      pricing = await resolvePhysicalRestockPricing(gtin, {
        slug: match.productHandle,
        sizeEu: match.variantTitle,
      });
    } catch (err: any) {
      failures.push({ gtin, error: err?.message ?? String(err) });
      continue;
    }

    const buyNow = pricing.compareAt;
    const sale = pricing.sellPrice ?? (buyNow != null ? warehouseHalfBuyNowPrice(buyNow) : null);
    if (buyNow == null || buyNow <= 0 || sale == null || sale <= 0) {
      noStx.push({
        gtin,
        title: label,
        reason: `no Buy Now (source=${pricing.source}, stored=${pricing.storedBuyPrice ?? "none"})`,
      });
      continue;
    }
    if (pricing.compareAt !== pricing.buyNowAfterFees) {
      skipped.push({ gtin, title: label, reason: "compareAt is not Buy Now after fees" });
      continue;
    }

    const row: Row = {
      gtin,
      title: match.productTitle ?? hit.title,
      buyNow,
      sale,
      compareAt: buyNow,
      storedBuyPrice: pricing.storedBuyPrice,
      source: pricing.source,
    };

    if (!verified && pricing.stockxRaw != null && pricing.source.startsWith("kickdb")) {
      verified = true;
      console.log(
        [
          "VERIFY",
          `gtin=${gtin}`,
          `kickdbRaw=${pricing.stockxRaw}`,
          `storedDbPrice=${pricing.storedBuyPrice ?? "-"}`,
          `buyNowAfterFees=${buyNow}`,
          `sale=${sale}`,
          `compareAt=${buyNow}`,
          `half=${warehouseHalfBuyNowPrice(buyNow)}`,
        ].join(" ")
      );
    }

    console.log(
      [
        gtin,
        (row.title ?? "").slice(0, 42),
        `qty=${hit.physicalQty}@${hit.locationNames.join(",") || "?"}`,
        `stored=${pricing.storedBuyPrice ?? "-"}`,
        `raw=${pricing.stockxRaw ?? "-"}`,
        `buyNow=${buyNow}`,
        `sale=${sale}`,
        `compareAt=${buyNow}`,
        `src=${pricing.source}`,
      ].join(" | ")
    );

    if (!EXECUTE) {
      repriced.push(row);
      continue;
    }

    try {
      const liq = await applyLiquidationSaleDisplay({
        gtin,
        variant: match,
        slug: match.productHandle,
        sizeEu: match.variantTitle,
      });
      if (!liq.applied) {
        const reason = liq.warnings.join("; ") || "not applied";
        if (/No StockX|StockX pricing/i.test(reason)) {
          noStx.push({ gtin, title: label, reason });
        } else {
          skipped.push({ gtin, title: label, reason });
        }
        continue;
      }
      repriced.push({
        ...row,
        sale: liq.salePrice ?? sale,
        compareAt: liq.referencePrice ?? buyNow,
        buyNow: liq.referencePrice ?? buyNow,
      });
      if (liq.warnings.length) console.log(`  warnings: ${liq.warnings.join("; ")}`);
    } catch (err: any) {
      failures.push({ gtin, error: err?.message ?? String(err) });
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  console.log("\n--- SUMMARY ---");
  console.log(`physical_in_stock: ${hits.length}`);
  console.log(`${EXECUTE ? "repriced" : "would_reprice"}: ${repriced.length}`);
  console.log(`skipped_no_stx:    ${noStx.length}`);
  console.log(`skipped_other:     ${skipped.length}`);
  console.log(`failed:            ${failures.length}`);

  if (repriced.length) {
    console.log("\nSample (5):");
    console.log(["title", "buyNow", "sale", "compareAt"].join("\t"));
    for (const r of repriced.slice(0, 5)) {
      console.log([r.title ?? "", r.buyNow, r.sale, r.compareAt].join("\t"));
    }
  }

  if (noStx.length) {
    console.log("\nNo Buy Now (not inventing a price):");
    for (const s of noStx) console.log(`  ${s.gtin ?? "?"}  ${(s.title ?? "").slice(0, 50)}  — ${s.reason}`);
  }
  if (skipped.length) {
    console.log("\nSkipped:");
    for (const s of skipped) console.log(`  ${s.gtin ?? "?"}  ${(s.title ?? "").slice(0, 50)}  — ${s.reason}`);
  }
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  ${f.gtin ?? "?"}  — ${f.error}`);
  }
  if (!verified) console.log("\nVERIFY: no KickDB live ask in this run");
  if (!EXECUTE) console.log("\nDry-run only. Pass --execute to apply.\n");
}

main()
  .catch(async (err) => {
    console.error("[reprice-physical-buynow-half] fatal", err);
    await prisma.$disconnect();
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
