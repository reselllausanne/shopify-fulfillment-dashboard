import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { findShopifyVariantsByGtin } from "@/shopify/catalog/graphql";
import {
  resolveProviderKeyForGtin,
  upsertShopifyListingState,
} from "@/shopify/restock/channelListingState";

/**
 * Phase 0 foundation for the restock flow.
 *
 * Given a GTIN, locate the matching Shopify variant, push physical stock to the
 * dedicated "Bussigny" warehouse location, and (optionally) put the variant on
 * sale. All writes are gated behind an explicit dry-run flag so the flow can be
 * validated before touching the live store.
 *
 * This module intentionally does NOT create products. When no variant matches
 * the GTIN, `restockShopifyVariantByGtin` returns `{ found: false }` and the
 * caller is expected to run the full product-creation flow (see
 * `createProductFullFlow` placeholder in the restock orchestrator).
 */

type ShopifyUserError = {
  field?: string[] | null;
  message: string;
};

const LOCATIONS_LIST_QUERY = /* GraphQL */ `
query RestockLocations($first: Int!) {
  locations(first: $first, sortKey: NAME, includeInactive: false) {
    nodes {
      id
      name
    }
  }
}
`;

const VARIANT_DETAIL_QUERY = /* GraphQL */ `
query RestockVariantDetail($id: ID!) {
  productVariant(id: $id) {
    id
    sku
    price
    compareAtPrice
    barcode
    product {
      id
      title
      status
      handle
    }
    inventoryItem {
      id
    }
  }
}
`;

// Admin API 2026-04+: inventory mutations require @idempotent(key: ...).
const INVENTORY_ADJUST_MUTATION = /* GraphQL */ `
mutation RestockInventoryAdjust($input: InventoryAdjustQuantitiesInput!, $idempotencyKey: String!) {
  inventoryAdjustQuantities(input: $input) @idempotent(key: $idempotencyKey) {
    userErrors {
      field
      message
    }
  }
}
`;

const INVENTORY_ACTIVATE_MUTATION = /* GraphQL */ `
mutation RestockInventoryActivate($inventoryItemId: ID!, $locationId: ID!, $idempotencyKey: String!) {
  inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId) @idempotent(key: $idempotencyKey) {
    inventoryLevel {
      id
    }
    userErrors {
      field
      message
    }
  }
}
`;

const VARIANT_BARCODE_MUTATION = /* GraphQL */ `
mutation RestockVariantBarcode($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    productVariants {
      id
      barcode
    }
    userErrors {
      field
      message
    }
  }
}
`;

const VARIANT_SALE_PRICE_MUTATION = /* GraphQL */ `
mutation RestockVariantSalePrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    productVariants {
      id
      price
      compareAtPrice
    }
    userErrors {
      field
      message
    }
  }
}
`;

function assertNoUserErrors(userErrors: ShopifyUserError[] | undefined, action: string) {
  if (!userErrors || userErrors.length === 0) return;
  const messages = userErrors.map((item) => item.message).join("; ");
  throw new Error(`${action} failed: ${messages}`);
}

export function isRestockDryRun(): boolean {
  // Safe by default: only real writes when SHOPIFY_RESTOCK_DRY_RUN=0.
  return String(process.env.SHOPIFY_RESTOCK_DRY_RUN ?? "1").trim() !== "0";
}

const BUSSIGNY_NAME_MATCH = /bussign?y|warehouse/i;

let cachedBussignyLocationId: string | null = null;

/**
 * Resolve the "in stock warehouse Bussigny" location id.
 * Priority: explicit env var, then case-insensitive name match on live locations.
 * Kept for backward compat; new code should use `resolvePhysicalLocationId`.
 */
export async function resolveBussignyLocationId(options: { force?: boolean } = {}): Promise<{
  locationId: string | null;
  source: "env" | "name-match" | "not-found";
  candidates?: Array<{ id: string; name: string }>;
}> {
  const envId = String(process.env.SHOPIFY_BUSSIGNY_LOCATION_ID ?? "").trim();
  if (envId) {
    return { locationId: envId, source: "env" };
  }

  if (!options.force && cachedBussignyLocationId) {
    return { locationId: cachedBussignyLocationId, source: "name-match" };
  }

  const { data, errors } = await shopifyGraphQL<{
    locations: { nodes: Array<{ id: string; name: string }> };
  }>(LOCATIONS_LIST_QUERY, { first: 50 });
  if (errors?.length) {
    throw new Error(`Shopify locations query failed: ${errors.map((e) => e.message).join("; ")}`);
  }

  const nodes = data?.locations?.nodes ?? [];
  const bussigny = nodes.find((node) => BUSSIGNY_NAME_MATCH.test(node.name));
  if (bussigny) {
    cachedBussignyLocationId = bussigny.id;
    return { locationId: bussigny.id, source: "name-match" };
  }

  return { locationId: null, source: "not-found", candidates: nodes };
}

/**
 * Resolve a valid PHYSICAL Shopify location id for the scan-in flow.
 *
 * Order:
 *   1. Explicit `preferredId` — must match one of the configured physical
 *      locations (Bussigny/Antica/Bienne). Rejected otherwise so a bad UI
 *      selection can't accidentally write to the dropship (online) location.
 *   2. Fall back to Bussigny via `resolveBussignyLocationId` (existing behavior).
 */
export async function resolvePhysicalLocationId(preferredId?: string | null): Promise<{
  locationId: string | null;
  source: "explicit" | "env" | "name-match" | "not-found" | "invalid";
  name?: string | null;
  candidates?: Array<{ id: string; name: string }>;
}> {
  // Lazy import avoids a top-level cycle: locationConfig -> physicalAvailability path.
  const { PHYSICAL_LOCATIONS, getLocationConfig } = await import("@/shopify/inventory/locationConfig");

  if (preferredId && preferredId.trim()) {
    const cfg = getLocationConfig(preferredId.trim());
    if (cfg && cfg.sourceType === "physical") {
      return { locationId: cfg.id, source: "explicit", name: cfg.name };
    }
    // Given but not a known physical location — reject to avoid writing to
    // dropship or an unknown id.
    return {
      locationId: null,
      source: "invalid",
      candidates: PHYSICAL_LOCATIONS.map((l) => ({ id: l.id, name: l.name })),
    };
  }

  const fallback = await resolveBussignyLocationId();
  const nameFromCfg = fallback.locationId ? getLocationConfig(fallback.locationId)?.name : null;
  return { ...fallback, name: nameFromCfg ?? null };
}

const INVENTORY_LEVEL_QUERY = /* GraphQL */ `
query RestockInventoryLevel($inventoryItemId: ID!, $locationId: ID!) {
  inventoryItem(id: $inventoryItemId) {
    id
    inventoryLevel(locationId: $locationId) {
      quantities(names: ["available"]) {
        name
        quantity
      }
    }
  }
}
`;

/** Current `available` quantity for an inventory item at a location (null if not stocked). */
export async function getInventoryAvailableAtLocation(input: {
  inventoryItemId: string;
  locationId: string;
}): Promise<number | null> {
  const { data, errors } = await shopifyGraphQL<{
    inventoryItem: {
      inventoryLevel: {
        quantities: Array<{ name: string; quantity: number }>;
      } | null;
    } | null;
  }>(INVENTORY_LEVEL_QUERY, {
    inventoryItemId: input.inventoryItemId,
    locationId: input.locationId,
  });
  if (errors?.length) {
    throw new Error(`Shopify inventory level failed: ${errors.map((e) => e.message).join("; ")}`);
  }
  const level = data?.inventoryItem?.inventoryLevel;
  if (!level) return null;
  const available = level.quantities.find((q) => q.name === "available");
  return available ? available.quantity : null;
}

export type ShopifyVariantDetail = {
  variantId: string;
  productId: string;
  productTitle: string | null;
  productStatus: string | null;
  productHandle: string | null;
  inventoryItemId: string | null;
  sku: string | null;
  barcode: string | null;
  price: number | null;
  compareAtPrice: number | null;
  onSale: boolean;
};

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function getShopifyVariantDetail(
  variantId: string
): Promise<ShopifyVariantDetail | null> {
  const { data, errors } = await shopifyGraphQL<{
    productVariant: {
      id: string;
      sku: string | null;
      price: string | null;
      compareAtPrice: string | null;
      barcode: string | null;
      product: {
        id: string;
        title: string | null;
        status: string | null;
        handle: string | null;
      } | null;
      inventoryItem: { id: string } | null;
    } | null;
  }>(VARIANT_DETAIL_QUERY, { id: variantId });
  if (errors?.length) {
    throw new Error(`Shopify variant detail failed: ${errors.map((e) => e.message).join("; ")}`);
  }
  const node = data?.productVariant;
  if (!node?.id || !node.product?.id) return null;

  const price = toNumber(node.price);
  const compareAtPrice = toNumber(node.compareAtPrice);
  return {
    variantId: node.id,
    productId: node.product.id,
    productTitle: node.product.title ?? null,
    productStatus: node.product.status ?? null,
    productHandle: node.product.handle ?? null,
    inventoryItemId: node.inventoryItem?.id ?? null,
    sku: node.sku ?? null,
    barcode: node.barcode ?? null,
    price,
    compareAtPrice,
    onSale: compareAtPrice != null && price != null && compareAtPrice > price,
  };
}

/**
 * Find the single best Shopify variant for a GTIN. When multiple variants share
 * the barcode (duplicate-listing risk), returns all matches so the caller can
 * decide (do NOT blindly write to an ambiguous match).
 */
export async function findShopifyVariantByGtin(gtin: string): Promise<{
  match: ShopifyVariantDetail | null;
  ambiguous: boolean;
  rawMatches: Array<{ variantId: string; productId: string; sku: string | null }>;
}> {
  const rows = await findShopifyVariantsByGtin(gtin);
  const rawMatches = rows.map((r) => ({
    variantId: r.variantId,
    productId: r.productId,
    sku: r.sku,
  }));
  if (rows.length === 0) {
    return { match: null, ambiguous: false, rawMatches };
  }
  const detail = await getShopifyVariantDetail(rows[0].variantId);
  return { match: detail, ambiguous: rows.length > 1, rawMatches };
}

/** Add (not set) quantity at a location — repeated scans accumulate stock. */
export async function adjustInventoryAtLocation(input: {
  inventoryItemId: string;
  locationId: string;
  delta: number;
}): Promise<void> {
  const { data, errors } = await shopifyGraphQL<{
    inventoryAdjustQuantities: { userErrors: ShopifyUserError[] };
  }>(INVENTORY_ADJUST_MUTATION, {
    input: {
      name: "available",
      reason: "received",
      changes: [
        {
          inventoryItemId: input.inventoryItemId,
          locationId: input.locationId,
          delta: Math.trunc(input.delta),
        },
      ],
    },
    idempotencyKey: crypto.randomUUID(),
  });
  if (errors?.length) {
    throw new Error(
      `Shopify inventoryAdjustQuantities failed: ${errors.map((e) => e.message).join("; ")}`
    );
  }
  assertNoUserErrors(data?.inventoryAdjustQuantities?.userErrors, "inventoryAdjustQuantities");
}

/** Stock the inventory item at a location (required before inventorySetQuantities). Idempotent. */
export async function activateInventoryAtLocation(input: {
  inventoryItemId: string;
  locationId: string;
}): Promise<void> {
  const { data, errors } = await shopifyGraphQL<{
    inventoryActivate: {
      inventoryLevel: { id: string } | null;
      userErrors: ShopifyUserError[];
    };
  }>(INVENTORY_ACTIVATE_MUTATION, {
    inventoryItemId: input.inventoryItemId,
    locationId: input.locationId,
    idempotencyKey: crypto.randomUUID(),
  });
  if (errors?.length) {
    throw new Error(`Shopify inventoryActivate failed: ${errors.map((e) => e.message).join("; ")}`);
  }
  assertNoUserErrors(data?.inventoryActivate?.userErrors, "inventoryActivate");
}

/** Overwrite a variant barcode (e.g. physical box GTIN differs from KickDB data). */
export async function setVariantBarcode(input: {
  productId: string;
  variantId: string;
  barcode: string;
}): Promise<void> {
  const { data, errors } = await shopifyGraphQL<{
    productVariantsBulkUpdate: {
      productVariants: Array<{ id: string; barcode: string | null }>;
      userErrors: ShopifyUserError[];
    };
  }>(VARIANT_BARCODE_MUTATION, {
    productId: input.productId,
    variants: [{ id: input.variantId, barcode: input.barcode }],
  });
  if (errors?.length) {
    throw new Error(`Shopify barcode update failed: ${errors.map((e) => e.message).join("; ")}`);
  }
  assertNoUserErrors(data?.productVariantsBulkUpdate?.userErrors, "productVariantsBulkUpdate");
}

async function applyVariantSalePrice(input: {
  productId: string;
  variantId: string;
  salePrice: number;
  compareAtPrice: number | null;
}): Promise<void> {
  const variantPayload: Record<string, unknown> = {
    id: input.variantId,
    price: input.salePrice.toFixed(2),
  };
  if (input.compareAtPrice != null) {
    variantPayload.compareAtPrice = input.compareAtPrice.toFixed(2);
  }

  const { data, errors } = await shopifyGraphQL<{
    productVariantsBulkUpdate: {
      productVariants: Array<{ id: string; price: string; compareAtPrice: string | null }>;
      userErrors: ShopifyUserError[];
    };
  }>(VARIANT_SALE_PRICE_MUTATION, {
    productId: input.productId,
    variants: [variantPayload],
  });
  if (errors?.length) {
    throw new Error(`Shopify sale price update failed: ${errors.map((e) => e.message).join("; ")}`);
  }
  assertNoUserErrors(data?.productVariantsBulkUpdate?.userErrors, "productVariantsBulkUpdate");
}

export type RestockShopifyResult = {
  found: boolean;
  dryRun: boolean;
  gtin: string;
  ambiguous?: boolean;
  variant?: ShopifyVariantDetail;
  locationId?: string | null;
  plannedStock?: number;
  plannedSalePrice?: number | null;
  alreadyOnSale?: boolean;
  actions: string[];
  warnings: string[];
};

/**
 * Core Phase 0 operation: locate a variant by GTIN, add physical stock at the
 * Bussigny location, and optionally put it on sale.
 *
 * Returns `{ found: false }` when no variant matches — caller must then create
 * the product via the full creation flow.
 */
export async function restockShopifyVariantByGtin(input: {
  gtin: string;
  quantity: number;
  salePrice?: number | null;
  dryRun?: boolean;
  /** Preferred physical location id. Falls back to Bussigny when absent/invalid. */
  locationId?: string | null;
}): Promise<RestockShopifyResult> {
  const dryRun = input.dryRun ?? isRestockDryRun();
  const gtin = String(input.gtin ?? "").trim();
  const actions: string[] = [];
  const warnings: string[] = [];

  if (!gtin) {
    return { found: false, dryRun, gtin, actions, warnings: ["Empty GTIN"] };
  }

  const { match, ambiguous, rawMatches } = await findShopifyVariantByGtin(gtin);
  if (!match) {
    return {
      found: false,
      dryRun,
      gtin,
      ambiguous: false,
      actions,
      warnings: ["No Shopify variant matches this GTIN — create product first"],
    };
  }
  if (ambiguous) {
    warnings.push(
      `Multiple Shopify variants share GTIN ${gtin}: ${rawMatches
        .map((m) => m.sku ?? m.variantId)
        .join(", ")} — using first match`
    );
  }

  const { locationId, source, candidates, name: locationName } = await resolvePhysicalLocationId(
    input.locationId
  );
  if (!locationId) {
    const hint =
      source === "invalid"
        ? `Location "${input.locationId}" is not a known physical location. Valid: ${
            candidates?.map((c) => `${c.name} (${c.id})`).join(", ") ?? "none"
          }`
        : `Location not found. Candidates: ${candidates?.map((c) => c.name).join(", ") ?? "none"}`;
    warnings.push(hint);
    return {
      found: true,
      dryRun,
      gtin,
      ambiguous,
      variant: match,
      locationId: null,
      actions,
      warnings,
    };
  }
  actions.push(`location resolved via ${source}: ${locationName ?? locationId}`);

  const quantity = Math.max(0, Math.trunc(input.quantity));
  const salePrice = input.salePrice != null ? Number(input.salePrice) : null;
  const alreadyOnSale = match.onSale;

  // Compute compareAtPrice: keep existing sale anchor if already on sale, else
  // anchor to current price so the discount shows on the storefront.
  let compareAtPrice: number | null = null;
  if (salePrice != null) {
    if (alreadyOnSale) {
      warnings.push(
        `Variant already on sale (price ${match.price}, compareAt ${match.compareAtPrice}) — keeping existing sale anchor, logging for later review`
      );
      compareAtPrice = match.compareAtPrice;
    } else if (match.price != null && match.price > salePrice) {
      compareAtPrice = match.price;
    }
  }

  if (!match.inventoryItemId) {
    warnings.push("Variant has no inventoryItem id — cannot set stock");
  }

  if (dryRun) {
    actions.push(
      `[dry-run] would add +${quantity} stock at location ${locationId} for variant ${match.variantId}`
    );
    if (salePrice != null) {
      actions.push(
        `[dry-run] would set price=${salePrice.toFixed(2)}${
          compareAtPrice != null ? ` compareAt=${compareAtPrice.toFixed(2)}` : ""
        }`
      );
    }
    return {
      found: true,
      dryRun,
      gtin,
      ambiguous,
      variant: match,
      locationId,
      plannedStock: quantity,
      plannedSalePrice: salePrice,
      alreadyOnSale,
      actions,
      warnings,
    };
  }

  if (match.inventoryItemId) {
    await activateInventoryAtLocation({
      inventoryItemId: match.inventoryItemId,
      locationId,
    });
    await adjustInventoryAtLocation({
      inventoryItemId: match.inventoryItemId,
      locationId,
      delta: quantity,
    });
    actions.push(`added +${quantity} stock at ${locationId}`);
  }

  if (salePrice != null) {
    await applyVariantSalePrice({
      productId: match.productId,
      variantId: match.variantId,
      salePrice,
      compareAtPrice,
    });
    actions.push(
      `set price=${salePrice.toFixed(2)}${
        compareAtPrice != null ? ` compareAt=${compareAtPrice.toFixed(2)}` : ""
      }`
    );
  }

  // Record in-hand listing so the sold-check cron can watch it.
  if (match.inventoryItemId && quantity > 0) {
    try {
      const resolved = await resolveProviderKeyForGtin(gtin);
      await upsertShopifyListingState({
        providerKey: resolved.providerKey,
        supplierVariantId: resolved.supplierVariantId,
        gtin,
        variantId: match.variantId,
        productId: match.productId,
        inventoryItemId: match.inventoryItemId,
        locationId,
        stock: quantity,
        status: "ACTIVE",
        source: "shopify-restock",
      });
      actions.push(`listing state ACTIVE recorded (${resolved.providerKey})`);
    } catch (err: any) {
      warnings.push(`Listing state record failed: ${err?.message ?? err}`);
    }
  }

  return {
    found: true,
    dryRun,
    gtin,
    ambiguous,
    variant: match,
    locationId,
    plannedStock: quantity,
    plannedSalePrice: salePrice,
    alreadyOnSale,
    actions,
    warnings,
  };
}
