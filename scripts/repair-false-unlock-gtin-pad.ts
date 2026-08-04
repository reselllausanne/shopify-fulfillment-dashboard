/**
 * Repair false liquidation unlocks caused by GTIN padding mismatch.
 *
 * Symptom: converge saw liq-lane qty=0 (STX gtin `196…` vs mirror `0196…`),
 * wrote `phase4:dropship (bussigny=0)` / `(physical=0)`, cleared manualLock /
 * price_locked / delivery_48h / soldes price — while warehouse stock still
 * sat at Bussigny/Lab/COLD.
 *
 * Cohort: stx_ rows with recent phase4:dropship note + liq-lane physical > 0
 * when matching via gtinCandidates (padding-tolerant).
 *
 * Repair: convergeVariant(gtin, { postPhysicalRestock: true }) — reuses
 * resolvePhysicalRestockPricing / liquidation + express_price path. No invented prices.
 *
 * Usage:
 *   npx tsx scripts/repair-false-unlock-gtin-pad.ts           # dry-run (default)
 *   npx tsx scripts/repair-false-unlock-gtin-pad.ts --write   # apply
 *   npx tsx scripts/repair-false-unlock-gtin-pad.ts --audit-only
 */
import "dotenv/config";
import { prisma } from "@/app/lib/prisma";
import { convergeVariant } from "@/shopify/inventory/convergence";
import {
  LIQUIDATION_LOCATION_IDS,
  ONLINE_LOCATION,
} from "@/shopify/inventory/locationConfig";
import { isAdminOnlyShopifyVariant } from "@/shopify/protection/adminOnlyProducts";
import { isEssentialsShopifyVariant } from "@/shopify/inventory/essentialsProduct";
import { gtinCandidates } from "@/shopify/restock/gtinNormalize";
import {
  calcLiquidationExpressSellPrice,
  parseExpressPriceMetafieldAmount,
  readLiquidationExpressSurchargeChf,
} from "@/shopify/restock/liquidationExpressPrice";
import { resolvePhysicalRestockPricing } from "@/shopify/restock/physicalRestockPricing";
import {
  findShopifyVariantByGtin,
  getInventoryAvailableAtLocation,
  getShopifyVariantDetail,
} from "@/shopify/restock/shopifyRestockInventory";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";

const WRITE = process.argv.includes("--write");
const AUDIT_ONLY = process.argv.includes("--audit-only");
const DRY_RUN = !WRITE;

const VARIANT_META_QUERY = /* GraphQL */ `
query RepairFalseUnlockMeta($id: ID!) {
  productVariant(id: $id) {
    id
    price
    compareAtPrice
    barcode
    priceLocked: metafield(namespace: "custom", key: "price_locked") { value }
    delivery48h: metafield(namespace: "custom", key: "delivery_48h") { value }
    expressPrice: metafield(namespace: "custom", key: "express_price") { value }
  }
}
`;

type CohortRow = {
  id: string;
  gtin: string;
  supplierVariantId: string;
  manualLock: boolean;
  manualPrice: unknown;
  manualNote: string | null;
  manualUpdatedAt: Date | null;
};

type LocQty = { locationId: string; locationName: string; available: number; gtin: string };

function gtinNormKey(raw: string): string {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (!d) return "";
  return d.replace(/^0+/, "") || "0";
}

async function loadCohort(): Promise<CohortRow[]> {
  const rows = await prisma.$queryRaw<CohortRow[]>`
    SELECT
      sv.id,
      sv.gtin,
      sv."supplierVariantId",
      sv."manualLock",
      sv."manualPrice",
      sv."manualNote",
      sv."manualUpdatedAt"
    FROM "public"."SupplierVariant" sv
    WHERE sv."supplierVariantId" LIKE 'stx\\_%' ESCAPE '\\'
      AND sv.gtin IS NOT NULL
      AND TRIM(sv.gtin) <> ''
      AND sv."manualLock" = false
      AND sv."manualNote" LIKE 'phase4:dropship%'
      AND sv."manualUpdatedAt" >= NOW() - INTERVAL '30 days'
      AND EXISTS (
        SELECT 1
        FROM "public"."ShopifyVariantLocationStock" s
        WHERE s."sourceType" = 'physical'
          AND s."locationId" = ANY(${LIQUIDATION_LOCATION_IDS}::text[])
          AND s."available" > 0
          AND NULLIF(REGEXP_REPLACE(COALESCE(s.gtin, ''), '^0+', ''), '')
            = NULLIF(REGEXP_REPLACE(COALESCE(sv.gtin, ''), '^0+', ''), '')
      )
    ORDER BY sv."manualUpdatedAt" DESC NULLS LAST
  `;
  return rows;
}

async function mirrorLocQtys(gtin: string): Promise<LocQty[]> {
  const cands = gtinCandidates(gtin);
  if (cands.length === 0) return [];
  return prisma.$queryRaw<LocQty[]>`
    SELECT
      s."locationId",
      s."locationName",
      s."available"::int AS available,
      s.gtin
    FROM "public"."ShopifyVariantLocationStock" s
    WHERE s.gtin = ANY(${cands}::text[])
      AND s."available" > 0
    ORDER BY s."priority" ASC
  `;
}

async function sumLiqLane(gtin: string): Promise<number> {
  const cands = gtinCandidates(gtin);
  if (cands.length === 0) return 0;
  const rows = await prisma.$queryRaw<Array<{ available: number }>>`
    SELECT COALESCE(SUM(s."available"), 0)::int AS available
    FROM "public"."ShopifyVariantLocationStock" s
    WHERE s.gtin = ANY(${cands}::text[])
      AND s."locationId" = ANY(${LIQUIDATION_LOCATION_IDS}::text[])
      AND s."sourceType" = 'physical'
      AND s."available" > 0
  `;
  return Number(rows[0]?.available ?? 0);
}

async function readVariantMeta(variantId: string) {
  const { data, errors } = await shopifyGraphQL<{
    productVariant: {
      id: string;
      price: string | null;
      compareAtPrice: string | null;
      barcode: string | null;
      priceLocked: { value: string | null } | null;
      delivery48h: { value: string | null } | null;
      expressPrice: { value: string | null } | null;
    } | null;
  }>(VARIANT_META_QUERY, { id: variantId });
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  return data?.productVariant ?? null;
}

async function main() {
  console.log(
    `[repair-false-unlock] dryRun=${DRY_RUN} write=${WRITE} auditOnly=${AUDIT_ONLY} surcharge=${readLiquidationExpressSurchargeChf()}`
  );

  const cohort = await loadCohort();
  console.log(`[repair-false-unlock] cohort=${cohort.length}`);

  // Dedupe by norm key (prefer most recently updated STX row).
  const byNorm = new Map<string, CohortRow>();
  for (const row of cohort) {
    const norm = gtinNormKey(row.gtin);
    if (!norm) continue;
    if (!byNorm.has(norm)) byNorm.set(norm, row);
  }
  const unique = [...byNorm.values()];
  console.log(`[repair-false-unlock] uniqueNormGtins=${unique.length}`);

  let stockOk = 0;
  let stockMismatch = 0;
  let badChemin = 0;
  let skippedEssentials = 0;
  let skippedAdmin = 0;
  let noShopify = 0;
  let expressPresent = 0;
  let expressCleared = 0;
  let expressWrong = 0;
  let expressExpectedNull = 0;
  let wouldRepair = 0;
  let repaired = 0;
  let failed = 0;
  const mismatches: string[] = [];
  const cheminFlags: string[] = [];
  const failures: Array<{ gtin: string; error: string }> = [];

  for (const row of unique) {
    const gtin = String(row.gtin).trim();
    const liqQty = await sumLiqLane(gtin);
    if (liqQty <= 0) continue;

    const mirrorRows = await mirrorLocQtys(gtin);
    const cheminMirror = mirrorRows
      .filter((r) => r.locationId === ONLINE_LOCATION?.id)
      .reduce((s, r) => s + Number(r.available ?? 0), 0);

    let shopifyVariant = null as Awaited<ReturnType<typeof getShopifyVariantDetail>>;
    try {
      const hit = await findShopifyVariantByGtin(gtin);
      shopifyVariant = hit.match;
    } catch (err: any) {
      failures.push({ gtin, error: `shopify lookup: ${err?.message ?? err}` });
      failed += 1;
      continue;
    }

    if (!shopifyVariant) {
      noShopify += 1;
      console.log(`[skip] ${gtin} no Shopify variant liqQty=${liqQty}`);
      continue;
    }

    if (isEssentialsShopifyVariant(shopifyVariant)) {
      skippedEssentials += 1;
      console.log(`[skip] ${gtin} Essentials`);
      continue;
    }
    if (isAdminOnlyShopifyVariant(shopifyVariant.variantId, shopifyVariant.productId)) {
      skippedAdmin += 1;
      console.log(`[skip] ${gtin} admin-only`);
      continue;
    }

    // Live Shopify qty per liq location vs mirror.
    let liveLiq = 0;
    let liveChemin = 0;
    const invId = shopifyVariant.inventoryItemId;
    if (invId) {
      for (const locId of LIQUIDATION_LOCATION_IDS) {
        const q =
          (await getInventoryAvailableAtLocation({
            inventoryItemId: invId,
            locationId: locId,
          })) ?? 0;
        liveLiq += Math.max(0, q);
      }
      if (ONLINE_LOCATION?.id) {
        liveChemin =
          (await getInventoryAvailableAtLocation({
            inventoryItemId: invId,
            locationId: ONLINE_LOCATION.id,
          })) ?? 0;
      }
    }

    const stockMatch = liveLiq === liqQty;
    if (stockMatch) stockOk += 1;
    else {
      stockMismatch += 1;
      const msg = `${gtin} mirrorLiq=${liqQty} liveLiq=${liveLiq} mirrorChemin=${cheminMirror} liveChemin=${liveChemin}`;
      mismatches.push(msg);
      console.log(`[stock-mismatch] ${msg}`);
    }

    if (liveChemin > 0 || cheminMirror > 0) {
      badChemin += 1;
      const msg = `${gtin} liveChemin=${liveChemin} mirrorChemin=${cheminMirror} (soldes must be 0)`;
      cheminFlags.push(msg);
      console.log(`[bad-chemin] ${msg}`);
    }

    let meta = null as Awaited<ReturnType<typeof readVariantMeta>>;
    try {
      meta = await readVariantMeta(shopifyVariant.variantId);
    } catch (err: any) {
      failures.push({ gtin, error: `meta: ${err?.message ?? err}` });
      failed += 1;
      continue;
    }

    const pricing = await resolvePhysicalRestockPricing(gtin);
    const expectedLiq = pricing.sellPrice;
    const expectedExpress =
      expectedLiq != null && expectedLiq > 0
        ? calcLiquidationExpressSellPrice(expectedLiq)
        : null;
    const currentExpress = parseExpressPriceMetafieldAmount(meta?.expressPrice?.value);
    const priceLocked = String(meta?.priceLocked?.value ?? "").toLowerCase() === "true";
    const delivery48h = String(meta?.delivery48h?.value ?? "").toLowerCase() === "true";
    const price = meta?.price != null ? Number(meta.price) : null;
    const compareAt = meta?.compareAtPrice != null ? Number(meta.compareAtPrice) : null;

    if (currentExpress == null) {
      expressCleared += 1;
    } else if (expectedExpress != null && Math.abs(currentExpress - expectedExpress) <= 0.05) {
      expressPresent += 1;
    } else if (expectedExpress == null) {
      expressExpectedNull += 1;
      expressPresent += 1;
    } else {
      expressWrong += 1;
    }

    wouldRepair += 1;
    console.log(
      `[candidate] ${gtin} liqQty=${liqQty} liveLiq=${liveLiq} price=${price} compareAt=${compareAt} ` +
        `locked=${priceLocked} d48h=${delivery48h} express=${currentExpress ?? "null"} ` +
        `expectLiq=${expectedLiq ?? "null"} expectExpress=${expectedExpress ?? "null"} ` +
        `note=${row.manualNote}`
    );

    if (DRY_RUN || AUDIT_ONLY) continue;

    try {
      const res = await convergeVariant(gtin, {
        postPhysicalRestock: true,
        preferredVariantId: shopifyVariant.variantId,
      });
      repaired += 1;
      console.log(
        `[write] ${gtin} desired=${res.desired} changed=${res.changed} ` +
          `changes=${JSON.stringify(res.changes)} warnings=${JSON.stringify(res.warnings)}`
      );
      if (res.error) {
        failed += 1;
        failures.push({ gtin, error: res.error });
      }
    } catch (err: any) {
      failed += 1;
      failures.push({ gtin, error: err?.message ?? String(err) });
      console.log(`[fail] ${gtin} ${err?.message ?? err}`);
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log(
    JSON.stringify(
      {
        cohortRaw: cohort.length,
        uniqueNorm: unique.length,
        wouldRepair,
        repaired: WRITE ? repaired : 0,
        dryRun: DRY_RUN,
        stockOk,
        stockMismatch,
        badChemin,
        skippedEssentials,
        skippedAdmin,
        noShopify,
        express: {
          cleared: expressCleared,
          presentOkOrStx: expressPresent,
          wrongVsLiqExpect: expressWrong,
          noPricingBaseline: expressExpectedNull,
        },
        failed,
      },
      null,
      2
    )
  );
  if (mismatches.length) {
    console.log("\n--- stock mismatches (sample) ---");
    for (const m of mismatches.slice(0, 30)) console.log(m);
  }
  if (cheminFlags.length) {
    console.log("\n--- bad Chemin (sample) ---");
    for (const m of cheminFlags.slice(0, 30)) console.log(m);
  }
  if (failures.length) {
    console.log("\n--- failures ---");
    console.log(JSON.stringify(failures, null, 2));
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[repair-false-unlock] fatal", err);
  await prisma.$disconnect();
  process.exit(1);
});
