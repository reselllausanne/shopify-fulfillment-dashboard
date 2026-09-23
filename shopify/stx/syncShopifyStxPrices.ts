import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { deriveStockxRawAskFromStoredBuyPrice } from "@/galaxus/pricing/suggestedSellPrice";
import {
  calcShopifySellPrice,
  resolveStxWebsiteSellPrices,
} from "@/shopify/pricing/calcShopifySellPrice";
import { findShopifyVariantByGtin } from "@/shopify/restock/shopifyRestockInventory";
import { isAdminOnlyShopifyVariant } from "@/shopify/protection/adminOnlyProducts";

const VARIANT_PRICE_MUTATION = /* GraphQL */ `
mutation SyncStxVariantPrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    productVariants { id price }
    userErrors { field message }
  }
}
`;

const EXPRESS_METAFIELD_MUTATION = /* GraphQL */ `
mutation SyncStxExpressMetafield($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id namespace key value }
    userErrors { field message }
  }
}
`;

const EXPRESS_METAFIELD_DELETE_MUTATION = /* GraphQL */ `
mutation DeleteStxExpressMetafield($metafields: [MetafieldIdentifierInput!]!) {
  metafieldsDelete(metafields: $metafields) {
    deletedMetafields { ownerId key namespace }
    userErrors { field message }
  }
}
`;

/** Best-effort delete — never fails the parent sync if the metafield is absent. */
async function deleteShopifyExpressPriceMetafield(variantId: string): Promise<void> {
  try {
    await shopifyGraphQL<{
      metafieldsDelete: { userErrors: Array<{ message: string }> };
    }>(EXPRESS_METAFIELD_DELETE_MUTATION, {
      metafields: [
        { ownerId: variantId, namespace: "custom", key: "express_price" },
      ],
    });
  } catch {
    /* swallow — stale metafield removal is opportunistic */
  }
}

const PRICE_LOCK_QUERY = /* GraphQL */ `
query StxPriceLock($id: ID!) {
  productVariant(id: $id) {
    id
    metafield(namespace: "custom", key: "price_locked") { value }
  }
}
`;

const PRODUCT_BY_HANDLE_QUERY = /* GraphQL */ `
query StxProductByHandle($query: String!) {
  products(first: 1, query: $query) {
    nodes {
      id
      handle
      variants(first: 250) {
        nodes {
          id
          title
          sku
          product { id }
          usSize: metafield(namespace: "custom", key: "us_size") { value }
        }
      }
    }
  }
}
`;

export type SyncShopifyStxPriceResult = {
  gtin: string;
  ok: boolean;
  reason?: string;
  normalPrice?: number;
  expressPrice?: number | null;
};

export type SyncShopifyStxPendingResult = {
  supplierVariantId: string;
  ok: boolean;
  reason?: string;
  matchedVariantId?: string | null;
  normalPrice?: number;
  expressPrice?: number | null;
};

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Last Shopify price we recorded pushing for this providerKey, if any. Lets the
 * sync skip a redundant Shopify write when the computed price has not moved.
 * Best-effort: returns null if the delegate is absent (e.g. in unit tests).
 */
async function readLastPushedShopifyPrice(
  providerKey: string | null | undefined
): Promise<number | null> {
  const key = String(providerKey ?? "").trim();
  if (!key) return null;
  const cls = (prisma as any).channelListingState;
  if (!cls?.findUnique) return null;
  try {
    const row = await cls.findUnique({
      where: { channel_providerKey: { channel: "SHOPIFY", providerKey: key } },
      select: { lastPushedPrice: true },
    });
    const v = row?.lastPushedPrice == null ? null : Number(row.lastPushedPrice);
    return Number.isFinite(v as number) ? (v as number) : null;
  } catch {
    return null;
  }
}

/**
 * Record a Shopify price push on ChannelListingState so the nightly worker can
 * skip anything already fresh (see shopifyStxPriceSyncWorker MIN_AGE_HOURS) and
 * so the next sync can diff against it. Only non-null ids are written, so a
 * skip-path record never clobbers a known variant/product id. Never sets stock
 * or status — inventory ownership stays with the sold-check flow.
 */
async function recordShopifyStxPush(input: {
  providerKey: string | null | undefined;
  supplierVariantId?: string | null;
  gtin: string | null;
  variantId?: string | null;
  productId?: string | null;
  price: number;
}): Promise<void> {
  const key = String(input.providerKey ?? "").trim();
  if (!key) return;
  const cls = (prisma as any).channelListingState;
  if (!cls?.upsert) return;
  const now = new Date();
  const common = {
    supplierVariantId: input.supplierVariantId ?? undefined,
    gtin: input.gtin ?? undefined,
    externalVariantId: input.variantId ?? undefined,
    externalProductId: input.productId ?? undefined,
    lastPushedPrice: input.price,
    lastSyncedAt: now,
    lastError: null,
  };
  try {
    await cls.upsert({
      where: { channel_providerKey: { channel: "SHOPIFY", providerKey: key } },
      create: { channel: "SHOPIFY", providerKey: key, ...common },
      update: common,
    });
  } catch {
    /* best-effort — a failed bookkeeping write must not fail the price sync */
  }
}

async function readShopifyPriceLocked(variantId: string): Promise<boolean> {
  const { data, errors } = await shopifyGraphQL<{
    productVariant: { metafield: { value: string | null } | null } | null;
  }>(PRICE_LOCK_QUERY, { id: variantId });
  if (errors?.length) return false;
  return String(data?.productVariant?.metafield?.value ?? "").toLowerCase() === "true";
}

async function resolveProductHandle(gtin: string): Promise<string | null> {
  const kv = await prisma.kickDBVariant.findFirst({
    where: { OR: [{ gtin }, { ean: gtin }] },
    select: { product: { select: { urlKey: true } } },
    orderBy: { updatedAt: "desc" },
  });
  return kv?.product?.urlKey ?? null;
}

function sizeTokens(raw: string | null | undefined): string[] {
  const value = String(raw ?? "").trim();
  if (!value) return [];
  const cleaned = value.toUpperCase().replace(/^EU\s*/, "").replace(/^US\s*/, "").replace(",", ".");
  const tokens = new Set<string>();
  tokens.add(cleaned);
  const numeric = cleaned.match(/(\d+(\.\d+)?)/)?.[1];
  if (numeric) tokens.add(numeric);
  const frac = cleaned.match(/(\d+)\s*(1\/3|2\/3)/);
  if (frac) {
    const base = Number(frac[1]);
    const decimal = frac[2] === "1/3" ? base + 1 / 3 : base + 2 / 3;
    tokens.add(decimal.toFixed(1));
    tokens.add(decimal.toFixed(2));
  }
  return Array.from(tokens);
}

function sharesSizeToken(a: string | null | undefined, b: string | null | undefined): boolean {
  const aSet = new Set(sizeTokens(a));
  if (aSet.size === 0) return false;
  return sizeTokens(b).some((t) => aSet.has(t));
}

async function findShopifyVariantByHandleAndSize(input: {
  handle: string;
  sizeEu?: string | null;
  sizeUs?: string | null;
}): Promise<
  | {
      variantId: string;
      productId: string;
    }
  | null
> {
  const handle = String(input.handle ?? "").trim();
  if (!handle) return null;
  const { data, errors } = await shopifyGraphQL<{
    products: {
      nodes: Array<{
        id: string;
        handle: string | null;
        variants: {
          nodes: Array<{
            id: string;
            title: string | null;
            sku: string | null;
            product: { id: string } | null;
            usSize: { value: string | null } | null;
          }>;
        };
      }>;
    };
  }>(PRODUCT_BY_HANDLE_QUERY, { query: `handle:${handle}` });
  if (errors?.length) return null;
  const product =
    (data?.products?.nodes ?? []).find((node) => String(node.handle ?? "").trim() === handle) ?? null;
  if (!product) return null;
  const variants = product.variants?.nodes ?? [];
  const byEu = variants.find((v) => sharesSizeToken(v.title, input.sizeEu));
  if (byEu?.id && byEu.product?.id) return { variantId: byEu.id, productId: byEu.product.id };
  const byUs = variants.find((v) => sharesSizeToken(v.usSize?.value, input.sizeUs));
  if (byUs?.id && byUs.product?.id) return { variantId: byUs.id, productId: byUs.product.id };
  return null;
}

function computeSellPrices(input: {
  stxRow: {
    deliveryType: string | null;
    price: unknown;
    standardBuyPrice: unknown;
    expressBuyPrice: unknown;
    supplierProductName: string | null;
    supplierBrand: string | null;
  };
  productHandle: string | null;
}): { normalSell: number | null; expressSell: number | null } {
  const resolved = resolveStxWebsiteSellPrices({
    standardBuyPrice: toNumber(input.stxRow.standardBuyPrice),
    expressBuyPrice: toNumber(input.stxRow.expressBuyPrice),
    fallbackBuyPrice: toNumber(input.stxRow.price),
    deliveryType: input.stxRow.deliveryType,
    calcFromBuy: (buyPrice, isExpress) =>
      calcSellFromBuy(
        buyPrice,
        input.productHandle,
        input.stxRow.supplierProductName,
        input.stxRow.supplierBrand,
        isExpress
      ),
  });
  return { normalSell: resolved.normalSell, expressSell: resolved.expressSell };
}

/** Write express money + flip express_available so theme never shows stale/inverted price. */
async function writeShopifyExpressPrice(
  variantId: string,
  expressSell: number
): Promise<string | null> {
  const expressValue = JSON.stringify({
    amount: expressSell.toFixed(2),
    currency_code: "CHF",
  });
  const mf = await shopifyGraphQL<{
    metafieldsSet: { userErrors: Array<{ message: string }> };
  }>(EXPRESS_METAFIELD_MUTATION, {
    metafields: [
      {
        ownerId: variantId,
        namespace: "custom",
        key: "express_price",
        type: "money",
        value: expressValue,
      },
      {
        ownerId: variantId,
        namespace: "custom",
        key: "express_available",
        type: "boolean",
        value: "true",
      },
    ],
  });
  const mfErrors = mf.errors ?? [];
  const mfUe = mf.data?.metafieldsSet?.userErrors ?? [];
  if (mfErrors.length || mfUe.length) {
    return [...mfErrors, ...mfUe].map((e) => e.message).join("; ");
  }
  return null;
}

function calcSellFromBuy(
  buyPrice: number,
  productHandle: string | null,
  productName: string | null,
  brand: string | null,
  isExpress: boolean
): number | null {
  const stockxRaw = deriveStockxRawAskFromStoredBuyPrice(buyPrice, {
    slug: productHandle,
    urlKey: productHandle,
    name: productName,
  });
  if (stockxRaw == null) return null;
  return calcShopifySellPrice({
    stockxRaw,
    productHandle,
    productName,
    brand,
    isExpress,
  });
}

export async function syncShopifyStxPricesForGtin(gtin: string): Promise<SyncShopifyStxPriceResult> {
  const cleanGtin = String(gtin ?? "").trim();
  if (!cleanGtin) return { gtin: cleanGtin, ok: false, reason: "empty_gtin" };

  const stxRow = await prisma.supplierVariant.findFirst({
    where: {
      gtin: cleanGtin,
      supplierVariantId: { startsWith: "stx_" },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      supplierVariantId: true,
      providerKey: true,
      supplierProductName: true,
      supplierBrand: true,
      deliveryType: true,
      price: true,
      standardBuyPrice: true,
      expressBuyPrice: true,
    },
  });
  if (!stxRow) return { gtin: cleanGtin, ok: false, reason: "no_stx_row" };

  // Diff-skip before any Shopify call: if the price has not moved since our last
  // recorded push, refresh the freshness stamp and return. This is the common
  // case on the nightly full sweep and saves 3–4 Shopify round-trips per GTIN.
  const providerKey = stxRow.providerKey ?? null;
  const handleForCalc =
    (await resolveProductHandle(cleanGtin)) ?? null;
  const preview = computeSellPrices({
    stxRow: {
      deliveryType: stxRow.deliveryType ?? null,
      price: stxRow.price,
      standardBuyPrice: stxRow.standardBuyPrice,
      expressBuyPrice: stxRow.expressBuyPrice,
      supplierProductName: stxRow.supplierProductName ?? null,
      supplierBrand: stxRow.supplierBrand ?? null,
    },
    productHandle: handleForCalc,
  });
  if (preview.normalSell != null) {
    const lastPushed = await readLastPushedShopifyPrice(providerKey);
    if (lastPushed != null && Math.abs(lastPushed - preview.normalSell) < 0.005) {
      await recordShopifyStxPush({
        providerKey,
        supplierVariantId: stxRow.supplierVariantId ?? null,
        gtin: cleanGtin,
        price: preview.normalSell,
      });
      return {
        gtin: cleanGtin,
        ok: true,
        reason: "price_unchanged",
        normalPrice: preview.normalSell,
        expressPrice: preview.expressSell,
      };
    }
  }

  const { match: shopifyVariant, ambiguous } = await findShopifyVariantByGtin(cleanGtin);
  if (!shopifyVariant?.variantId || !shopifyVariant.productId) {
    return { gtin: cleanGtin, ok: false, reason: "no_shopify_variant" };
  }
  if (ambiguous) {
    return { gtin: cleanGtin, ok: false, reason: "ambiguous_shopify_variant" };
  }

  if (await readShopifyPriceLocked(shopifyVariant.variantId)) {
    return { gtin: cleanGtin, ok: false, reason: "price_locked" };
  }

  if (isAdminOnlyShopifyVariant(shopifyVariant.variantId, shopifyVariant.productId)) {
    return { gtin: cleanGtin, ok: false, reason: "admin_only_product" };
  }

  const productHandle =
    (await resolveProductHandle(cleanGtin)) ?? shopifyVariant.productHandle ?? null;
  const { normalSell, expressSell } = computeSellPrices({
    stxRow: {
      deliveryType: stxRow.deliveryType ?? null,
      price: stxRow.price,
      standardBuyPrice: stxRow.standardBuyPrice,
      expressBuyPrice: stxRow.expressBuyPrice,
      supplierProductName: stxRow.supplierProductName ?? null,
      supplierBrand: stxRow.supplierBrand ?? null,
    },
    productHandle,
  });

  if (normalSell == null) {
    return { gtin: cleanGtin, ok: false, reason: "no_computed_normal_price" };
  }

  const { errors, data } = await shopifyGraphQL<{
    productVariantsBulkUpdate: { userErrors: Array<{ message: string }> };
  }>(VARIANT_PRICE_MUTATION, {
    productId: shopifyVariant.productId,
    variants: [
      {
        id: shopifyVariant.variantId,
        price: normalSell.toFixed(2),
      },
    ],
  });
  if (errors?.length) {
    return { gtin: cleanGtin, ok: false, reason: errors.map((e) => e.message).join("; ") };
  }
  const ue = data?.productVariantsBulkUpdate?.userErrors ?? [];
  if (ue.length) {
    return { gtin: cleanGtin, ok: false, reason: ue.map((e) => e.message).join("; ") };
  }

  if (expressSell != null) {
    const err = await writeShopifyExpressPrice(shopifyVariant.variantId, expressSell);
    if (err) {
      return {
        gtin: cleanGtin,
        ok: false,
        reason: err,
        normalPrice: normalSell,
      };
    }
  } else {
    // No sell price → clear stale express so checkout cannot charge inverted totals.
    await deleteShopifyExpressPriceMetafield(shopifyVariant.variantId);
  }

  await recordShopifyStxPush({
    providerKey,
    supplierVariantId: stxRow.supplierVariantId ?? null,
    gtin: cleanGtin,
    variantId: shopifyVariant.variantId,
    productId: shopifyVariant.productId,
    price: normalSell,
  });

  return {
    gtin: cleanGtin,
    ok: true,
    normalPrice: normalSell,
    expressPrice: expressSell,
  };
}

/**
 * Fallback path for STX rows that exist in DB but still have no GTIN:
 * resolve Shopify variant by product handle + size, then apply normal/express
 * pricing (unless custom.price_locked is true).
 */
export async function syncShopifyStxPricesForSupplierVariantIds(
  supplierVariantIds: string[]
): Promise<{
  synced: number;
  skipped: number;
  failed: number;
  results: SyncShopifyStxPendingResult[];
}> {
  const ids = Array.from(
    new Set(
      supplierVariantIds
        .map((id) => String(id ?? "").trim())
        .filter((id) => id.startsWith("stx_"))
    )
  );
  const results: SyncShopifyStxPendingResult[] = [];
  for (const supplierVariantId of ids) {
    const row = await prisma.supplierVariant.findFirst({
      where: { supplierVariantId },
      select: {
        supplierVariantId: true,
        providerKey: true,
        gtin: true,
        sizeRaw: true,
        supplierProductName: true,
        supplierBrand: true,
        deliveryType: true,
        price: true,
        standardBuyPrice: true,
        expressBuyPrice: true,
        mappings: {
          orderBy: { updatedAt: "desc" },
          take: 1,
          select: {
            kickdbVariant: {
              select: {
                sizeEu: true,
                sizeUs: true,
                product: { select: { urlKey: true } },
              },
            },
          },
        },
      },
    });
    if (!row) {
      results.push({ supplierVariantId, ok: false, reason: "no_stx_row" });
      continue;
    }
    if (row.gtin) {
      results.push({ supplierVariantId, ok: false, reason: "has_gtin_use_gtin_path" });
      continue;
    }

    const mapped = row.mappings?.[0]?.kickdbVariant;
    const handle = mapped?.product?.urlKey ?? null;
    if (!handle) {
      results.push({ supplierVariantId, ok: false, reason: "no_kickdb_handle" });
      continue;
    }

    const match = await findShopifyVariantByHandleAndSize({
      handle,
      sizeEu: mapped?.sizeEu ?? row.sizeRaw,
      sizeUs: mapped?.sizeUs ?? null,
    });
    if (!match?.variantId || !match.productId) {
      results.push({ supplierVariantId, ok: false, reason: "no_shopify_variant_by_size" });
      continue;
    }

    if (await readShopifyPriceLocked(match.variantId)) {
      results.push({
        supplierVariantId,
        ok: false,
        reason: "price_locked",
        matchedVariantId: match.variantId,
      });
      continue;
    }

    if (isAdminOnlyShopifyVariant(match.variantId, match.productId)) {
      results.push({
        supplierVariantId,
        ok: false,
        reason: "admin_only_product",
        matchedVariantId: match.variantId,
      });
      continue;
    }

    const { normalSell, expressSell } = computeSellPrices({
      stxRow: {
        deliveryType: row.deliveryType ?? null,
        price: row.price,
        standardBuyPrice: row.standardBuyPrice,
        expressBuyPrice: row.expressBuyPrice,
        supplierProductName: row.supplierProductName ?? null,
        supplierBrand: row.supplierBrand ?? null,
      },
      productHandle: handle,
    });
    if (normalSell == null) {
      results.push({ supplierVariantId, ok: false, reason: "no_computed_normal_price" });
      continue;
    }

    const update = await shopifyGraphQL<{
      productVariantsBulkUpdate: { userErrors: Array<{ message: string }> };
    }>(VARIANT_PRICE_MUTATION, {
      productId: match.productId,
      variants: [
        {
          id: match.variantId,
          price: normalSell.toFixed(2),
        },
      ],
    });
    if ((update.errors ?? []).length) {
      results.push({
        supplierVariantId,
        ok: false,
        reason: update.errors!.map((e) => e.message).join("; "),
        matchedVariantId: match.variantId,
      });
      continue;
    }
    const updateUe = update.data?.productVariantsBulkUpdate?.userErrors ?? [];
    if (updateUe.length) {
      results.push({
        supplierVariantId,
        ok: false,
        reason: updateUe.map((e) => e.message).join("; "),
        matchedVariantId: match.variantId,
      });
      continue;
    }

    if (expressSell != null) {
      const err = await writeShopifyExpressPrice(match.variantId, expressSell);
      if (err) {
        results.push({
          supplierVariantId,
          ok: false,
          reason: err,
          matchedVariantId: match.variantId,
          normalPrice: normalSell,
        });
        continue;
      }
    } else {
      await deleteShopifyExpressPriceMetafield(match.variantId);
    }

    await recordShopifyStxPush({
      providerKey: row.providerKey ?? null,
      supplierVariantId,
      gtin: row.gtin ?? null,
      variantId: match.variantId,
      productId: match.productId,
      price: normalSell,
    });

    results.push({
      supplierVariantId,
      ok: true,
      matchedVariantId: match.variantId,
      normalPrice: normalSell,
      expressPrice: expressSell,
    });
  }

  return {
    synced: results.filter((r) => r.ok).length,
    skipped: results.filter((r) => !r.ok && r.reason !== "no_computed_normal_price").length,
    failed: results.filter((r) => !r.ok && r.reason === "no_computed_normal_price").length,
    results,
  };
}

export async function syncShopifyStxPricesForGtins(gtins: string[]): Promise<{
  synced: number;
  skipped: number;
  failed: number;
  results: SyncShopifyStxPriceResult[];
}> {
  const unique = Array.from(new Set(gtins.map((g) => String(g ?? "").trim()).filter(Boolean)));
  const results: SyncShopifyStxPriceResult[] = [];
  for (const gtin of unique) {
    results.push(await syncShopifyStxPricesForGtin(gtin));
  }
  return {
    synced: results.filter((r) => r.ok).length,
    skipped: results.filter((r) => !r.ok && r.reason !== "no_computed_normal_price").length,
    failed: results.filter((r) => !r.ok && r.reason === "no_computed_normal_price").length,
    results,
  };
}
