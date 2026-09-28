import { prisma } from "@/app/lib/prisma";
import { fetchStockxProductByIdOrSlugRaw, pickPersistedKickdbBarcodes } from "@/galaxus/kickdb/client";
import { digestProductFields, pickPersistedKickdbSizes, pickString } from "@/galaxus/kickdb/extract";
import { ingestStxFromRawPayload } from "@/galaxus/jobs/stxSync";
import { scheduleMarketplaceStockPush } from "@/inventory/marketplaceStockSync";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { convergeVariant, type ConvergeVariantResult } from "@/shopify/inventory/convergence";
import {
  createProductFullFlow,
  unlockShopifyPriceByBarcode,
} from "@/shopify/restock/createProductFullFlow";
import { resolveProviderKeyForGtin } from "@/shopify/restock/channelListingState";
import { resolveKickdbSlugForGtin } from "@/shopify/restock/resolveKickdbSlugForGtin";
import { findShopifyVariantByGtin } from "@/shopify/restock/shopifyRestockInventory";
import { isEssentialsShopifyVariant } from "@/shopify/inventory/essentialsProduct";
import { isAdminOnlyShopifyVariant } from "@/shopify/protection/adminOnlyProducts";
import { isJmoneyPriceLockNote } from "@/shopify/inventory/locationConfig";
import {
  decrementShopifyWebSaleStock,
  syncMirrorForGtinFromShopify,
  syncMirrorForVariantFromShopify,
} from "@/shopify/orders/webSaleInventory";
import {
  resolvePostSaleProductIdentifier,
} from "@/shopify/orders/saleIdentity";

async function hasJmoneyPriceLockInDb(gtin: string): Promise<boolean> {
  const prismaAny = prisma as any;
  const row = await prismaAny.supplierVariant
    .findFirst({
      where: { gtin },
      orderBy: [{ updatedAt: "desc" }],
      select: { manualLock: true, manualNote: true },
    })
    .catch(() => null);
  if (!row) return false;
  return Boolean(row.manualLock) && isJmoneyPriceLockNote(row.manualNote);
}

/**
 * Shopify-side JMoney signal. Survives DB manualNote drift (past cleanup wiped
 * jmoney notes → post-sale ran createProductFullFlow and relisted Chemin qty).
 *
 * ONLY the product tag `jmoney-kicks`. Do NOT treat bare `custom.price_locked`
 * as JMoney — liquidation soldes also sets price_locked=true, and that false
 * positive skipped unlock + KickDB upsert so sold-out liquidations kept the
 * Sale badge (compareAt) and never fully exited soldes.
 */
async function hasJmoneyPriceLockOnShopify(variantId: string | null | undefined): Promise<boolean> {
  const id = String(variantId ?? "").trim();
  if (!id) return false;
  try {
    const { data } = await shopifyGraphQL<{
      productVariant: {
        product: { tags: string[] } | null;
      } | null;
    }>(
      `query($id: ID!) {
        productVariant(id: $id) {
          product { tags }
        }
      }`,
      { id }
    );
    const tags = (data?.productVariant?.product?.tags ?? []).map((t) =>
      String(t ?? "").toLowerCase()
    );
    return tags.includes("jmoney-kicks");
  } catch {
    return false;
  }
}

export type PostSaleRefreshOptions = {
  /** Units sold on this paid order line — decrements home/warehouse stock before converge. */
  soldQty?: number;
  orderId?: string | null;
  lineItemId?: string | null;
  /** Exact sold Shopify variant (preferred when GTIN exists on duplicate products). */
  variantId?: string | null;
  /** Shopify line SKU — KickDB uuid`-OS` when barcode missing. */
  sku?: string | null;
  /** Stock already decremented (marketplace physical route) — skip web decrement. */
  skipInventoryDecrement?: boolean;
  /** Local physical sale — skip main.py dropship relist (convergence only). */
  skipDropshipRelist?: boolean;
  /** Any channel sale — unlock liquidation + refresh market price (never re-lock same pass). */
  forceMarketPrice?: boolean;
};

export type PostSaleRefreshResult = {
  gtin: string;
  shopifyRefresh?: { ok: boolean; action?: string | null; error?: string | null };
  kickdbSync?: { ok: boolean; updated?: number; error?: string | null };
  convergence?: ConvergeVariantResult;
  channelSyncScheduled?: boolean;
  inventory?: {
    mirrorSynced?: boolean;
    decremented?: number;
    warnings?: string[];
  };
  warnings: string[];
};

/**
 * After a Shopify web sale: refresh live market price on Shopify, sync STX DB row,
 * unlock liquidation if needed, push marketplace stock feed.
 * Galaxus PriceData + Decathlon PRI01 scheduled once per order batch (debounced).
 *
 * Dropship: createProductFullFlow re-prices from KickDB/StockX + restocks qty when asks exist
 * (only when liquidation-lane stock is fully sold). Partial liquidation sales keep soldes pricing
 * on remaining physical units and skip dropship restock.
 * Physical/Bussigny: convergeVariant clears liquidation lock + delivery metafields when lane hits 0.
 */
export async function refreshAfterShopifySale(
  gtin: string,
  options: PostSaleRefreshOptions = {}
): Promise<PostSaleRefreshResult> {
  const cleanGtin = String(gtin ?? "").trim();
  const warnings: string[] = [];
  const preferredVariantId = String(options.variantId ?? "").trim() || null;
  const sku = String(options.sku ?? "").trim() || null;
  let effectiveGtin = cleanGtin;

  // GTIN optional when Shopify variant id is known (no-barcode Website stock sales).
  if (!cleanGtin && !preferredVariantId) {
    return { gtin: "", warnings: ["empty_gtin"] };
  }

  const inventory: NonNullable<PostSaleRefreshResult["inventory"]> = {};

  try {
    if (cleanGtin) {
      await syncMirrorForGtinFromShopify(cleanGtin, { preferredVariantId });
    } else if (preferredVariantId) {
      const mirror = await syncMirrorForVariantFromShopify(preferredVariantId);
      if (mirror.gtin) effectiveGtin = mirror.gtin;
      warnings.push("mirror synced by shopifyVariantId (no GTIN on sale line)");
    }
    inventory.mirrorSynced = true;
  } catch (err: any) {
    warnings.push(`mirror sync: ${err?.message ?? err}`);
  }

  const soldQty = Math.max(0, Math.trunc(options.soldQty ?? 0));
  const skipDropshipRelist =
    Boolean(options.skipDropshipRelist) ||
    (Boolean(options.skipInventoryDecrement) && soldQty > 0);
  // Shopify already commits inventory on orders/paid — mirror only; do not pre-decrement
  // (a second decrement removed the remaining liquidation-lane unit).

  let isEssentials = false;
  let isAdminOnly = false;
  let shopifyMatchVariantId: string | null = preferredVariantId;
  try {
    if (effectiveGtin) {
      const { match } = await findShopifyVariantByGtin(effectiveGtin);
      isEssentials = isEssentialsShopifyVariant(match);
      isAdminOnly = isAdminOnlyShopifyVariant(match?.variantId, match?.productId);
      shopifyMatchVariantId = match?.variantId ?? preferredVariantId;
    } else if (preferredVariantId) {
      // No GTIN — essentials/admin checks need variant tags; converge loads detail.
      isEssentials = false;
      isAdminOnly = isAdminOnlyShopifyVariant(preferredVariantId, null);
    }
  } catch {
    // Non-fatal — fall through to StockX refresh attempt.
  }

  const [dbJmoneyLocked, shopifyJmoneyLocked] = await Promise.all([
    effectiveGtin ? hasJmoneyPriceLockInDb(effectiveGtin) : Promise.resolve(false),
    hasJmoneyPriceLockOnShopify(preferredVariantId ?? shopifyMatchVariantId),
  ]);
  const jmoneyLocked = dbJmoneyLocked || shopifyJmoneyLocked;
  if (jmoneyLocked) {
    warnings.push("JMoney Kickz price lock — unlock/reprice skipped");
  } else if (!isAdminOnly && effectiveGtin) {
    const unlock = await unlockShopifyPriceByBarcode(effectiveGtin);
    if (!unlock.ok && unlock.error && unlock.error !== "empty_barcode") {
      warnings.push(`unlock: ${unlock.error}`);
    }
  } else if (!isAdminOnly && !effectiveGtin) {
    warnings.push("no GTIN — price unlock by barcode skipped");
  } else if (isAdminOnly) {
    warnings.push("Admin-only Shopify product — price unlock skipped");
  }

  let convergence: ConvergeVariantResult | undefined;
  const afterSale = Boolean(options.forceMarketPrice) || soldQty > 0;
  try {
    convergence = await convergeVariant(effectiveGtin, {
      afterWebSale: afterSale,
      preferredVariantId,
    });
    if (convergence.warnings.length) {
      warnings.push(...convergence.warnings.map((w) => `convergence: ${w}`));
    }
  } catch (err: any) {
    warnings.push(`convergence: ${err?.message ?? err}`);
  }

  let shopifyRefresh: PostSaleRefreshResult["shopifyRefresh"];
  const stillLiquidation = convergence?.desired === "liquidation";

  const { identifier: productIdentifier } = await resolvePostSaleProductIdentifier({
    gtin: effectiveGtin || null,
    sku,
  });

  let kickdbSync: PostSaleRefreshResult["kickdbSync"];
  if (isEssentials || isAdminOnly || jmoneyLocked) {
    kickdbSync = { ok: true, updated: 0, error: null };
  } else if (!stillLiquidation) {
    // Fresh KickDB → STX DB before Shopify upsert (price + stock source of truth).
    try {
      if (effectiveGtin) {
        kickdbSync = await syncKickdbBufferAndStxForGtin(effectiveGtin);
      } else if (productIdentifier) {
        kickdbSync = await syncKickdbBufferAndStxForIdentifier(productIdentifier);
      } else {
        kickdbSync = { ok: false, error: "no_kickdb_identifier" };
      }
      if (!kickdbSync.ok) {
        warnings.push(`kickdb sync: ${kickdbSync.error ?? "failed"}`);
      }
    } catch (err: any) {
      kickdbSync = { ok: false, error: err?.message ?? String(err) };
      warnings.push(`kickdb sync: ${kickdbSync.error}`);
    }
  } else {
    kickdbSync = { ok: true, updated: 0, error: null };
  }

  if (isEssentials || isAdminOnly) {
    shopifyRefresh = {
      ok: true,
      action: isAdminOnly ? "skipped_admin_only" : "skipped",
      error: null,
    };
  } else if (jmoneyLocked) {
    shopifyRefresh = { ok: true, action: "skipped_jmoney_price_lock", error: null };
  } else if (stillLiquidation) {
    shopifyRefresh = { ok: true, action: "skipped_liquidation", error: null };
  } else if (skipDropshipRelist) {
    shopifyRefresh = { ok: true, action: "skipped_local_physical_sale", error: null };
  } else if (!productIdentifier) {
    shopifyRefresh = { ok: false, action: null, error: "no_product_identifier" };
    warnings.push("shopify refresh: no GTIN/KickDB slug — skipped main.py upsert");
  } else {
    // Full variant recreate from live KickDB: market price, Chemin qty (0 when no ask).
    const refresh = await createProductFullFlow(productIdentifier);
    shopifyRefresh = {
      ok: refresh.ok,
      action: refresh.action,
      error: refresh.error,
    };
    if (!refresh.ok) {
      warnings.push(`shopify refresh: ${refresh.error ?? "failed"}`);
    }
  }

  // main.py update can recreate online available qty. Consume sold units again so
  // paid orders do not leave phantom stock after a price refresh — only when dropship relist ran.
  if (
    !options.skipInventoryDecrement &&
    !stillLiquidation &&
    soldQty > 0 &&
    options.orderId &&
    shopifyRefresh?.ok &&
    effectiveGtin
  ) {
    try {
      const post = await decrementShopifyWebSaleStock({
        gtin: effectiveGtin,
        quantity: soldQty,
        orderId: options.orderId,
        lineItemId: options.lineItemId,
        preferredVariantId,
        idempotencyScope: "post-refresh",
      });
      inventory.decremented = (inventory.decremented ?? 0) + post.decremented;
      if (post.warnings.length) warnings.push(...post.warnings.map((w) => `inventory: ${w}`));
      if (post.decremented > 0) {
        await syncMirrorForGtinFromShopify(effectiveGtin, { preferredVariantId });
      }
    } catch (err: any) {
      warnings.push(`inventory post-refresh decrement: ${err?.message ?? err}`);
    }
  } else if (
    !options.skipInventoryDecrement &&
    !stillLiquidation &&
    soldQty > 0 &&
    options.orderId &&
    shopifyRefresh?.ok &&
    !effectiveGtin &&
    preferredVariantId
  ) {
    // No GTIN: re-sync mirror after main.py so Website stock reflects live qty.
    try {
      await syncMirrorForVariantFromShopify(preferredVariantId);
      inventory.mirrorSynced = true;
    } catch (err: any) {
      warnings.push(`inventory post-refresh mirror: ${err?.message ?? err}`);
    }
  }

  if (stillLiquidation && !isEssentials && !isAdminOnly) {
    try {
      if (effectiveGtin) {
        kickdbSync = await syncKickdbBufferAndStxForGtin(effectiveGtin);
      } else if (productIdentifier) {
        kickdbSync = await syncKickdbBufferAndStxForIdentifier(productIdentifier);
      }
      if (kickdbSync && !kickdbSync.ok) {
        warnings.push(`kickdb sync: ${kickdbSync.error ?? "failed"}`);
      }
    } catch (err: any) {
      kickdbSync = { ok: false, error: err?.message ?? String(err) };
      warnings.push(`kickdb sync: ${kickdbSync.error}`);
    }
  }

  let channelSyncScheduled = false;
  if (effectiveGtin) {
    try {
      const { providerKey, synthetic } = await resolveProviderKeyForGtin(effectiveGtin);
      if (!synthetic && providerKey) {
        scheduleMarketplaceStockPush({ providerKeys: [providerKey] });
        channelSyncScheduled = true;
      }
    } catch (err: any) {
      warnings.push(`channel sync: ${err?.message ?? err}`);
    }
  }

  if (inventory.mirrorSynced || inventory.decremented != null) {
    inventory.warnings = warnings.filter((w) => w.startsWith("inventory:"));
  }

  return {
    gtin: effectiveGtin,
    shopifyRefresh,
    kickdbSync,
    convergence,
    channelSyncScheduled,
    inventory,
    warnings,
  };
}

/** Pull fresh KickDB payload → buffer + STX SupplierVariant price/stock (marketplace DB). */
async function syncKickdbBufferAndStxForIdentifier(identifier: string): Promise<{
  ok: boolean;
  updated?: number;
  error?: string | null;
}> {
  const slug = String(identifier ?? "").trim();
  if (!slug) {
    return { ok: false, error: "no_kickdb_slug" };
  }

  const { raw } = await fetchStockxProductByIdOrSlugRaw(slug);
  const data = (raw as { data?: unknown })?.data ?? raw;
  const kickdbProductId = pickString((data as { id?: string })?.id);
  if (!data || !kickdbProductId) {
    return { ok: false, error: "missing_kickdb_product_id" };
  }

  const now = new Date();
  const digest = digestProductFields(data);

  await prisma.$executeRaw`
    INSERT INTO "public"."KickDBProduct" (
      "id", "kickdbProductId", "urlKey", "styleId", "name", "brand", "imageUrl",
      "traitsJson", "description", "gender", "colorway", "countryOfManufacture",
      "releaseDate", "retailPrice", "lastFetchedAt", "notFound",
      "rawJson", "rawFetchedAt", "createdAt", "updatedAt"
    ) VALUES (
      gen_random_uuid(), ${kickdbProductId}, ${digest.urlKey}, ${digest.styleId},
      ${digest.name}, ${digest.brand}, ${digest.imageUrl},
      ${digest.traitsJson === null ? null : JSON.stringify(digest.traitsJson)}::jsonb,
      ${digest.description}, ${digest.gender}, ${digest.colorway}, ${digest.countryOfManufacture},
      ${digest.releaseDate}, ${digest.retailPrice}, ${now}, false,
      ${JSON.stringify(data)}::jsonb, ${now}, ${now}, ${now}
    )
    ON CONFLICT ("kickdbProductId") DO UPDATE SET
      "urlKey"               = COALESCE(EXCLUDED."urlKey", "KickDBProduct"."urlKey"),
      "styleId"              = COALESCE(EXCLUDED."styleId", "KickDBProduct"."styleId"),
      "name"                 = COALESCE(EXCLUDED."name", "KickDBProduct"."name"),
      "brand"                = COALESCE(EXCLUDED."brand", "KickDBProduct"."brand"),
      "imageUrl"             = COALESCE(EXCLUDED."imageUrl", "KickDBProduct"."imageUrl"),
      "traitsJson"           = COALESCE(EXCLUDED."traitsJson", "KickDBProduct"."traitsJson"),
      "description"          = COALESCE(EXCLUDED."description", "KickDBProduct"."description"),
      "gender"               = COALESCE(EXCLUDED."gender", "KickDBProduct"."gender"),
      "colorway"             = COALESCE(EXCLUDED."colorway", "KickDBProduct"."colorway"),
      "countryOfManufacture" = COALESCE(EXCLUDED."countryOfManufacture", "KickDBProduct"."countryOfManufacture"),
      "releaseDate"          = COALESCE(EXCLUDED."releaseDate", "KickDBProduct"."releaseDate"),
      "retailPrice"          = COALESCE(EXCLUDED."retailPrice", "KickDBProduct"."retailPrice"),
      "lastFetchedAt"        = EXCLUDED."lastFetchedAt",
      "notFound"             = false,
      "rawJson"              = EXCLUDED."rawJson",
      "rawFetchedAt"         = EXCLUDED."rawFetchedAt",
      "updatedAt"            = EXCLUDED."updatedAt"
  `;

  const productRow = await prisma.kickDBProduct.findUnique({
    where: { kickdbProductId },
    select: { id: true },
  });
  if (!productRow) {
    return { ok: false, error: "product_row_missing_after_upsert" };
  }

  const variants: unknown[] = Array.isArray((data as { variants?: unknown[] }).variants)
    ? ((data as { variants: unknown[] }).variants ?? [])
    : [];
  for (const v of variants) {
    const variant = v as Record<string, unknown>;
    const kickdbVariantId = pickString(variant?.id);
    if (!kickdbVariantId) continue;
    const { sizeEu, sizeUs } = pickPersistedKickdbSizes(variant);
    const { gtin: variantGtin, ean } = pickPersistedKickdbBarcodes(
      variant as Parameters<typeof pickPersistedKickdbBarcodes>[0]
    );

    await prisma.$executeRaw`
      INSERT INTO "public"."KickDBVariant" (
        "id", "kickdbVariantId", "productId", "sizeUs", "sizeEu", "gtin", "ean",
        "lastFetchedAt", "notFound", "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid(), ${kickdbVariantId}, ${productRow.id}, ${sizeUs}, ${sizeEu},
        ${variantGtin}, ${ean}, ${now}, false, ${now}, ${now}
      )
      ON CONFLICT ("kickdbVariantId") DO UPDATE SET
        "productId"     = EXCLUDED."productId",
        "sizeUs"        = COALESCE(EXCLUDED."sizeUs", "KickDBVariant"."sizeUs"),
        "sizeEu"        = COALESCE(EXCLUDED."sizeEu", "KickDBVariant"."sizeEu"),
        "gtin"          = COALESCE(EXCLUDED."gtin", "KickDBVariant"."gtin"),
        "ean"           = COALESCE(EXCLUDED."ean", "KickDBVariant"."ean"),
        "lastFetchedAt" = EXCLUDED."lastFetchedAt",
        "notFound"      = false,
        "updatedAt"     = EXCLUDED."updatedAt"
    `;
  }

  const ingest = await ingestStxFromRawPayload(data, kickdbProductId);
  return { ok: true, updated: ingest.updated + ingest.created };
}

async function syncKickdbBufferAndStxForGtin(gtin: string): Promise<{
  ok: boolean;
  updated?: number;
  error?: string | null;
}> {
  const slug = await resolveKickdbSlugForGtin(gtin);
  if (!slug) {
    return { ok: false, error: "no_kickdb_slug" };
  }
  return syncKickdbBufferAndStxForIdentifier(slug);
}
