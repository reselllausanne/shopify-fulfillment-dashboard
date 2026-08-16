/**
 * Lock sell price on every variant with Money Kickz location stock > 0.
 * - Shopify: custom.price_locked = true
 * - DB: SupplierVariant.manualLock + manualPrice when GTIN maps to a row
 *
 * Usage: npx tsx scripts/money-kickz-lock-prices.ts --write
 */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { prisma } from "@/app/lib/prisma";

const WRITE = process.argv.includes("--write");
const LOCATION_ID = (process.env.SHOPIFY_LOC_MONEY_KICKZ ?? "").trim();
const MANUAL_NOTE = "jmoney-kicks:price-lock";

function cleanGtin(raw: string | null | undefined): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  return d.length >= 8 && d.length <= 14 ? d : null;
}

async function main() {
  if (!LOCATION_ID) {
    console.error("BLOCKER: SHOPIFY_LOC_MONEY_KICKZ missing");
    process.exit(1);
  }

  const report: Array<Record<string, unknown>> = [];
  let cursor: string | null = null;
  let pages = 0;

  type VariantNode = {
    id: string;
    legacyResourceId: string;
    title: string;
    price: string;
    sku: string | null;
    barcode: string | null;
    priceLocked: { value: string | null } | null;
    inventoryItem: {
      id: string;
      inventoryLevel: {
        quantities: Array<{ name: string; quantity: number }>;
      } | null;
    };
    product: { id: string; handle: string; title: string; tags: string[] };
  };

  const targets: VariantNode[] = [];

  // Prefer tagged products, then fall back to inventory scan via product search
  for (;;) {
    pages += 1;
    const { data, errors } = await shopifyGraphQL<{
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{
          id: string;
          handle: string;
          title: string;
          tags: string[];
          variants: { nodes: VariantNode[] };
        }>;
      };
    }>(
      `query($cursor: String, $loc: ID!) {
        products(first: 25, after: $cursor, query: "tag:jmoney-kicks") {
          pageInfo { hasNextPage endCursor }
          nodes {
            id handle title tags
            variants(first: 100) {
              nodes {
                id legacyResourceId title price sku barcode
                priceLocked: metafield(namespace: "custom", key: "price_locked") { value }
                inventoryItem {
                  id
                  inventoryLevel(locationId: $loc) {
                    quantities(names: ["available"]) { name quantity }
                  }
                }
                product { id handle title tags }
              }
            }
          }
        }
      }`,
      { cursor, loc: LOCATION_ID }
    );
    if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
    for (const p of data?.products?.nodes ?? []) {
      for (const v of p.variants.nodes) {
        const qty =
          v.inventoryItem.inventoryLevel?.quantities?.find((q) => q.name === "available")
            ?.quantity ?? 0;
        if (qty > 0) targets.push({ ...v, product: { id: p.id, handle: p.handle, title: p.title, tags: p.tags } });
      }
    }
    if (!data?.products?.pageInfo?.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor;
    if (pages > 40) break;
  }

  console.log(`MK in-stock variants: ${targets.length}`);

  // Batch metafields
  const metafields = targets.map((v) => ({
    ownerId: v.id,
    namespace: "custom",
    key: "price_locked",
    type: "boolean",
    value: "true",
  }));

  if (WRITE) {
    for (let i = 0; i < metafields.length; i += 25) {
      const chunk = metafields.slice(i, i + 25);
      const { data, errors } = await shopifyGraphQL<{
        metafieldsSet: { userErrors: Array<{ message: string }> };
      }>(
        `mutation($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) { userErrors { message } }
        }`,
        { metafields: chunk }
      );
      const ue = data?.metafieldsSet?.userErrors ?? [];
      if (errors?.length || ue.length) {
        throw new Error(
          (errors ?? []).map((e) => e.message).join("; ") || ue.map((e) => e.message).join("; ")
        );
      }
    }
  }

  const prismaAny = prisma as any;
  let dbLocked = 0;
  let dbMissing = 0;

  for (const v of targets) {
    const gtin = cleanGtin(v.barcode);
    const price = Number(v.price);
    const already =
      String(v.priceLocked?.value ?? "").toLowerCase() === "true" ||
      v.priceLocked?.value === "1";
    const row: Record<string, unknown> = {
      handle: v.product.handle,
      variantId: v.legacyResourceId,
      size: v.title,
      price: v.price,
      gtin,
      shopifyLocked: WRITE ? true : already,
      mkQty:
        v.inventoryItem.inventoryLevel?.quantities?.find((q) => q.name === "available")
          ?.quantity ?? 0,
    };

    if (gtin && Number.isFinite(price) && price > 0) {
      const existing = await prismaAny.supplierVariant.findFirst({
        where: { gtin },
        orderBy: [{ updatedAt: "desc" }],
        select: {
          id: true,
          supplierVariantId: true,
          manualLock: true,
          manualPrice: true,
          manualNote: true,
        },
      });
      if (existing) {
        row.dbSupplierVariantId = existing.supplierVariantId;
        if (WRITE) {
          await prismaAny.supplierVariant.update({
            where: { id: existing.id },
            data: {
              manualLock: true,
              manualPrice: price,
              manualUpdatedAt: new Date(),
              manualNote: MANUAL_NOTE,
            },
          });
        }
        row.dbLocked = true;
        dbLocked += 1;
      } else {
        // Never create synthetic JMONEY_/phy_jmoney_ catalog rows — Shopify lock only.
        row.dbLocked = false;
        row.dbReason = "no_existing_supplier_variant";
        dbMissing += 1;
      }
    } else {
      row.dbLocked = false;
      row.dbReason = gtin ? "bad_price" : "no_gtin";
      dbMissing += 1;
    }

    report.push(row);
  }

  const outDir = path.join(process.cwd(), "tmp/money-kickz");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "lock-prices.json");
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        write: WRITE,
        locationId: LOCATION_ID,
        count: targets.length,
        dbLocked,
        dbMissingNoGtin: dbMissing,
        report,
      },
      null,
      2
    )
  );

  console.log(
    JSON.stringify(
      {
        write: WRITE,
        variants: targets.length,
        shopifyLocks: WRITE ? targets.length : report.filter((r) => r.shopifyLocked).length,
        dbLocked,
        dbMissingNoGtin: dbMissing,
        outPath,
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
