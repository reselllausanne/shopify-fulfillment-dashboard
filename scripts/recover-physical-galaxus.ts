/**
 * Recover ALL physical warehouse pairs onto Galaxus.
 *
 * Physical locations: Bussigny, Antica, Lab, COLD BIEN.
 * Goal: every GTIN with qty>0 in those locs must be feed-eligible.
 *
 * Actions per orphan GTIN:
 *   1. SV exists + mapping exists  → skip (physical merge already handles)
 *   2. SV exists + no mapping      → insert VariantMapping status=SUPPLIER_GTIN
 *   3. No SV at all                → fetch Shopify variant (SKU/size/price),
 *                                    create NER SupplierVariant (price ex VAT,
 *                                    stock=physical qty) + mapping
 *
 * Then triggers a stock-price feed push.
 *
 * Usage:
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 npx tsx scripts/recover-physical-galaxus.ts
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 npx tsx scripts/recover-physical-galaxus.ts --skip-feed
 */
import "dotenv/config";
import { prisma } from "@/app/lib/prisma";
import { validateGtin, normalizeSize, normalizeSku } from "@/app/lib/normalize";
import {
  assertMappingIntegrity,
  buildProviderKey,
} from "@/galaxus/supplier/providerKey";

const VAT_DIVISOR = 1.081;
const FALLBACK_PRICE_CHF = 150; // last-resort sell price if Shopify has none

const PHYSICAL_LOCATION_NAMES = new Set([
  "Warehouse Bussigny",
  "Antica Bottegas",
  "THE LAB CONCEPT STORE",
  "COLD BIEN",
]);

type ShopifyVariantInfo = {
  variantId: string;
  productId: string;
  productHandle: string;
  productTitle: string;
  sku: string | null;
  barcode: string | null;
  price: number | null; // CHF incl VAT
  sizeTitle: string | null;
};

async function shopifyGraphQL<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const shop = process.env.SHOP_NAME_SHOPIFY;
  const token = process.env.ACCESS_TOKEN_SHOPIFY;
  const version = process.env.API_VERSION_SHOPIFY || "2025-01";
  if (!shop || !token) throw new Error("Missing Shopify credentials");
  const res = await fetch(`https://${shop}/admin/api/${version}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Shopify HTTP ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (json.errors) throw new Error(`Shopify GQL errors: ${JSON.stringify(json.errors)}`);
  return json.data as T;
}

const VARIANT_LOOKUP_QUERY = /* GraphQL */ `
  query VariantByGid($id: ID!) {
    productVariant(id: $id) {
      id
      title
      sku
      barcode
      price
      product { id title handle }
    }
  }
`;

async function fetchShopifyVariant(shopifyVariantId: string): Promise<ShopifyVariantInfo | null> {
  const gid = shopifyVariantId.startsWith("gid://")
    ? shopifyVariantId
    : `gid://shopify/ProductVariant/${shopifyVariantId}`;
  const data = await shopifyGraphQL<{
    productVariant: {
      id: string;
      title: string;
      sku: string | null;
      barcode: string | null;
      price: string;
      product: { id: string; title: string; handle: string };
    } | null;
  }>(VARIANT_LOOKUP_QUERY, { id: gid });
  const v = data.productVariant;
  if (!v) return null;
  const priceNum = Number.parseFloat(v.price);
  return {
    variantId: v.id,
    productId: v.product.id,
    productHandle: v.product.handle,
    productTitle: v.product.title,
    sku: v.sku,
    barcode: v.barcode,
    price: Number.isFinite(priceNum) && priceNum > 0 ? priceNum : null,
    sizeTitle: v.title,
  };
}

function sanitizeIdPart(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

function normalizePriceExVat(inclVat: number | null): number {
  const chf = inclVat ?? FALLBACK_PRICE_CHF;
  const ex = chf / VAT_DIVISOR;
  return Math.round(ex * 100) / 100;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const skipFeed = process.argv.includes("--skip-feed");
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number.parseInt(limitArg.split("=")[1], 10) : null;

  console.log("[recover] loading physical mirror rows…");

  const mirrorRows = await prisma.$queryRaw<
    Array<{
      gtin: string;
      qty: bigint;
      sku: string | null;
      shopifyVariantId: string;
      locations: string[];
    }>
  >`
    SELECT
      s."gtin"                                       AS gtin,
      SUM(s."available")::bigint                     AS qty,
      MAX(s."sku")                                   AS sku,
      MAX(s."shopifyVariantId")                      AS "shopifyVariantId",
      array_agg(DISTINCT s."locationName")           AS locations
    FROM "public"."ShopifyVariantLocationStock" s
    WHERE s."sourceType" = 'physical'
      AND s."available"  > 0
      AND s."locationName" = ANY(${Array.from(PHYSICAL_LOCATION_NAMES)}::text[])
      AND s."gtin" IS NOT NULL
      AND TRIM(s."gtin") <> ''
    GROUP BY s."gtin"
    ORDER BY s."gtin"
  `;

  console.log(`[recover] ${mirrorRows.length} physical GTINs with qty>0 at physical locs`);

  const buckets = {
    ok: [] as string[], // has SV + mapping
    needMapping: [] as { gtin: string; supplierVariantId: string; providerKey: string }[],
    needSv: [] as {
      gtin: string;
      normalizedGtin: string;
      qty: number;
      sku: string | null;
      shopifyVariantId: string;
      locations: string[];
    }[],
    invalidGtin: [] as string[],
  };

  // Pre-normalize + drop invalid GTINs in one pass.
  type MirrorNorm = {
    raw: string;
    normalized: string;
    qty: number;
    sku: string | null;
    shopifyVariantId: string;
    locations: string[];
  };
  const normalized: MirrorNorm[] = [];
  for (const row of mirrorRows) {
    const raw = String(row.gtin).trim();
    const norm = raw.replace(/^0+/, "") || raw;
    if (!validateGtin(norm)) {
      buckets.invalidGtin.push(raw);
      continue;
    }
    normalized.push({
      raw,
      normalized: norm,
      qty: Number(row.qty),
      sku: row.sku,
      shopifyVariantId: row.shopifyVariantId,
      locations: row.locations,
    });
  }
  console.log(`[recover] valid GTINs: ${normalized.length}, invalid: ${buckets.invalidGtin.length}`);

  // ONE bulk query: for each candidate GTIN, get best SV + mapping presence.
  const normalizedGtins = normalized.map((n) => n.normalized);
  const bulkRows = await prisma.$queryRaw<
    Array<{
      normalized_gtin: string;
      supplierVariantId: string | null;
      gtin: string | null;
      providerKey: string | null;
      mappingId: string | null;
    }>
  >`
    SELECT DISTINCT ON (regexp_replace(sv."gtin", '^0+', ''))
      regexp_replace(sv."gtin", '^0+', '') AS normalized_gtin,
      sv."supplierVariantId",
      sv."gtin",
      sv."providerKey",
      vm."id" AS "mappingId"
    FROM "public"."SupplierVariant" sv
    LEFT JOIN "public"."VariantMapping" vm
      ON vm."supplierVariantId" = sv."supplierVariantId"
     AND vm."status" IN ('MATCHED','SUPPLIER_GTIN','PARTNER_GTIN')
    WHERE regexp_replace(sv."gtin", '^0+', '') = ANY(${normalizedGtins}::text[])
    ORDER BY regexp_replace(sv."gtin", '^0+', ''),
             (vm."id" IS NULL),                     -- prefer SVs with mapping
             (sv."providerKey" LIKE 'STX_%') DESC,  -- prefer STX rows
             sv."updatedAt" DESC
  `;
  const svByNorm = new Map<
    string,
    { supplierVariantId: string; gtin: string; providerKey: string; hasMapping: boolean }
  >();
  for (const r of bulkRows) {
    if (!r.supplierVariantId || !r.providerKey || !r.gtin || !r.normalized_gtin) continue;
    svByNorm.set(r.normalized_gtin, {
      supplierVariantId: r.supplierVariantId,
      gtin: r.gtin,
      providerKey: r.providerKey,
      hasMapping: r.mappingId != null,
    });
  }

  for (const n of normalized) {
    const sv = svByNorm.get(n.normalized);
    if (!sv) {
      buckets.needSv.push({
        gtin: n.normalized,
        normalizedGtin: n.normalized,
        qty: n.qty,
        sku: n.sku,
        shopifyVariantId: n.shopifyVariantId,
        locations: n.locations,
      });
      continue;
    }
    if (sv.hasMapping) {
      buckets.ok.push(n.normalized);
      continue;
    }
    buckets.needMapping.push({
      gtin: sv.gtin,
      supplierVariantId: sv.supplierVariantId,
      providerKey: sv.providerKey,
    });
  }

  console.log("[recover] classification:", {
    total: mirrorRows.length,
    ok: buckets.ok.length,
    needMapping: buckets.needMapping.length,
    needSv: buckets.needSv.length,
    invalidGtin: buckets.invalidGtin.length,
  });

  if (dryRun) {
    console.log("[recover] --dry-run set, exiting without writes");
    console.log("  sample needMapping:", buckets.needMapping.slice(0, 5));
    console.log("  sample needSv:", buckets.needSv.slice(0, 5));
    return;
  }

  const now = new Date();
  let mappingInserted = 0;
  let svCreated = 0;
  let svSkipped = 0;

  // ---- STEP 1: insert missing mappings for existing SVs ----
  for (const row of buckets.needMapping) {
    try {
      assertMappingIntegrity({
        supplierVariantId: row.supplierVariantId,
        gtin: row.gtin,
        providerKey: row.providerKey,
        status: "SUPPLIER_GTIN",
      });
      const res = await prisma.variantMapping.upsert({
        where: { supplierVariantId: row.supplierVariantId },
        update: {
          gtin: row.gtin,
          providerKey: row.providerKey,
          status: "SUPPLIER_GTIN",
          updatedAt: now,
        },
        create: {
          supplierVariantId: row.supplierVariantId,
          gtin: row.gtin,
          providerKey: row.providerKey,
          status: "SUPPLIER_GTIN",
        },
      });
      if (res) mappingInserted += 1;
    } catch (err) {
      console.warn(
        `[recover] mapping upsert failed sv=${row.supplierVariantId} gtin=${row.gtin}: ${String(
          (err as Error).message
        )}`
      );
    }
  }
  console.log(`[recover] mappings created/updated: ${mappingInserted}/${buckets.needMapping.length}`);

  // ---- STEP 2: create NER SupplierVariant + mapping for orphans ----
  const targets = limit != null ? buckets.needSv.slice(0, limit) : buckets.needSv;
  console.log(`[recover] creating ${targets.length} NER SVs (limit=${limit ?? "none"})…`);

  let idx = 0;
  for (const orphan of targets) {
    idx += 1;
    try {
      // 1. Look up Shopify variant for SKU / size / price.
      const info = await fetchShopifyVariant(orphan.shopifyVariantId);
      const sku = normalizeSku(orphan.sku ?? info?.sku ?? "") ?? orphan.sku ?? info?.sku ?? null;
      if (!sku) {
        console.warn(`[recover] orphan gtin=${orphan.gtin} skipped: no SKU`);
        svSkipped += 1;
        continue;
      }
      const sizeRaw = info?.sizeTitle ?? "";
      const sizeNormalized = normalizeSize(sizeRaw) ?? sizeRaw ?? "OS";
      const priceExVat = normalizePriceExVat(info?.price ?? null);

      const supplierVariantId = `ner:${sanitizeIdPart(sku)}-${sanitizeIdPart(sizeNormalized || "OS")}`;
      const providerKey = buildProviderKey(orphan.gtin, supplierVariantId);
      if (!providerKey) {
        console.warn(`[recover] orphan gtin=${orphan.gtin} skipped: providerKey null`);
        svSkipped += 1;
        continue;
      }

      // 2. Upsert SupplierVariant.
      const existing = await prisma.supplierVariant.findUnique({
        where: { supplierVariantId },
      });
      if (existing) {
        await prisma.supplierVariant.update({
          where: { supplierVariantId },
          data: {
            gtin: orphan.gtin,
            providerKey,
            price: priceExVat,
            stock: orphan.qty,
            supplierSku: sku,
            sizeRaw,
            sizeNormalized,
            lastSyncAt: now,
            updatedAt: now,
          },
        });
      } else {
        try {
          await prisma.supplierVariant.create({
            data: {
              supplierVariantId,
              supplierSku: sku,
              providerKey,
              gtin: orphan.gtin,
              price: priceExVat,
              stock: orphan.qty,
              sizeRaw,
              sizeNormalized,
              lastSyncAt: now,
            },
          });
          svCreated += 1;
        } catch (err) {
          // race with another creator → update instead
          console.warn(
            `[recover] create fallback update sv=${supplierVariantId}: ${String((err as Error).message)}`
          );
          await prisma.supplierVariant.update({
            where: { supplierVariantId },
            data: {
              gtin: orphan.gtin,
              providerKey,
              price: priceExVat,
              stock: orphan.qty,
              lastSyncAt: now,
              updatedAt: now,
            },
          });
        }
      }

      // 3. Upsert mapping.
      assertMappingIntegrity({
        supplierVariantId,
        gtin: orphan.gtin,
        providerKey,
        status: "SUPPLIER_GTIN",
      });
      await prisma.variantMapping.upsert({
        where: { supplierVariantId },
        update: {
          gtin: orphan.gtin,
          providerKey,
          status: "SUPPLIER_GTIN",
          updatedAt: now,
        },
        create: {
          supplierVariantId,
          gtin: orphan.gtin,
          providerKey,
          status: "SUPPLIER_GTIN",
        },
      });

      if (idx % 10 === 0) {
        console.log(`[recover] progress ${idx}/${targets.length} last=${orphan.gtin}`);
      }
    } catch (err) {
      console.warn(
        `[recover] orphan gtin=${orphan.gtin} FAILED: ${String((err as Error).message)}`
      );
      svSkipped += 1;
    }
  }

  console.log("[recover] SV recovery done:", { svCreated, svSkipped, mappingInserted });

  // ---- STEP 3: trigger Galaxus feed push ----
  if (skipFeed) {
    console.log("[recover] --skip-feed set, not triggering feed");
    return;
  }

  console.log("[recover] triggering stock-price feed push…");
  try {
    const baseUrl = process.env.OPS_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || "https://resell.ch";
    const res = await fetch(`${baseUrl}/api/galaxus/ops/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "push-stock-price" }),
    });
    const body = await res.text();
    console.log(`[recover] ops response: ${res.status} ${body.slice(0, 400)}`);
  } catch (err) {
    console.warn(`[recover] ops push failed: ${String((err as Error).message)}`);
    console.warn("[recover] fallback: SSH to VPS and run bash scripts/galaxus-ops-cron.sh full-flow");
  }

  console.log("[recover] done");
}

main()
  .catch((err) => {
    console.error("[recover] fatal:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
