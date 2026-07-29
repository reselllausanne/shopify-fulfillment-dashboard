import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { deriveStockxRawAskFromStoredBuyPrice } from "@/galaxus/pricing/suggestedSellPrice";
import { calcShopifySellPrice } from "@/shopify/pricing/calcShopifySellPrice";
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
  const standardBuy =
    toNumber(input.stxRow.standardBuyPrice) ??
    (String(input.stxRow.deliveryType ?? "") === "standard" ? toNumber(input.stxRow.price) : null);
  const expressBuy =
    toNumber(input.stxRow.expressBuyPrice) ??
    (String(input.stxRow.deliveryType ?? "").startsWith("express_") ? toNumber(input.stxRow.price) : null);

  const normalSell =
    (standardBuy != null
      ? calcSellFromBuy(
          standardBuy,
          input.productHandle,
          input.stxRow.supplierProductName,
          input.stxRow.supplierBrand,
          false
        )
      : null) ??
    (expressBuy != null
      ? calcSellFromBuy(
          expressBuy,
          input.productHandle,
          input.stxRow.supplierProductName,
          input.stxRow.supplierBrand,
          false
        )
      : null);
  const expressSell =
    expressBuy != null
      ? calcSellFromBuy(
          expressBuy,
          input.productHandle,
          input.stxRow.supplierProductName,
          input.stxRow.supplierBrand,
          true
        )
      : null;

  return { normalSell, expressSell };
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
      supplierProductName: true,
      supplierBrand: true,
      deliveryType: true,
      price: true,
      standardBuyPrice: true,
      expressBuyPrice: true,
    },
  });
  if (!stxRow) return { gtin: cleanGtin, ok: false, reason: "no_stx_row" };

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
    const expressValue = JSON.stringify({
      amount: expressSell.toFixed(2),
      currency_code: "CHF",
    });
    const mf = await shopifyGraphQL<{
      metafieldsSet: { userErrors: Array<{ message: string }> };
    }>(EXPRESS_METAFIELD_MUTATION, {
      metafields: [
        {
          ownerId: shopifyVariant.variantId,
          namespace: "custom",
          key: "express_price",
          type: "money",
          value: expressValue,
        },
      ],
    });
    const mfErrors = mf.errors ?? [];
    const mfUe = mf.data?.metafieldsSet?.userErrors ?? [];
    if (mfErrors.length || mfUe.length) {
      return {
        gtin: cleanGtin,
        ok: false,
        reason: [...mfErrors, ...mfUe].map((e) => e.message).join("; "),
        normalPrice: normalSell,
      };
    }
  }

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
      const expressValue = JSON.stringify({
        amount: expressSell.toFixed(2),
        currency_code: "CHF",
      });
      const mf = await shopifyGraphQL<{
        metafieldsSet: { userErrors: Array<{ message: string }> };
      }>(EXPRESS_METAFIELD_MUTATION, {
        metafields: [
          {
            ownerId: match.variantId,
            namespace: "custom",
            key: "express_price",
            type: "money",
            value: expressValue,
          },
        ],
      });
      const mfErrors = mf.errors ?? [];
      const mfUe = mf.data?.metafieldsSet?.userErrors ?? [];
      if (mfErrors.length || mfUe.length) {
        results.push({
          supplierVariantId,
          ok: false,
          reason: [...mfErrors, ...mfUe].map((e) => e.message).join("; "),
          matchedVariantId: match.variantId,
          normalPrice: normalSell,
        });
        continue;
      }
    }

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
