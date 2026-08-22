/**
 * Lock sell price on every variant with Money Kickz location stock > 0.
 * - Shopify: custom.price_locked = true; boxers clamped to 45
 * - DB: create/update stx_* SupplierVariant manualLock + manualPrice + manualStock
 *
 * Usage: npx tsx scripts/money-kickz-lock-prices.ts --write
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { prisma } from "@/app/lib/prisma";
import { validateGtin } from "@/app/lib/normalize";
import {
  assertMappingIntegrity,
  buildProviderKey,
} from "@/galaxus/supplier/providerKey";
import {
  JMONEY_PRICE_LOCK_NOTE,
  isJmoneyPriceLockNote,
  moneyKickzLocationId,
} from "@/shopify/inventory/locationConfig";
import { gtinCandidates } from "@/shopify/restock/gtinNormalize";

const WRITE = process.argv.includes("--write");
const LOCATION_ID =
  (process.env.SHOPIFY_LOC_MONEY_KICKZ ?? "").trim() || moneyKickzLocationId();
const MANUAL_NOTE = JMONEY_PRICE_LOCK_NOTE;
const BOXER_PRICE = 45;
const BOXER_STOCK = 5;
const BOXER_HANDLES = new Set([
  "supreme-hanes-boxer-briefs-black",
  "supreme-hanes-boxer-briefs-white",
]);

function cleanGtin(raw: string | null | undefined): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  return d.length >= 8 && d.length <= 14 ? d : null;
}

/** Prefer EAN-13 so providerKey matches existing STX_* rows. */
function preferredGtin(raw: string): string | null {
  const cands = gtinCandidates(raw).filter((g) => validateGtin(g));
  if (!cands.length) return null;
  return cands.find((g) => g.length === 13) ?? cands.find((g) => g.length === 12) ?? cands[0]!;
}

async function writeShopifyPrices(
  entries: Array<{ productId: string; variantId: string; price: string }>
) {
  const byProduct = new Map<string, Array<{ id: string; price: string }>>();
  for (const entry of entries) {
    const list = byProduct.get(entry.productId) ?? [];
    list.push({ id: entry.variantId, price: entry.price });
    byProduct.set(entry.productId, list);
  }
  for (const [productId, variants] of byProduct.entries()) {
    const { data, errors } = await shopifyGraphQL<{
      productVariantsBulkUpdate: { userErrors: Array<{ message: string }> };
    }>(
      `mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          userErrors { message }
        }
      }`,
      { productId, variants }
    );
    const ue = data?.productVariantsBulkUpdate?.userErrors ?? [];
    if (errors?.length || ue.length) {
      throw new Error(
        (errors ?? []).map((e) => e.message).join("; ") || ue.map((e) => e.message).join("; ")
      );
    }
  }
}

async function main() {
  if (!LOCATION_ID) {
    console.error("BLOCKER: SHOPIFY_LOC_MONEY_KICKZ missing");
    process.exit(1);
  }

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
    product: {
      id: string;
      handle: string;
      title: string;
      vendor: string | null;
      tags: string[];
    };
  };

  const targets: VariantNode[] = [];
  let cursor: string | null = null;
  let pages = 0;

  for (;;) {
    pages += 1;
    const { data, errors } = await shopifyGraphQL<{
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{
          id: string;
          handle: string;
          title: string;
          vendor: string | null;
          tags: string[];
          variants: { nodes: VariantNode[] };
        }>;
      };
    }>(
      `query($cursor: String, $loc: ID!) {
        products(first: 25, after: $cursor, query: "tag:jmoney-kicks") {
          pageInfo { hasNextPage endCursor }
          nodes {
            id handle title vendor tags
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
        if (qty > 0) {
          targets.push({
            ...v,
            product: {
              id: p.id,
              handle: p.handle,
              title: p.title,
              vendor: p.vendor ?? null,
              tags: p.tags,
            },
          });
        }
      }
    }
    if (!data?.products?.pageInfo?.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor;
    if (pages > 40) break;
  }

  console.log(`MK in-stock variants: ${targets.length}`);

  const report: Array<Record<string, unknown>> = [];
  const priceWrites: Array<{ productId: string; variantId: string; price: string }> = [];
  const warnings: string[] = [];
  let dbLocked = 0;
  let dbCreated = 0;
  let dbMissing = 0;
  let dbSkippedForeign = 0;

  for (const v of targets) {
    const gtin = cleanGtin(v.barcode);
    const mkQty =
      v.inventoryItem.inventoryLevel?.quantities?.find((q) => q.name === "available")
        ?.quantity ?? 0;
    let price = Number(v.price);
    const isBoxer = BOXER_HANDLES.has(v.product.handle);
    if (isBoxer && Number.isFinite(price) && price > BOXER_PRICE) {
      warnings.push(
        `${v.product.handle} ${v.title}: clamp Shopify ${price} → ${BOXER_PRICE}`
      );
      price = BOXER_PRICE;
      priceWrites.push({
        productId: v.product.id,
        variantId: v.id,
        price: BOXER_PRICE.toFixed(2),
      });
    }

    const already =
      String(v.priceLocked?.value ?? "").toLowerCase() === "true" ||
      v.priceLocked?.value === "1";
    const row: Record<string, unknown> = {
      handle: v.product.handle,
      variantId: v.legacyResourceId,
      size: v.title,
      price: v.price,
      lockPrice: price,
      gtin,
      shopifyLocked: WRITE ? true : already,
      mkQty,
    };

    if (gtin && Number.isFinite(price) && price > 0) {
      const aliases = gtinCandidates(gtin);
      const existing = await prisma.supplierVariant.findFirst({
        where: {
          gtin: { in: aliases },
          supplierVariantId: { startsWith: "stx_" },
        },
        orderBy: [{ updatedAt: "desc" }],
        select: {
          id: true,
          supplierVariantId: true,
          manualLock: true,
          manualPrice: true,
          manualStock: true,
          manualNote: true,
        },
      });

      if (existing) {
        row.dbSupplierVariantId = existing.supplierVariantId;
        const note = String(existing.manualNote ?? "");
        const foreignLock =
          existing.manualLock &&
          !isJmoneyPriceLockNote(note) &&
          !/^phase4:liquidation/i.test(note);
        if (foreignLock) {
          row.dbLocked = false;
          row.dbReason = `foreign_db_lock:${note}`;
          dbSkippedForeign += 1;
          warnings.push(
            `${v.product.handle} ${v.title}: DB lock "${note}" — DB untouched`
          );
        } else {
          const stock = isBoxer ? BOXER_STOCK : mkQty;
          if (WRITE) {
            await prisma.supplierVariant.update({
              where: { id: existing.id },
              data: {
                manualLock: true,
                manualPrice: price,
                manualStock: stock,
                manualUpdatedAt: new Date(),
                manualNote: MANUAL_NOTE,
              },
            });
          }
          row.dbLocked = true;
          row.dbManualStock = stock;
          dbLocked += 1;
        }
      } else {
        const canon = preferredGtin(gtin);
        if (!canon) {
          row.dbLocked = false;
          row.dbReason = "invalid_gtin";
          dbMissing += 1;
        } else {
          const stock = isBoxer ? BOXER_STOCK : mkQty;
          const supplierVariantId = `stx_${randomUUID()}`;
          const providerKey = buildProviderKey(canon, supplierVariantId);
          if (!providerKey) {
            row.dbLocked = false;
            row.dbReason = "provider_key_failed";
            dbMissing += 1;
          } else {
            if (WRITE) {
              assertMappingIntegrity({
                supplierVariantId,
                gtin: canon,
                providerKey,
                status: "SUPPLIER_GTIN",
              });
              await prisma.supplierVariant.create({
                data: {
                  supplierVariantId,
                  supplierSku: v.sku?.trim() || v.product.handle,
                  providerKey,
                  gtin: canon,
                  price: price,
                  stock: 0,
                  sizeRaw: v.title,
                  supplierBrand: v.product.vendor || null,
                  supplierProductName: v.product.title,
                  deliveryType: "standard",
                  manualLock: true,
                  manualPrice: price,
                  manualStock: stock,
                  manualUpdatedAt: new Date(),
                  manualNote: MANUAL_NOTE,
                  lastSyncAt: new Date(),
                },
              });
              await prisma.variantMapping.upsert({
                where: { supplierVariantId },
                create: {
                  supplierVariantId,
                  gtin: canon,
                  providerKey,
                  supplierKey: "stx",
                  status: "SUPPLIER_GTIN",
                },
                update: {
                  gtin: canon,
                  providerKey,
                  supplierKey: "stx",
                  status: "SUPPLIER_GTIN",
                },
              });
            }
            row.dbSupplierVariantId = supplierVariantId;
            row.dbLocked = true;
            row.dbCreated = true;
            row.dbManualStock = stock;
            row.dbReason = WRITE ? "created_stx" : "would_create_stx";
            dbCreated += 1;
            dbLocked += 1;
          }
        }
      }
    } else {
      row.dbLocked = false;
      row.dbReason = gtin ? "bad_price" : "no_gtin";
      dbMissing += 1;
    }

    report.push(row);
  }

  const metafields = targets.map((v) => ({
    ownerId: v.id,
    namespace: "custom",
    key: "price_locked",
    type: "boolean",
    value: "true",
  }));

  if (WRITE) {
    if (priceWrites.length > 0) await writeShopifyPrices(priceWrites);
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
          (errors ?? []).map((e) => e.message).join("; ") ||
            ue.map((e) => e.message).join("; ")
        );
      }
    }
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
        shopifyPriceClamps: priceWrites.length,
        dbLocked,
        dbCreated,
        dbMissingNoGtin: dbMissing,
        dbSkippedForeign,
        warnings,
        report,
      },
      null,
      2
    )
  );

  for (const w of warnings) console.warn(`WARN ${w}`);
  console.log(
    JSON.stringify(
      {
        write: WRITE,
        variants: targets.length,
        shopifyPriceClamps: priceWrites.length,
        shopifyLocks: WRITE ? targets.length : report.filter((r) => r.shopifyLocked).length,
        dbLocked,
        dbCreated,
        dbMissingNoGtin: dbMissing,
        dbSkippedForeign,
        warnings: warnings.length,
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
