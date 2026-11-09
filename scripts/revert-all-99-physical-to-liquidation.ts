/**
 * Reprice ALL physical-location variants still at ~99 CHF → liquidation 50%.
 *
 * Broader than `revert-fixed-99-to-liquidation.ts`, which only matched
 * SupplierVariant rows with `manualLock` + `restock:fixed-price` note (~26).
 * This script discovers from live Shopify prices on physical stock
 * (Bussigny / Antica / Lab / Cold Bien, available > 0) — no metafield /
 * price_locked / fixed-price note required.
 *
 * Keep intentional manual 99s:
 *   - adidas Forum Low The Grinch (2023) — GTIN 4067886722040
 *   - adidas Campus 00s Bright Blue Dark Marine — GTIN 4066755739479
 *
 * Usage:
 *   npx tsx scripts/revert-all-99-physical-to-liquidation.ts            # dry-run
 *   npx tsx scripts/revert-all-99-physical-to-liquidation.ts --execute  # live
 */
import "dotenv/config";
import { prisma } from "../app/lib/prisma";
import { shopifyGraphQL } from "../lib/shopifyAdmin";
import { gtinEquals } from "../shopify/restock/gtinNormalize";
import { applyLiquidationSaleDisplay } from "../shopify/restock/liquidationPricing";
import { resolvePhysicalRestockPricing } from "../shopify/restock/physicalRestockPricing";
import {
  getShopifyVariantDetail,
  type ShopifyVariantDetail,
} from "../shopify/restock/shopifyRestockInventory";

const EXECUTE = process.argv.includes("--execute");

/** Intentional fixed 99 — do not touch. */
const EXCLUDE_GTINS = ["4067886722040", "4066755739479", "04066755739479"];

const PHYSICAL_LOCATIONS = [
  { id: "gid://shopify/Location/111267971458", name: "Bussigny" },
  { id: "gid://shopify/Location/111267217794", name: "Antica" },
  { id: "gid://shopify/Location/111267250562", name: "Lab" },
  { id: "gid://shopify/Location/111272100226", name: "Cold Bien" },
];
const PHYSICAL_LOCATION_IDS = PHYSICAL_LOCATIONS.map((l) => l.id);

const NODES_QUERY = /* GraphQL */ `
query RevertAll99Nodes($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on ProductVariant {
      id
      sku
      barcode
      price
      compareAtPrice
      title
      product {
        id
        title
        handle
        status
      }
    }
  }
}
`;

function isExcluded(gtin: string | null | undefined): boolean {
  if (!gtin) return false;
  return EXCLUDE_GTINS.some((ex) => gtinEquals(gtin, ex));
}

function saleFromCompareAt(compareAt: number): number {
  return Math.floor(compareAt * 0.5 * 2) / 2;
}

function isApprox99(price: number | null | undefined): boolean {
  if (price == null || !Number.isFinite(price)) return false;
  return price >= 98.5 && price <= 99.5;
}

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
  price: number;
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
      sourceType: true,
    },
  });

  const byVariant = new Map<
    string,
    { gtin: string | null; sku: string | null; qty: number; locs: string[] }
  >();
  for (const row of stock) {
    // Prefer physical sourceType, but include any positive qty at these locs
    // (mirror sometimes marks rows without sourceType=physical).
    const cur = byVariant.get(row.shopifyVariantId) ?? {
      gtin: row.gtin,
      sku: row.sku,
      qty: 0,
      locs: [],
    };
    cur.qty += Number(row.available ?? 0);
    if (row.locationName && !cur.locs.includes(row.locationName)) {
      cur.locs.push(row.locationName);
    }
    if (!cur.gtin && row.gtin) cur.gtin = row.gtin;
    if (!cur.sku && row.sku) cur.sku = row.sku;
    byVariant.set(row.shopifyVariantId, cur);
  }
  return byVariant;
}

type ShopifyPriceNode = {
  variantId: string;
  productId: string | null;
  sku: string | null;
  barcode: string | null;
  title: string | null;
  handle: string | null;
  status: string | null;
  size: string | null;
  price: number | null;
  compareAt: number | null;
};

async function fetchShopifyPrices(variantIds: string[]): Promise<Map<string, ShopifyPriceNode>> {
  const out = new Map<string, ShopifyPriceNode>();
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
        product?: {
          id: string;
          title: string | null;
          handle: string | null;
          status: string | null;
        } | null;
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
        title: node.product?.title ?? null,
        handle: node.product?.handle ?? null,
        status: node.product?.status ?? null,
        size: node.title ?? null,
        price: Number.isFinite(price as number) ? (price as number) : null,
        compareAt:
          node.compareAtPrice != null && Number.isFinite(Number(node.compareAtPrice))
            ? Number(node.compareAtPrice)
            : null,
      });
    }
    if (i + 50 < variantIds.length) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return out;
}

async function discoverAt99(): Promise<PhysicalHit[]> {
  const phys = await loadPhysicalStockByVariant();
  console.log(`Physical variants with available>0: ${phys.size}`);

  const shop = await fetchShopifyPrices([...phys.keys()]);
  const hits: PhysicalHit[] = [];
  for (const [variantId, meta] of phys) {
    const s = shop.get(variantId);
    if (!s) continue;
    if (!isApprox99(s.price)) continue;
    const gtin = (meta.gtin || s.barcode || "").trim() || null;
    hits.push({
      variantId,
      productId: s.productId,
      sku: s.sku ?? meta.sku,
      barcode: s.barcode,
      gtin,
      title: s.title,
      handle: s.handle,
      status: s.status,
      size: s.size,
      price: s.price as number,
      compareAt: s.compareAt,
      physicalQty: meta.qty,
      locationNames: meta.locs,
    });
  }
  return hits;
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
    onSale: hit.compareAt != null && hit.compareAt > hit.price,
  };
}

async function main() {
  console.log(`\n=== REVERT ALL ~99 PHYSICAL → LIQUIDATION 50% (execute=${EXECUTE}) ===\n`);
  console.log(
    "Discovery: ShopifyVariantLocationStock @ physical locs + live Shopify price ≈ 99"
  );
  console.log("No fixed-price metafield / price_locked / manualNote filter.\n");

  const all = await discoverAt99();
  const excluded = all.filter((c) => isExcluded(c.gtin));
  const targets = all.filter((c) => !isExcluded(c.gtin));

  console.log(`Found at ~99 (physical): ${all.length}`);
  console.log(`Excluded (keep 99):      ${excluded.length}`);
  for (const e of excluded) {
    console.log(`  KEEP  ${e.gtin}  ${e.title ?? ""}  ${e.sku ?? ""}`);
  }
  console.log(`To reprice:              ${targets.length}\n`);

  if (all.length > 30) {
    console.log("First 30 hits:");
    for (const h of all.slice(0, 30)) {
      console.log(
        [
          h.gtin ?? "?",
          h.sku ?? "?",
          (h.title ?? "").slice(0, 40),
          h.price,
          h.compareAt,
          `qty=${h.physicalQty}@${h.locationNames.join(",")}`,
          isExcluded(h.gtin) ? "EXCLUDE" : "",
        ].join(" | ")
      );
    }
    console.log(`... total ${all.length}\n`);
  } else {
    for (const h of all) {
      console.log(
        [
          h.gtin ?? "?",
          h.sku ?? "?",
          (h.title ?? "").slice(0, 40),
          h.price,
          h.compareAt,
          `qty=${h.physicalQty}@${h.locationNames.join(",")}`,
          isExcluded(h.gtin) ? "EXCLUDE" : "",
        ].join(" | ")
      );
    }
    console.log("");
  }

  const repriced: Array<{
    gtin: string;
    sku: string | null;
    title: string | null;
    currentPrice: number;
    currentCompareAt: number | null;
    compareAt: number;
    salePrice: number;
    source: string;
  }> = [];
  const skipped: Array<{ gtin: string | null; name: string | null; reason: string }> = [];
  const noStx: Array<{ gtin: string | null; name: string | null; sku: string | null; reason: string }> =
    [];
  const failures: Array<{ gtin: string | null; error: string }> = [];

  for (const t of targets) {
    const gtin = t.gtin;
    if (!gtin) {
      skipped.push({ gtin: null, name: t.title, reason: "no GTIN/barcode" });
      continue;
    }
    if (t.physicalQty <= 0) {
      skipped.push({ gtin, name: t.title, reason: "no physical stock > 0" });
      continue;
    }
    if (!t.productId) {
      skipped.push({ gtin, name: t.title, reason: "missing productId" });
      continue;
    }

    // Refresh detail (tags etc. needed by applyLiquidationSaleDisplay guards)
    const match = (await getShopifyVariantDetail(t.variantId)) ?? toVariantDetail(t);
    if (!match.productId) {
      skipped.push({ gtin, name: t.title, reason: "Shopify variant detail missing" });
      continue;
    }

    const shopPrice = match.price;
    if (!isApprox99(shopPrice)) {
      skipped.push({
        gtin,
        name: t.title,
        reason: `Shopify price not ~99 (got ${shopPrice})`,
      });
      continue;
    }

    const pricing = await resolvePhysicalRestockPricing(gtin, {
      slug: match.productHandle,
      sizeEu: match.variantTitle,
    });
    const compareAt = pricing.compareAt;
    if (compareAt == null || compareAt <= 0) {
      noStx.push({
        gtin,
        name: t.title,
        sku: t.sku,
        reason: `no StockX/compareAt (source=${pricing.source})`,
      });
      continue;
    }

    const salePrice = saleFromCompareAt(compareAt);
    if (!salePrice || salePrice <= 0 || salePrice >= compareAt) {
      skipped.push({
        gtin,
        name: t.title,
        reason: `invalid salePrice=${salePrice} compareAt=${compareAt}`,
      });
      continue;
    }

    const row = {
      gtin,
      sku: match.sku,
      title: match.productTitle ?? t.title,
      currentPrice: shopPrice!,
      currentCompareAt: match.compareAtPrice,
      compareAt,
      salePrice,
      source: pricing.source,
    };

    console.log(
      [
        gtin,
        match.sku ?? "?",
        (match.productTitle ?? t.title ?? "").slice(0, 45),
        `qty=${t.physicalQty}@${t.locationNames.join(",") || "?"}`,
        `${shopPrice}→${salePrice}`,
        `compareAt ${match.compareAtPrice ?? "?"}→${compareAt}`,
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
        const reason = liq.warnings.join("; ") || "unknown";
        if (/No StockX|StockX pricing/i.test(reason)) {
          noStx.push({ gtin, name: t.title, sku: t.sku, reason });
        } else {
          skipped.push({ gtin, name: t.title, reason: `liq not applied: ${reason}` });
        }
        continue;
      }
      repriced.push({
        ...row,
        compareAt: liq.referencePrice ?? compareAt,
        salePrice: liq.salePrice ?? salePrice,
      });
      if (liq.warnings.length) {
        console.log(`  warnings: ${liq.warnings.join("; ")}`);
      }
    } catch (err: any) {
      failures.push({ gtin, error: err?.message ?? String(err) });
    }

    await new Promise((r) => setTimeout(r, 250));
  }

  console.log("\n--- SUMMARY ---");
  console.log(`found_at_99:     ${all.length}`);
  console.log(`excluded:        ${excluded.length}`);
  console.log(`${EXECUTE ? "repriced" : "would_reprice"}: ${repriced.length}`);
  console.log(`skipped:         ${skipped.length}`);
  console.log(`no_stx:          ${noStx.length}`);
  console.log(`failures:        ${failures.length}`);

  if (repriced.length) {
    console.log("\nSample (up to 30):");
    console.log(["GTIN", "SKU", "Title", "Was", "Sale", "CompareAt", "Src"].join("\t"));
    for (const r of repriced.slice(0, 30)) {
      console.log(
        [
          r.gtin,
          r.sku ?? "",
          (r.title ?? "").slice(0, 40),
          r.currentPrice,
          r.salePrice,
          r.compareAt,
          r.source,
        ].join("\t")
      );
    }
  }

  if (noStx.length) {
    console.log("\nNo StockX price (NOT inventing prices):");
    for (const s of noStx) {
      console.log(
        `  ${s.gtin ?? "?"}  ${s.sku ?? ""}  ${(s.name ?? "").slice(0, 40)}  — ${s.reason}`
      );
    }
  }

  if (skipped.length) {
    console.log("\nSkipped:");
    for (const s of skipped) {
      console.log(`  ${s.gtin ?? "?"}  ${(s.name ?? "").slice(0, 40)}  — ${s.reason}`);
    }
  }
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  ${f.gtin ?? "?"}  — ${f.error}`);
  }

  if (!EXECUTE) {
    console.log("\nDry-run only. Pass --execute to apply.\n");
  }
}

main()
  .catch(async (err) => {
    console.error("[revert-all-99-physical] fatal", err);
    await prisma.$disconnect();
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
