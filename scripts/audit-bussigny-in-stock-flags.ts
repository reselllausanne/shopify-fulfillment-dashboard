import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../app/lib/prisma";
import { shopifyGraphQL } from "../lib/shopifyAdmin";
import { findShopifyVariantByGtin } from "../shopify/restock/shopifyRestockInventory";
import { resolvePhysicalRestockPricing } from "../shopify/restock/physicalRestockPricing";
import { BUSSIGNY_LOCATION_ID } from "../shopify/restock/bussignyDeliveryMetafield";

const VARIANT_META_QUERY = /* GraphQL */ `
query VariantLocks($id: ID!) {
  productVariant(id: $id) {
    id
    sku
    price
    compareAtPrice
    product {
      id
      soldes48h: metafield(namespace: "custom", key: "soldes_48h") { value }
    }
    priceLocked: metafield(namespace: "custom", key: "price_locked") { value }
    delivery48h: metafield(namespace: "custom", key: "delivery_48h") { value }
  }
}
`;

function esc(v: unknown): string {
  const x = String(v ?? "");
  return x.includes(",") || x.includes('"') ? `"${x.replace(/"/g, '""')}"` : x;
}

async function main() {
  const rows = await prisma.$queryRaw<
    Array<{ gtin: string; sku: string | null; available: number; shopifyVariantId: string | null }>
  >`
    SELECT DISTINCT ON (s."gtin")
      s."gtin"              AS gtin,
      s."sku"               AS sku,
      s."available"         AS available,
      s."shopifyVariantId"  AS "shopifyVariantId"
    FROM "public"."ShopifyVariantLocationStock" s
    WHERE s."locationId" = ${BUSSIGNY_LOCATION_ID}
      AND s."sourceType" = 'physical'
      AND s."available"  > 0
      AND s."gtin" IS NOT NULL
      AND length(trim(s."gtin")) > 0
    ORDER BY s."gtin", s."priority" ASC, s."updatedAt" DESC
  `;

  const out: Array<Record<string, unknown>> = [];
  let priceLocked = 0;
  let delivery48h = 0;
  let pricingOk = 0;
  let dbManualLock = 0;
  let missingDelivery48h = 0;
  let missingPriceLock = 0;
  let soldes48hMetafield = 0;
  let missingSoldes48hMetafield = 0;

  for (const row of rows) {
    const pricing = await resolvePhysicalRestockPricing(row.gtin);
    const hasPricing = Boolean(pricing.sellPrice && pricing.compareAt);
    if (hasPricing) pricingOk += 1;

    const suppliers = await prisma.supplierVariant.findMany({
      where: { gtin: row.gtin },
      select: { supplierVariantId: true, manualLock: true },
    });
    const anyManual = suppliers.some((s) => s.manualLock);
    if (anyManual) dbManualLock += 1;

    let record: Record<string, unknown> = {
      gtin: row.gtin,
      sku: row.sku,
      bussigny_qty: row.available,
      pricing_source: pricing.source,
      expected_sell: pricing.sellPrice ?? "",
      expected_compare_at: pricing.compareAt ?? "",
      has_pricing: hasPricing,
      db_manual_lock: anyManual,
      stx_rows: suppliers.filter((s) => s.supplierVariantId.startsWith("stx_")).length,
    };

    try {
      const { match, ambiguous } = await findShopifyVariantByGtin(row.gtin);
      if (!match?.variantId) {
        record.error = "shopify variant not found";
      } else {
        const { data, errors } = await shopifyGraphQL<{
          productVariant: {
            sku: string | null;
            price: string | null;
            compareAtPrice: string | null;
            product: { id: string; soldes48h: { value: string | null } | null } | null;
            priceLocked: { value: string | null } | null;
            delivery48h: { value: string | null } | null;
          } | null;
        }>(VARIANT_META_QUERY, { id: match.variantId });
        if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
        const v = data?.productVariant;
        const locked = String(v?.priceLocked?.value ?? "").toLowerCase() === "true";
        const d48 = String(v?.delivery48h?.value ?? "").toLowerCase() === "true";
        const mf48 =
          String(v?.product?.soldes48h?.value ?? "").toLowerCase() === "true";
        if (locked) priceLocked += 1;
        else missingPriceLock += 1;
        if (d48) delivery48h += 1;
        else missingDelivery48h += 1;
        if (mf48) soldes48hMetafield += 1;
        else missingSoldes48hMetafield += 1;

        record = {
          ...record,
          sku: v?.sku ?? row.sku,
          shopify_price: v?.price,
          shopify_compare_at: v?.compareAtPrice,
          price_locked: locked,
          delivery_48h: d48,
          soldes_48h: mf48,
          ambiguous_gtin: ambiguous,
        };
      }
    } catch (err: any) {
      record.error = err?.message ?? String(err);
    }
    out.push(record);
  }

  const summary = {
    bussigny_location_id: BUSSIGNY_LOCATION_ID,
    total_bussigny_in_stock: rows.length,
    shopify_price_locked: priceLocked,
    shopify_missing_price_lock: missingPriceLock,
    shopify_delivery_48h: delivery48h,
    shopify_missing_delivery_48h: missingDelivery48h,
    shopify_soldes_48h: soldes48hMetafield,
    shopify_missing_soldes_48h: missingSoldes48hMetafield,
    resolver_has_pricing: pricingOk,
    resolver_no_pricing: rows.length - pricingOk,
    db_manual_lock: dbManualLock,
  };

  console.log(JSON.stringify(summary, null, 2));

  const header = [
    "gtin",
    "sku",
    "bussigny_qty",
    "shopify_price",
    "shopify_compare_at",
    "expected_sell",
    "expected_compare_at",
    "has_pricing",
    "price_locked",
    "delivery_48h",
    "soldes_48h",
    "db_manual_lock",
    "pricing_source",
    "stx_rows",
    "ambiguous_gtin",
    "error",
  ];
  const lines = [
    header.join(","),
    ...out.map((r) => header.map((h) => esc(r[h])).join(",")),
  ];

  const outPath = path.join(process.cwd(), "artifacts/bussigny-in-stock-audit.csv");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join("\n") + "\n");
  console.log("wrote", outPath);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
