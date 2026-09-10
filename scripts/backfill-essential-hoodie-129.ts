/**
 * One-shot: enforce 129 CHF on Light Heather + FW24 Black Essential Hoodies (adult SKUs only).
 * Usage: npx tsx scripts/backfill-essential-hoodie-129.ts
 */
import "dotenv/config";
import { prisma } from "../app/lib/prisma";
import { convergeVariant } from "../shopify/inventory/convergence";
import { findShopifyVariantByGtin } from "../shopify/restock/shopifyRestockInventory";
import {
  ESSENTIALS_HOODIE_EXPRESS_CHF,
  ESSENTIALS_HOODIE_SELL_CHF,
  resolveInStockFixedPriceRule,
} from "../shopify/inventory/inStockFixedPrice";
import { writeShopifyExpressPriceMetafield } from "../shopify/restock/liquidationExpressPrice";
import { shopifyGraphQL } from "../lib/shopifyAdmin";

const HOODIE_SKU_BASES = ["192HO246258F", "192HO246250F"];

/** Kids hoodies accidentally repriced during first backfill — restore shelf prices. */
const KIDS_REVERT: Array<{ gtin: string; price: number }> = [
  { gtin: "198437236861", price: 229 },
  { gtin: "198437236878", price: 209 },
  { gtin: "460035798769", price: 329 },
];

function normalizeSkuBase(sku: string | null | undefined): string | null {
  const raw = String(sku ?? "").trim().toUpperCase();
  if (!raw) return null;
  const base = raw.split("-")[0] ?? raw;
  return base || null;
}

function isAdultEssentialHoodieSku(sku: string | null | undefined): boolean {
  const base = normalizeSkuBase(sku);
  return base != null && HOODIE_SKU_BASES.includes(base);
}

const VARIANT_PRICE_MUTATION = /* GraphQL */ `
mutation HoodieRevertPrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    userErrors { field message }
  }
}
`;

async function revertKidsHoodie(gtin: string, price: number): Promise<string[]> {
  const changes: string[] = [];
  const { match } = await findShopifyVariantByGtin(gtin);
  if (!match?.variantId || !match.productId) {
    changes.push(`skip ${gtin}: no Shopify match`);
    return changes;
  }

  const { errors, data } = await shopifyGraphQL<{
    productVariantsBulkUpdate: { userErrors: Array<{ message: string }> };
  }>(VARIANT_PRICE_MUTATION, {
    productId: match.productId,
    variants: [{ id: match.variantId, price: price.toFixed(2), compareAtPrice: null }],
  });
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  const ue = data?.productVariantsBulkUpdate?.userErrors ?? [];
  if (ue.length) throw new Error(ue.map((e) => e.message).join("; "));
  changes.push(`reverted ${match.sku} shelf → ${price}`);

  const stx = await prisma.supplierVariant.findFirst({
    where: { gtin, supplierVariantId: { startsWith: "stx_" } },
    select: { id: true, manualNote: true },
  });
  if (stx && /in-stock:fixed-price/i.test(String(stx.manualNote ?? ""))) {
    await prisma.supplierVariant.update({
      where: { id: stx.id },
      data: {
        manualLock: false,
        manualPrice: null,
        manualNote: "phase4:dropship (revert accidental hoodie 129 lock)",
        manualUpdatedAt: new Date(),
      },
    });
    changes.push(`cleared DB fixed-price lock for ${gtin}`);
  }

  return changes;
}

async function main() {
  console.log("=== Revert accidental kids hoodie repricing ===");
  for (const row of KIDS_REVERT) {
    try {
      const changes = await revertKidsHoodie(row.gtin, row.price);
      console.log(JSON.stringify({ gtin: row.gtin, changes }));
    } catch (e: unknown) {
      console.error(JSON.stringify({ gtin: row.gtin, error: e instanceof Error ? e.message : String(e) }));
    }
  }

  const rows = await prisma.$queryRaw<
    Array<{ gtin: string; name: string | null }>
  >`
    SELECT DISTINCT sv.gtin, sv."supplierProductName" AS name
    FROM "SupplierVariant" sv
    WHERE sv."supplierVariantId" LIKE 'stx\\_%' ESCAPE '\\'
      AND sv.gtin IS NOT NULL
      AND (
        sv."supplierProductName" ILIKE '%192HO246258F%'
        OR sv."supplierProductName" ILIKE '%192HO246250F%'
        OR sv."supplierProductName" ILIKE '%Fleece Hoodie Light Heather Gray%'
        OR sv."supplierProductName" ILIKE '%Fleece Hoodie (FW24) Black%'
      )
    ORDER BY sv.gtin
  `;

  console.log(`\n=== Adult hoodie candidates: ${rows.length} ===`);

  let ok = 0;
  let skip = 0;
  let fail = 0;

  for (const row of rows) {
    try {
      const { match } = await findShopifyVariantByGtin(row.gtin);
      if (!match) {
        skip += 1;
        continue;
      }
      if (!isAdultEssentialHoodieSku(match.sku)) {
        skip += 1;
        continue;
      }

      const rule = resolveInStockFixedPriceRule({
        sku: match.sku,
        title: match.productTitle,
        productId: match.productId,
      });
      if (!rule?.label.includes("Hoodie")) {
        skip += 1;
        continue;
      }

      const res = await convergeVariant(row.gtin, { postPhysicalRestock: true });
      let expressChanged = false;
      if (match.variantId) {
        await writeShopifyExpressPriceMetafield(match.variantId, ESSENTIALS_HOODIE_EXPRESS_CHF);
        expressChanged = true;
      }

      console.log(
        JSON.stringify({
          gtin: row.gtin,
          sku: match.sku,
          title: match.productTitle,
          beforePrice: match.price,
          sellTarget: ESSENTIALS_HOODIE_SELL_CHF,
          expressTarget: ESSENTIALS_HOODIE_EXPRESS_CHF,
          changed: res.changed || expressChanged,
          changes: [
            ...res.changes,
            expressChanged ? `express_price=${ESSENTIALS_HOODIE_EXPRESS_CHF} (direct)` : null,
          ].filter(Boolean),
          warnings: res.warnings,
        })
      );
      ok += 1;
    } catch (e: unknown) {
      fail += 1;
      console.error(JSON.stringify({ gtin: row.gtin, error: e instanceof Error ? e.message : String(e) }));
    }
  }

  console.log(JSON.stringify({ ok, skip, fail }));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
