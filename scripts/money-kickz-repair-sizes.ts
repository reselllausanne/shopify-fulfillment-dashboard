/**
 * Repair Money Kickz bootstrap: exact clothing size match (avoid XL⊃L bug).
 * Usage: npx tsx scripts/money-kickz-repair-sizes.ts --write
 */
import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { setInventoryQuantity } from "@/shopify/catalog/graphql";

const WRITE = process.argv.includes("--write");
const LOCATION_ID = (process.env.SHOPIFY_LOC_MONEY_KICKZ ?? "").trim();
const BUFFER = Number(process.env.SUPPLIER_STOCK_BUFFER ?? "2");
const MAX_PER = Number(process.env.SUPPLIER_STOCK_MAX_PER_VARIANT ?? "5");

function shopifyQty(raw: number): number {
  return Math.min(Math.max(raw - BUFFER, 0), MAX_PER);
}

function retailChf(costUsd: number, brand: string, title: string): number {
  const b = brand.toLowerCase();
  const t = title.toLowerCase();
  if (b.includes("bape") && /tee|t-shirt|t shirt/.test(t) && costUsd === 40) return 89;
  if (costUsd === 50) return 99;
  return Math.round(costUsd * 2 * 100) / 100;
}

function costChfApprox(costUsd: number): number {
  const fx = Number(process.env.USD_CHF_RATE ?? "0.88");
  return Math.round(costUsd * fx * 100) / 100;
}

function normalizeSize(size: string): string {
  const s = size.trim().toLowerCase();
  if (/^6-12/.test(s) || s === "one size" || s === "os" || s === "o/s") return "one size";
  return s.replace(/\s+/g, " ");
}

function exactSizeMatch(a: string, b: string): boolean {
  return normalizeSize(a) === normalizeSize(b);
}

type Report = {
  results: Array<{
    product: string;
    shopifyProductId: string | null;
    supplierCostUsd: number;
    retailChf: number;
    variants: Array<{ size: string; supplierQty: number; shopifyQty: number }>;
  }>;
};

async function loadProduct(id: string) {
  const { data, errors } = await shopifyGraphQL<{
    product: {
      id: string;
      title: string;
      vendor: string;
      variants: {
        nodes: Array<{
          id: string;
          title: string | null;
          price: string | null;
          selectedOptions: Array<{ name: string; value: string }>;
          inventoryItem: { id: string } | null;
        }>;
      };
    } | null;
  }>(
    `query($id: ID!) {
      product(id: $id) {
        id title vendor
        variants(first: 100) {
          nodes {
            id title price
            selectedOptions { name value }
            inventoryItem { id }
          }
        }
      }
    }`,
    { id }
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  return data?.product ?? null;
}

function findExact(
  nodes: Array<{
    id: string;
    title: string | null;
    selectedOptions: Array<{ name: string; value: string }>;
    inventoryItem: { id: string } | null;
    price: string | null;
  }>,
  size: string
) {
  const wanted = normalizeSize(size);
  for (const v of nodes) {
    const opt =
      v.selectedOptions.find((o) => /size|taille/i.test(o.name))?.value ?? v.title ?? "";
    if (exactSizeMatch(opt, wanted)) return v;
    if (wanted === "one size" && nodes.length === 1) return v;
  }
  return null;
}

async function main() {
  if (!LOCATION_ID) throw new Error("SHOPIFY_LOC_MONEY_KICKZ missing");
  const reportPath = path.join(
    process.cwd(),
    "tmp/money-kickz/bootstrap-write-2026-08-08.json"
  );
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as Report;
  const repairs: unknown[] = [];

  for (const row of report.results) {
    if (!row.shopifyProductId) continue;
    const product = await loadProduct(row.shopifyProductId);
    if (!product) continue;
    const price = row.retailChf;
    const cost = costChfApprox(row.supplierCostUsd);

    for (const vo of row.variants) {
      const variant = findExact(product.variants.nodes, vo.size);
      if (!variant) {
        repairs.push({ product: row.product, size: vo.size, status: "MISSING_VARIANT" });
        continue;
      }
      const qty = shopifyQty(vo.supplierQty);
      const currentPrice = Number(variant.price);
      const needsPrice = !Number.isFinite(currentPrice) || Math.abs(currentPrice - price) > 0.01;

      // Always re-set price + MK stock with exact match
      if (WRITE) {
        if (needsPrice || true) {
          await shopifyGraphQL(
            `mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
              productVariantsBulkUpdate(productId: $productId, variants: $variants) {
                userErrors { message }
              }
            }`,
            {
              productId: product.id,
              variants: [
                {
                  id: variant.id,
                  price: price.toFixed(2),
                  inventoryItem: { tracked: true, cost: cost.toFixed(2) },
                },
              ],
            }
          );
        }
        if (!variant.inventoryItem?.id) {
          repairs.push({ product: row.product, size: vo.size, status: "NO_INV_ITEM" });
          continue;
        }
        await setInventoryQuantity({
          inventoryItemId: variant.inventoryItem.id,
          locationId: LOCATION_ID,
          quantity: qty,
        });
      }
      repairs.push({
        product: row.product,
        size: vo.size,
        variantId: variant.id,
        price,
        qty,
        prevPrice: currentPrice,
        fixed: WRITE,
      });
      console.log(
        `${WRITE ? "FIXED" : "WOULD"} ${row.product} ${vo.size} → ${price} CHF qty=${qty} (was ${currentPrice})`
      );
    }
  }

  const out = path.join(process.cwd(), "tmp/money-kickz/repair-sizes-2026-08-08.json");
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ write: WRITE, repairs }, null, 2));
  console.log("Wrote", out, "n=", repairs.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
