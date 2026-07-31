import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { loadPhysicalMirrorStockByGtin } from "@/shopify/inventory/physicalAvailability";
import {
  findShopifyVariantByGtin,
  getShopifyVariantDetail,
  type ShopifyVariantDetail,
} from "@/shopify/restock/shopifyRestockInventory";
import { createProductFullFlow } from "@/shopify/restock/createProductFullFlow";
import { isEssentialsShopifyVariant } from "@/shopify/inventory/essentialsProduct";
import { isAdminOnlyShopifyVariant } from "@/shopify/protection/adminOnlyProducts";

/**
 * Phase 4 — convergence engine.
 *
 * Liquidation pricing on Shopify:
 *   - Owned physical qty > 0 across LIQUIDATION_LOCATION_IDS (Bussigny + Lab + COLD BIEN)
 *     with an existing manualLock → warehouse soldes scan
 *   - Antica physical stock is NOT part of liquidation lane
 *   - Chemin (online) is the StockX dropship pool, not owned stock → never liquidation
 *
 * After a paid web sale, post-sale passes afterWebSale — revert to dropship only when
 * liquidation-lane stock hits 0; partial sales keep liquidation on remaining units.
 *
 * delivery_48h / soldes_48h metafields are coupled to a REAL liquidation lock
 * (manualLock + liquidation-lane qty), never to quantity alone: a pair whose
 * price was not actually changed must not appear in the soldes collection.
 * Liquidation qty = 0 still clears both flags.
 */

import { resolvePhysicalRestockPricing } from "@/shopify/restock/physicalRestockPricing";
import {
  readShopifyDelivery48h,
  writeShopifyDelivery48h,
} from "@/shopify/restock/bussignyDeliveryMetafield";
import { syncSoldes48hProductMetafield } from "@/shopify/restock/bussignySoldesMetafield";
import { LIQUIDATION_LOCATION_IDS, ONLINE_LOCATION } from "@/shopify/inventory/locationConfig";

const VARIANT_SALE_PRICE_MUTATION = /* GraphQL */ `
mutation ConvergeVariantPrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    productVariants { id price compareAtPrice }
    userErrors { field message }
  }
}
`;

const METAFIELD_SET_MUTATION = /* GraphQL */ `
mutation ConvergeSetMetafield($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id namespace key value }
    userErrors { field message }
  }
}
`;

const VARIANT_PRICE_LOCK_QUERY = /* GraphQL */ `
query ConvergePriceLock($id: ID!) {
  productVariant(id: $id) {
    id
    metafield(namespace: "custom", key: "price_locked") { value }
  }
}
`;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toNumber(x: unknown): number | null {
  if (x == null) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

/**
 * Owned physical qty across the liquidation lane (Bussigny + Lab + COLD BIEN).
 * Kept as `getBussignyQtyForGtin` for callers; drives liquidation eligibility.
 */
async function getBussignyQtyForGtin(gtin: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ available: number }>>`
    SELECT COALESCE(SUM(s."available"), 0)::int AS available
    FROM "public"."ShopifyVariantLocationStock" s
    WHERE s."gtin" = ${gtin}
      AND s."locationId" = ANY(${LIQUIDATION_LOCATION_IDS}::text[])
      AND s."sourceType" = 'physical'
      AND s."available" > 0
  `;
  return Number(rows[0]?.available ?? 0);
}

/** Home / Chemin soldes lane (where web "sold from home" stock lives). */
async function getHomeQtyForGtin(gtin: string): Promise<number> {
  const homeId = ONLINE_LOCATION?.id;
  if (!homeId) return 0;
  const rows = await prisma.$queryRaw<Array<{ available: number }>>`
    SELECT COALESCE(SUM(s."available"), 0)::int AS available
    FROM "public"."ShopifyVariantLocationStock" s
    WHERE s."gtin" = ${gtin}
      AND s."locationId" = ${homeId}
      AND s."available" > 0
  `;
  return Number(rows[0]?.available ?? 0);
}

async function syncBussignyDelivery48h(
  shopifyVariant: ShopifyVariantDetail | null,
  gtin: string,
  liquidationLockActive: boolean,
  changes: string[],
  warnings: string[]
): Promise<void> {
  if (!shopifyVariant?.variantId) return;
  try {
    const liquidationQty = await getBussignyQtyForGtin(gtin);
    // Flag only when the liquidation lock is real: qty alone must not mark a
    // pair as 48h/soldes when its price was never actually changed.
    const want48h = liquidationQty > 0 && liquidationLockActive;
    const has48h = await readShopifyDelivery48h(shopifyVariant.variantId);
    if (has48h !== want48h) {
      await writeShopifyDelivery48h(shopifyVariant.variantId, want48h);
      changes.push(
        `Shopify delivery_48h=${want48h ? "true" : "false"} (liquidation qty=${liquidationQty}, lock=${liquidationLockActive ? "locked" : "none"})`
      );
    }
  } catch (err: any) {
    warnings.push(`Shopify delivery_48h failed: ${err?.message ?? err}`);
  }
}

async function readShopifyPriceLocked(variantId: string): Promise<boolean> {
  const { data, errors } = await shopifyGraphQL<{
    productVariant: { metafield: { value: string | null } | null } | null;
  }>(VARIANT_PRICE_LOCK_QUERY, { id: variantId });
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  const v = data?.productVariant?.metafield?.value;
  return String(v ?? "").toLowerCase() === "true";
}

async function writeShopifyVariantPrice(input: {
  productId: string;
  variantId: string;
  price: number;
  compareAtPrice: number | null;
}) {
  const { errors, data } = await shopifyGraphQL<{
    productVariantsBulkUpdate: { userErrors: Array<{ message: string }> };
  }>(VARIANT_SALE_PRICE_MUTATION, {
    productId: input.productId,
    variants: [
      {
        id: input.variantId,
        price: input.price.toFixed(2),
        compareAtPrice: input.compareAtPrice != null ? input.compareAtPrice.toFixed(2) : null,
      },
    ],
  });
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  const ue = data?.productVariantsBulkUpdate?.userErrors ?? [];
  if (ue.length) throw new Error(ue.map((e) => e.message).join("; "));
}

async function writeShopifyPriceLocked(variantId: string, locked: boolean): Promise<void> {
  // productVariant is the OWNER of custom.price_locked metafields in this
  // codebase (see Python `set_variant_price_locked`).
  const { errors, data } = await shopifyGraphQL<{
    metafieldsSet: { userErrors: Array<{ message: string }> };
  }>(METAFIELD_SET_MUTATION, {
    metafields: [
      {
        ownerId: variantId,
        namespace: "custom",
        key: "price_locked",
        type: "boolean",
        value: locked ? "true" : "false",
      },
    ],
  });
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  const ue = data?.metafieldsSet?.userErrors ?? [];
  if (ue.length) throw new Error(ue.map((e) => e.message).join("; "));
}

export type ConvergeVariantResult = {
  gtin: string;
  /** Total physical qty across all warehouse locations (mirror). */
  physicalQty: number;
  /** Bussigny-only qty — drives delivery_48h. */
  bussignyQty: number;
  /** Chemin / home qty — drives soldes pricing on web. */
  homeQty: number;
  desired: "liquidation" | "dropship";
  changed: boolean;
  changes: string[];
  warnings: string[];
  error?: string;
};

export type ConvergeVariantOptions = {
  /** Repair/cron override — always target dropship regardless of lane stock. */
  forceDropship?: boolean;
  /**
   * Paid Shopify web sale just ran — exit liquidation only when liquidation-lane
   * stock is 0; keep liquidation pricing when units remain in Bussigny/Lab/COLD.
   */
  afterWebSale?: boolean;
  /**
   * Scan restock into a liquidation-lane location just completed — keep/set
   * liquidation (price, manualLock, delivery_48h, soldes_48h) even when the
   * mirror or DB lock was not pre-existing. Prevents post-scan revert to dropship.
   */
  postPhysicalRestock?: boolean;
  /** Exact sold Shopify variant id; bypasses ambiguous GTIN lookup. */
  preferredVariantId?: string | null;
};

function resolveDesiredListingMode(input: {
  isEssentials: boolean;
  liquidationLaneQty: number;
  manualLock: boolean;
  postPhysicalRestock: boolean;
  forceDropship: boolean;
  afterWebSale: boolean;
  looksLikeLiquidationPrice: boolean;
}): "liquidation" | "dropship" {
  if (input.forceDropship && !input.afterWebSale) return "dropship";
  if (input.isEssentials) return "dropship";

  const liquidationLaneStock = input.liquidationLaneQty > 0;
  const liquidationSignals =
    input.manualLock || input.postPhysicalRestock || input.looksLikeLiquidationPrice;

  if (liquidationLaneStock && liquidationSignals) return "liquidation";
  return "dropship";
}

/**
 * Converge a single GTIN. Reads mirror + DB + Shopify; applies only diffs.
 *
 *  - Safe to call from cron, order webhook, or marketplace sale hook.
 *  - Never touches variants without an STX SupplierVariant row (nothing to
 *    lock/unlock in the DB). Those flow through the mirror-only resolver path
 *    for qty; price is whatever Shopify has.
 */
export async function convergeVariant(
  gtin: string,
  options: ConvergeVariantOptions = {}
): Promise<ConvergeVariantResult> {
  const changes: string[] = [];
  const warnings: string[] = [];
  const cleanGtin = String(gtin ?? "").trim();
  if (!cleanGtin) {
    return {
      gtin: "",
      physicalQty: 0,
      bussignyQty: 0,
      homeQty: 0,
      desired: "dropship",
      changed: false,
      changes: [],
      warnings: [],
      error: "empty gtin",
    };
  }

  const physicalMap = await loadPhysicalMirrorStockByGtin([cleanGtin]);
  const physical = physicalMap.get(cleanGtin);
  const physicalQty = physical?.qty ?? 0;
  const bussignyQty = await getBussignyQtyForGtin(cleanGtin);
  const homeQty = await getHomeQtyForGtin(cleanGtin);

  const stxRow = await prisma.supplierVariant.findFirst({
    where: {
      gtin: cleanGtin,
      supplierVariantId: { startsWith: "stx_" },
    },
    select: {
      id: true,
      supplierVariantId: true,
      price: true,
      manualLock: true,
      manualPrice: true,
      manualStock: true,
    },
  });

  let shopifyVariant: ShopifyVariantDetail | null = null;
  const preferredVariantId = String(options.preferredVariantId ?? "").trim();
  try {
    if (preferredVariantId) {
      shopifyVariant = await getShopifyVariantDetail(preferredVariantId);
      if (!shopifyVariant) {
        warnings.push(`preferred variant not found: ${preferredVariantId}`);
      }
    } else {
      const { match, ambiguous } = await findShopifyVariantByGtin(cleanGtin);
      if (ambiguous) warnings.push("multiple Shopify variants share this GTIN — using first match");
      shopifyVariant = match;
    }
  } catch (err: any) {
    warnings.push(`Shopify variant lookup failed: ${err?.message ?? err}`);
  }

  const isEssentials = isEssentialsShopifyVariant(shopifyVariant);

  if (isEssentials && bussignyQty > 0) {
    warnings.push("Essentials product — liquidation skipped (Bussigny stock kept at manual price)");
  }

  if (isAdminOnlyShopifyVariant(shopifyVariant?.variantId, shopifyVariant?.productId)) {
    warnings.push(
      "Admin-only Shopify product — automation skips price, express, delivery, soldes (inventory mirror only)"
    );
    return {
      gtin: cleanGtin,
      physicalQty,
      bussignyQty,
      homeQty,
      desired: "dropship",
      changed: false,
      changes,
      warnings,
    };
  }

  if (!stxRow && !shopifyVariant) {
    return {
      gtin: cleanGtin,
      physicalQty,
      bussignyQty,
      homeQty,
      desired: "dropship",
      changed: false,
      changes,
      warnings,
    };
  }

  const pricing = await resolvePhysicalRestockPricing(cleanGtin);
  const referencePrice = pricing.compareAt;
  const liqPrice = pricing.sellPrice;
  const hasLiquidationPricing =
    referencePrice != null &&
    referencePrice > 0 &&
    liqPrice != null &&
    liqPrice > 0;

  const currentShopifyPrice = toNumber(shopifyVariant?.price);
  const looksLikeLiquidationPrice =
    hasLiquidationPricing &&
    currentShopifyPrice != null &&
    liqPrice != null &&
    currentShopifyPrice <= liqPrice + 0.01;

  // Chemin (ONLINE_LOCATION) is the StockX dropship pool — never triggers liquidation.
  // Liquidation-lane stock (Bussigny/Lab/COLD) with a lock or sale price keeps soldes.
  const desired = resolveDesiredListingMode({
    isEssentials,
    liquidationLaneQty: bussignyQty,
    manualLock: Boolean(stxRow?.manualLock),
    postPhysicalRestock: Boolean(options.postPhysicalRestock),
    forceDropship: Boolean(options.forceDropship),
    afterWebSale: Boolean(options.afterWebSale),
    looksLikeLiquidationPrice,
  });

  if (desired === "liquidation") {
    if (!hasLiquidationPricing) {
      warnings.push(`no StockX liquidation pricing (${pricing.source})`);
    }

    if (hasLiquidationPricing) {
      // DB side: manualLock=true + manualPrice=liq. manualStock stays null so
      // Resolver keeps adding physical on top of STX asks (no double-count).
      if (stxRow) {
        const needDbUpdate =
          !stxRow.manualLock ||
          toNumber(stxRow.manualPrice) !== liqPrice ||
          stxRow.manualStock !== null;
        if (needDbUpdate) {
          await prisma.supplierVariant.update({
            where: { id: stxRow.id },
            data: {
              manualLock: true,
              manualPrice: liqPrice,
              manualStock: null,
              manualUpdatedAt: new Date(),
              manualNote: `phase4:liquidation home=${homeQty} bussigny=${bussignyQty}`,
            },
          });
          changes.push(`DB manualLock=true, manualPrice=${liqPrice!.toFixed(2)}`);
        }
      }

      // Shopify side: price / compareAt + metafield lock.
      if (shopifyVariant?.variantId && shopifyVariant.productId) {
        const currentPrice = toNumber(shopifyVariant.price);
        const currentCompareAt = toNumber(shopifyVariant.compareAtPrice);
        const priceDiffers = currentPrice == null || Math.abs(currentPrice - liqPrice!) > 0.005;
        const compareDiffers =
          currentCompareAt == null || Math.abs(currentCompareAt - referencePrice!) > 0.005;
        if (priceDiffers || compareDiffers) {
          try {
            await writeShopifyVariantPrice({
              productId: shopifyVariant.productId,
              variantId: shopifyVariant.variantId,
              price: liqPrice!,
              compareAtPrice: referencePrice!,
            });
            changes.push(
              `Shopify price=${liqPrice!.toFixed(2)} compareAt=${referencePrice!.toFixed(2)}`
            );
          } catch (err: any) {
            warnings.push(`Shopify price write failed: ${err?.message ?? err}`);
          }
        }
        try {
          const isLocked = await readShopifyPriceLocked(shopifyVariant.variantId);
          if (!isLocked) {
            await writeShopifyPriceLocked(shopifyVariant.variantId, true);
            changes.push("Shopify price_locked=true");
          }
        } catch (err: any) {
          warnings.push(`Shopify metafield read/write failed: ${err?.message ?? err}`);
        }
      }
    }
  } else {
    // Bussigny empty → clear liquidation lock even if other warehouses still hold stock.
    const hadDbLiquidation = Boolean(stxRow?.manualLock);
    if (stxRow && (hadDbLiquidation || stxRow.manualPrice !== null || stxRow.manualStock !== null)) {
      await prisma.supplierVariant.update({
        where: { id: stxRow.id },
        data: {
          manualLock: false,
          manualPrice: null,
          manualStock: null,
          manualUpdatedAt: new Date(),
          manualNote: "phase4:dropship (bussigny=0)",
        },
      });
      changes.push("DB manualLock=false, cleared manual overrides");
    }

    if (shopifyVariant?.variantId && shopifyVariant.productId) {
      try {
        let isLocked = false;
        try {
          isLocked = await readShopifyPriceLocked(shopifyVariant.variantId);
        } catch (err: any) {
          warnings.push(`Shopify price_locked read failed: ${err?.message ?? err}`);
        }

        const currentPrice = toNumber(shopifyVariant.price);
        const currentCompareAt = toNumber(shopifyVariant.compareAtPrice);
        const dropshipPrice =
          referencePrice != null && referencePrice > 0 ? referencePrice : null;
        const looksLikeLiquidation =
          currentPrice != null &&
          currentCompareAt != null &&
          currentCompareAt > currentPrice * 1.15;
        const matchesLiquidationPrice =
          hasLiquidationPricing &&
          liqPrice != null &&
          currentPrice != null &&
          currentPrice <= liqPrice + 0.01;
        const staleCompareAtAfterSale =
          (Boolean(options.forceDropship) || Boolean(options.afterWebSale)) &&
          currentCompareAt != null &&
          currentCompareAt > 0;
        const pricedBelowMarket =
          dropshipPrice != null &&
          currentPrice != null &&
          currentPrice < dropshipPrice - 0.01;
        const exitingLiquidationLaneAfterSale =
          Boolean(options.afterWebSale) && bussignyQty === 0;

        const needsPriceRevert =
          hadDbLiquidation ||
          isLocked ||
          looksLikeLiquidation ||
          matchesLiquidationPrice ||
          staleCompareAtAfterSale ||
          pricedBelowMarket ||
          (exitingLiquidationLaneAfterSale &&
            dropshipPrice != null &&
            currentPrice != null &&
            Math.abs(currentPrice - dropshipPrice) > 0.005);

        if (isLocked) {
          await writeShopifyPriceLocked(shopifyVariant.variantId, false);
          changes.push("Shopify price_locked=false");
        }

        // Post-sale full liquidation exit: unlock flags here; live KickDB upsert
        // (createProductFullFlow + STX ingest) owns price + stock — not this pass.
        if (exitingLiquidationLaneAfterSale) {
          if (needsPriceRevert) {
            changes.push(
              "liquidation exit — price/stock deferred to post-sale KickDB upsert"
            );
          }
        } else if (needsPriceRevert && dropshipPrice != null) {
          const priceDiffers =
            currentPrice == null || Math.abs(currentPrice - dropshipPrice) > 0.005;
          const compareStillSet = currentCompareAt != null && currentCompareAt > 0;
          if (priceDiffers || compareStillSet || isLocked) {
            await writeShopifyVariantPrice({
              productId: shopifyVariant.productId,
              variantId: shopifyVariant.variantId,
              price: dropshipPrice,
              compareAtPrice: null,
            });
            changes.push(
              `Shopify reverted to dropship price=${dropshipPrice.toFixed(2)}, compareAt cleared`
            );
          }
        } else if (needsPriceRevert) {
          const refresh = await createProductFullFlow(cleanGtin);
          if (refresh.ok === false) {
            warnings.push(`createProductFullFlow failed: ${refresh.error ?? "unknown"}`);
          } else {
            changes.push("Shopify unlocked + product refreshed via main.py");
            // Some legacy products keep a stale compareAt after main.py update.
            // Ensure dropship state never leaves a sale compareAt marker behind.
            const refreshed = await getShopifyVariantDetail(shopifyVariant.variantId);
            const refreshedPrice = toNumber(refreshed?.price);
            const refreshedCompareAt = toNumber(refreshed?.compareAtPrice);
            if (refreshedPrice != null && refreshedCompareAt != null && refreshedCompareAt > 0) {
              await writeShopifyVariantPrice({
                productId: shopifyVariant.productId,
                variantId: shopifyVariant.variantId,
                price: refreshedPrice,
                compareAtPrice: null,
              });
              changes.push("Shopify compareAt cleared after main.py refresh");
            }
          }
        }
      } catch (err: any) {
        warnings.push(`Shopify unlock/revert failed: ${err?.message ?? err}`);
      }
    }
  }

  // Liquidation state is real only when the DB manual lock backs it (desired
  // already requires Bussigny qty > 0 + manualLock). Dropship always clears.
  const liquidationLockActive = desired === "liquidation";
  await syncBussignyDelivery48h(shopifyVariant, cleanGtin, liquidationLockActive, changes, warnings);
  await syncSoldes48hProductMetafield(shopifyVariant?.productId, changes, warnings);

  return {
    gtin: cleanGtin,
    physicalQty,
    bussignyQty,
    homeQty,
    desired,
    changed: changes.length > 0,
    changes,
    warnings,
  };
}

export type ConvergeAllResult = {
  ok: boolean;
  scanned: number;
  changed: number;
  errors: number;
  ms: number;
  sample: ConvergeVariantResult[];
};

/**
 * Batch convergence run:
 *  - liquidation candidates: Bussigny physical qty > 0 (Chemin = dropship pool, never a candidate)
 *  - dropship candidates   : STX rows still locked, or recent Bussigny→0 transitions
 *
 * `sample` returns the first N results with a change; useful for cron audit.
 */
export async function convergeAll(options: { sampleSize?: number } = {}): Promise<ConvergeAllResult> {
  const startedAt = Date.now();
  const sampleSize = Math.min(Math.max(options.sampleSize ?? 25, 0), 500);

  const liqRows = await prisma.$queryRaw<Array<{ gtin: string }>>`
    SELECT DISTINCT s."gtin"
    FROM "public"."ShopifyVariantLocationStock" s
    WHERE s."gtin" IS NOT NULL
      AND s."available" > 0
      AND s."sourceType" = 'physical'
      AND s."locationId" = ANY(${LIQUIDATION_LOCATION_IDS}::text[])
  `;
  const liqGtins = new Set(liqRows.map((r) => r.gtin));

  const dropRows = await prisma.$queryRaw<Array<{ gtin: string }>>`
    SELECT DISTINCT sv."gtin"
    FROM "public"."SupplierVariant" sv
    WHERE sv."supplierVariantId" LIKE 'stx\\_%' ESCAPE '\\'
      AND sv."gtin" IS NOT NULL
      AND (
        (
          sv."manualLock" = true
          AND sv."manualNote" LIKE 'phase4:liquidation%'
        )
        OR (
          sv."manualLock" = false
          AND sv."manualNote" LIKE 'phase4:dropship%'
          AND sv."manualUpdatedAt" >= NOW() - INTERVAL '14 days'
          AND NOT EXISTS (
            SELECT 1
            FROM "public"."ShopifyVariantLocationStock" s
            WHERE s."gtin" = sv."gtin"
              AND s."sourceType" = 'physical'
              AND s."locationId" = ANY(${LIQUIDATION_LOCATION_IDS}::text[])
              AND s."available" > 0
          )
        )
      )
  `;
  const allGtins = new Set<string>([...liqGtins, ...dropRows.map((r) => r.gtin)]);

  const sample: ConvergeVariantResult[] = [];
  let changed = 0;
  let errors = 0;

  for (const gtin of allGtins) {
    try {
      const res = await convergeVariant(gtin);
      if (res.error) errors += 1;
      if (res.changed) {
        changed += 1;
        if (sample.length < sampleSize) sample.push(res);
      }
    } catch (err: any) {
      errors += 1;
      if (sample.length < sampleSize) {
        sample.push({
          gtin,
          physicalQty: 0,
          bussignyQty: 0,
          homeQty: 0,
          desired: "dropship",
          changed: false,
          changes: [],
          warnings: [],
          error: err?.message ?? "unknown",
        });
      }
    }
  }

  return {
    ok: true,
    scanned: allGtins.size,
    changed,
    errors,
    ms: Date.now() - startedAt,
    sample,
  };
}
