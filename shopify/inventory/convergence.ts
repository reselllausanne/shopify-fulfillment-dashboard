import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { loadPhysicalMirrorStockByGtin } from "@/shopify/inventory/physicalAvailability";
import {
  findShopifyVariantByGtin,
  type ShopifyVariantDetail,
} from "@/shopify/restock/shopifyRestockInventory";
import { createProductFullFlow } from "@/shopify/restock/createProductFullFlow";

/**
 * Phase 4 — convergence engine.
 *
 * One idempotent function that reconciles Shopify + DB state for a single
 * GTIN, based on the mirror.
 *
 *   physical > 0  → liquidation state
 *                   Shopify: price = STX × (1 - DISCOUNT), compareAt = STX,
 *                            metafield custom.price_locked = true
 *                   DB    : manualLock = true, manualPrice = liq_price
 *                           (manualStock stays null so the resolver still
 *                            adds physical qty on top of STX asks via
 *                            RESOLVER_MERGE_PHYSICAL)
 *
 *   physical = 0  → dropship state
 *                   DB    : manualLock = false, manualPrice = null
 *                   Shopify: unlock metafield via Python bridge + refresh via
 *                            createProductFullFlow(gtin) which re-applies live
 *                            StockX pricing.
 *
 * Idempotent: only writes on state diff. Safe to run every 15 minutes.
 */

const LIQ_DISCOUNT = (() => {
  const pct = Number(process.env.LIQUIDATION_DISCOUNT_PCT ?? "30");
  if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) return 0.3;
  return pct / 100;
})();

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
  physicalQty: number;
  desired: "liquidation" | "dropship";
  changed: boolean;
  changes: string[];
  warnings: string[];
  error?: string;
};

/**
 * Converge a single GTIN. Reads mirror + DB + Shopify; applies only diffs.
 *
 *  - Safe to call from cron, order webhook, or marketplace sale hook.
 *  - Never touches variants without an STX SupplierVariant row (nothing to
 *    lock/unlock in the DB). Those flow through the mirror-only resolver path
 *    for qty; price is whatever Shopify has.
 */
export async function convergeVariant(gtin: string): Promise<ConvergeVariantResult> {
  const changes: string[] = [];
  const warnings: string[] = [];
  const cleanGtin = String(gtin ?? "").trim();
  if (!cleanGtin) {
    return {
      gtin: "",
      physicalQty: 0,
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
  const desired: "liquidation" | "dropship" = physicalQty > 0 ? "liquidation" : "dropship";

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
  try {
    const { match, ambiguous } = await findShopifyVariantByGtin(cleanGtin);
    if (ambiguous) warnings.push("multiple Shopify variants share this GTIN — using first match");
    shopifyVariant = match;
  } catch (err: any) {
    warnings.push(`Shopify variant lookup failed: ${err?.message ?? err}`);
  }

  if (!stxRow && !shopifyVariant) {
    return { gtin: cleanGtin, physicalQty, desired, changed: false, changes, warnings };
  }

  const stxNormalPrice = stxRow ? toNumber(stxRow.price) : null;

  if (desired === "liquidation") {
    if (!stxNormalPrice || stxNormalPrice <= 0) {
      warnings.push("no STX normal price on record — cannot compute liquidation price");
      return { gtin: cleanGtin, physicalQty, desired, changed: false, changes, warnings };
    }
    const liqPrice = round2(stxNormalPrice * (1 - LIQ_DISCOUNT));

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
            manualNote: `phase4:liquidation physical=${physicalQty} @ ${
              physical?.preferredLocationName ?? "?"
            }`,
          },
        });
        changes.push(`DB manualLock=true, manualPrice=${liqPrice.toFixed(2)}`);
      }
    }

    // Shopify side: price / compareAt + metafield lock.
    if (shopifyVariant?.variantId && shopifyVariant.productId) {
      const currentPrice = toNumber(shopifyVariant.price);
      const currentCompareAt = toNumber(shopifyVariant.compareAtPrice);
      const priceDiffers = currentPrice == null || Math.abs(currentPrice - liqPrice) > 0.005;
      const compareDiffers =
        currentCompareAt == null || Math.abs(currentCompareAt - stxNormalPrice) > 0.005;
      if (priceDiffers || compareDiffers) {
        try {
          await writeShopifyVariantPrice({
            productId: shopifyVariant.productId,
            variantId: shopifyVariant.variantId,
            price: liqPrice,
            compareAtPrice: stxNormalPrice,
          });
          changes.push(
            `Shopify price=${liqPrice.toFixed(2)} compareAt=${stxNormalPrice.toFixed(2)}`
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
  } else {
    // Dropship: physical hit 0 → clear manual lock, unlock Shopify, refresh
    // via main.py so it repushes live StockX pricing.
    if (stxRow && (stxRow.manualLock || stxRow.manualPrice !== null || stxRow.manualStock !== null)) {
      await prisma.supplierVariant.update({
        where: { id: stxRow.id },
        data: {
          manualLock: false,
          manualPrice: null,
          manualStock: null,
          manualUpdatedAt: new Date(),
          manualNote: "phase4:dropship (physical=0)",
        },
      });
      changes.push("DB manualLock=false, cleared manual overrides");
    }

    if (shopifyVariant?.variantId) {
      try {
        const isLocked = await readShopifyPriceLocked(shopifyVariant.variantId);
        if (isLocked) {
          // Trigger full refresh through the Python bridge: it unlocks the
          // metafield AND lets main.py re-apply live pricing / republish.
          const refresh = await createProductFullFlow(cleanGtin);
          if (refresh.ok === false) {
            warnings.push(`createProductFullFlow failed: ${refresh.error ?? "unknown"}`);
          } else {
            changes.push("Shopify unlocked + product refreshed via main.py");
          }
        }
      } catch (err: any) {
        warnings.push(`Shopify unlock/refresh failed: ${err?.message ?? err}`);
      }
    }
  }

  return {
    gtin: cleanGtin,
    physicalQty,
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
 *  - liquidation candidates: every GTIN with physical > 0 in the mirror
 *  - dropship candidates   : every GTIN that is currently locked in the DB
 *                            (manualLock=true) but no longer has physical > 0
 *
 * `sample` returns the first N results with a change; useful for cron audit.
 */
export async function convergeAll(options: { sampleSize?: number } = {}): Promise<ConvergeAllResult> {
  const startedAt = Date.now();
  const sampleSize = Math.min(Math.max(options.sampleSize ?? 25, 0), 500);

  const liqRows = await prisma.$queryRaw<Array<{ gtin: string }>>`
    SELECT DISTINCT s."gtin"
    FROM "public"."ShopifyVariantLocationStock" s
    WHERE s."sourceType" = 'physical'
      AND s."available"  > 0
      AND s."gtin" IS NOT NULL
  `;
  const liqGtins = new Set(liqRows.map((r) => r.gtin));

  const dropRows = await prisma.$queryRaw<Array<{ gtin: string }>>`
    SELECT DISTINCT sv."gtin"
    FROM "public"."SupplierVariant" sv
    WHERE sv."manualLock" = true
      AND sv."supplierVariantId" LIKE 'stx\\_%' ESCAPE '\\'
      AND sv."gtin" IS NOT NULL
      AND sv."manualNote" LIKE 'phase4:liquidation%'
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
