import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import {
  LOCATIONS,
  ONLINE_LOCATION,
  PHYSICAL_LOCATIONS,
  type LocationConfig,
} from "@/shopify/inventory/locationConfig";
import { upsertLocationStockRow } from "@/shopify/inventory/locationMirror";
import {
  adjustInventoryAtLocation,
  findShopifyVariantByGtin,
  getShopifyVariantDetail,
  getInventoryAvailableAtLocation,
} from "@/shopify/restock/shopifyRestockInventory";
import { gtinCandidates } from "@/shopify/restock/gtinNormalize";

/** Web sale: consume physical first, then online/dropship remainder. */
const WEB_SALE_DECREMENT_LOCATIONS: LocationConfig[] = [
  ...PHYSICAL_LOCATIONS,
  ...(ONLINE_LOCATION ? [ONLINE_LOCATION] : []),
];

export type SyncMirrorForGtinResult = {
  gtin: string;
  synced: number;
  levels: Array<{ locationName: string; available: number }>;
};

/**
 * Pull live Shopify available qty per location into ShopifyVariantLocationStock.
 * Convergence reads the mirror — without this, paid-but-unfulfilled sales leave stale qty.
 */
export async function syncMirrorForGtinFromShopify(
  gtin: string,
  options?: { preferredVariantId?: string | null }
): Promise<SyncMirrorForGtinResult> {
  const cleanGtin = String(gtin ?? "").trim();
  const empty: SyncMirrorForGtinResult = { gtin: cleanGtin, synced: 0, levels: [] };
  if (!cleanGtin) return empty;

  const preferredVariantId = String(options?.preferredVariantId ?? "").trim() || null;
  const { match } = await resolveShopifyVariantForWebSale(cleanGtin, preferredVariantId);
  if (!match?.inventoryItemId || !match.variantId) return empty;

  const now = new Date();
  const levels: SyncMirrorForGtinResult["levels"] = [];

  for (const loc of LOCATIONS) {
    const available =
      (await getInventoryAvailableAtLocation({
        inventoryItemId: match.inventoryItemId,
        locationId: loc.id,
      })) ?? 0;

    levels.push({ locationName: loc.name, available });

    await upsertLocationStockRow(loc, {
      shopifyVariantId: match.variantId,
      inventoryItemId: match.inventoryItemId,
      sku: match.sku,
      gtin: cleanGtin,
      available: Math.max(0, available),
    }, now);

    if (available <= 0) {
      await prisma.$executeRaw`
        UPDATE "public"."ShopifyVariantLocationStock"
        SET "available" = 0, "updatedAt" = ${now}, "lastSeenAt" = ${now}
        WHERE "shopifyVariantId" = ${match.variantId}
          AND "locationId" = ${loc.id}
      `;
    }
  }

  return { gtin: cleanGtin, synced: levels.length, levels };
}

async function resolveShopifyVariantForWebSale(
  gtin: string,
  preferredVariantId: string | null
): Promise<{
  match: Awaited<ReturnType<typeof getShopifyVariantDetail>> | null;
  warnings: string[];
}> {
  const warnings: string[] = [];
  const preferred = String(preferredVariantId ?? "").trim();
  if (preferred) {
    try {
      const byId = await getShopifyVariantDetail(preferred);
      if (byId) {
        const cleanGtin = String(gtin ?? "").trim();
        const barcode = String(byId.barcode ?? "").trim();
        if (cleanGtin && barcode && !gtinCandidates(cleanGtin).includes(barcode)) {
          warnings.push(`variant barcode mismatch: expected ${cleanGtin}, got ${barcode}`);
        }
        return { match: byId, warnings };
      }
      warnings.push(`variant not found by id: ${preferred}`);
    } catch (err: any) {
      warnings.push(`variant lookup by id failed: ${err?.message ?? err}`);
    }
  }

  const { match, ambiguous } = await findShopifyVariantByGtin(gtin);
  if (ambiguous) warnings.push("ambiguous GTIN match — using first variant");
  return { match, warnings };
}

export type DecrementWebSaleStockResult = {
  gtin: string;
  decremented: number;
  locations: Array<{ locationId: string; locationName: string; delta: number }>;
  warnings: string[];
};

/**
 * Paid Shopify web order: decrement physical/home stock immediately (do not wait for fulfill).
 * Idempotent per order line via Shopify referenceDocumentUri.
 */
export async function decrementShopifyWebSaleStock(input: {
  gtin: string;
  quantity: number;
  orderId: string;
  lineItemId?: string | null;
  preferredVariantId?: string | null;
  idempotencyScope?: string | null;
}): Promise<DecrementWebSaleStockResult> {
  const warnings: string[] = [];
  const locations: DecrementWebSaleStockResult["locations"] = [];
  const gtin = String(input.gtin ?? "").trim();
  const saleQty = Math.max(0, Math.trunc(input.quantity));
  if (!gtin || saleQty <= 0) {
    return { gtin, decremented: 0, locations, warnings };
  }

  const resolved = await resolveShopifyVariantForWebSale(gtin, input.preferredVariantId ?? null);
  const match = resolved.match;
  if (resolved.warnings.length) warnings.push(...resolved.warnings);
  if (!match?.inventoryItemId || !match.variantId) {
    warnings.push("no Shopify inventory item");
    return { gtin, decremented: 0, locations, warnings };
  }

  let unitsLeft = saleQty;
  let decremented = 0;
  const orderKey = String(input.orderId ?? "unknown").replace(/\s+/g, "");
  const lineKey = String(input.lineItemId ?? "line").replace(/\s+/g, "");
  const scopeKey = String(input.idempotencyScope ?? "sale").replace(/\s+/g, "") || "sale";

  for (const loc of WEB_SALE_DECREMENT_LOCATIONS) {
    if (unitsLeft <= 0) break;

    const liveQty = await getInventoryAvailableAtLocation({
      inventoryItemId: match.inventoryItemId,
      locationId: loc.id,
    });
    const available = liveQty ?? 0;
    if (available <= 0) continue;

    const dec = Math.min(unitsLeft, available);
    const idempotencyKey = `shopify-web-sale:${scopeKey}:${orderKey}:${lineKey}:${loc.id}:${match.inventoryItemId}`;

    try {
      await adjustInventoryAtLocation({
        inventoryItemId: match.inventoryItemId,
        locationId: loc.id,
        delta: -dec,
        idempotencyKey,
        reason: "correction",
        referenceDocumentUri: `gid://resell-lausanne/ShopifyWebSale/${orderKey}/${lineKey}`,
      });
    } catch (err: any) {
      warnings.push(`decrement ${loc.name} failed: ${err?.message ?? err}`);
      continue;
    }

    const availableNow =
      (await getInventoryAvailableAtLocation({
        inventoryItemId: match.inventoryItemId,
        locationId: loc.id,
      })) ?? Math.max(0, available - dec);

    await upsertLocationStockRow(loc, {
      shopifyVariantId: match.variantId,
      inventoryItemId: match.inventoryItemId,
      sku: match.sku,
      gtin,
      available: availableNow,
    });

    locations.push({ locationId: loc.id, locationName: loc.name, delta: -dec });
    decremented += dec;
    unitsLeft -= dec;
  }

  if (decremented <= 0) {
    warnings.push("no location had available stock to decrement");
  }

  return { gtin, decremented, locations, warnings };
}

const VARIANT_LIVE_LEVELS_QUERY = /* GraphQL */ `
query VariantLiveLevels($id: ID!) {
  productVariant(id: $id) {
    id
    price
    compareAtPrice
    metafield(namespace: "custom", key: "price_locked") { value }
  }
}
`;

export async function readShopifyVariantPriceState(variantId: string): Promise<{
  price: number | null;
  compareAtPrice: number | null;
  priceLocked: boolean;
}> {
  const { data, errors } = await shopifyGraphQL<{
    productVariant: {
      price: string | null;
      compareAtPrice: string | null;
      metafield: { value: string | null } | null;
    } | null;
  }>(VARIANT_LIVE_LEVELS_QUERY, { id: variantId });
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  const node = data?.productVariant;
  const toNum = (v: string | null | undefined) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    price: toNum(node?.price),
    compareAtPrice: toNum(node?.compareAtPrice),
    priceLocked: String(node?.metafield?.value ?? "").toLowerCase() === "true",
  };
}
