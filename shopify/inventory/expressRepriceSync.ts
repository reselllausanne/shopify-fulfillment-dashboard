/**
 * Reprice trigger — keep custom.express_available / custom.express_price in sync
 * with stock + price, PER VARIANT, on a Shopify products/update (variant price)
 * event.
 *
 * Two variant metafields drive the storefront (FullStack theme):
 *   - custom.express_available (boolean) — physical 48h capability. TRUE only when
 *     on-hand qty > 0 at an express-capable location (Bussigny + shops).
 *   - custom.express_price (money) — express option price. Theme shows the express
 *     badge only when variant.available && express_price >= effective variant price.
 *
 * This worker is intentionally NARROW and idempotent so it is safe to run on the
 * high-frequency products/update webhook without loops or write storms:
 *   1. express_available := (physicalQty > 0). Diff-only write.
 *   2. express_price: if a value exists and it dropped BELOW the current variant
 *      price (a reprice made it stale → theme would hide/mismatch the express
 *      option), raise it back to the express floor (current price + surcharge).
 *      We never CLEAR or CREATE express_price here — StockX dropship variants
 *      legitimately carry an express_price ("Livraison express 2-5j") while
 *      physical=0; clearing it storewide would kill that lane. Creation/lane
 *      pricing stays owned by syncShopifyStxPrices / convergence.
 *
 * All reads batch via nodes(ids). All writes batch via a single metafieldsSet
 * (chunked at 25). Only changed metafields are written.
 */
import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { PHYSICAL_LOCATIONS } from "@/shopify/inventory/locationConfig";
import {
  ceilToWholeFranc,
  readStxExpressSurchargeChf,
} from "@/shopify/pricing/calcShopifySellPrice";
import { parseExpressPriceMetafieldAmount } from "@/shopify/restock/liquidationExpressPrice";

export const EXPRESS_AVAILABLE_METAFIELD = {
  namespace: "custom",
  key: "express_available",
} as const;

export const EXPRESS_PRICE_METAFIELD = {
  namespace: "custom",
  key: "express_price",
} as const;

const PRICE_EPSILON = 0.005;

const VARIANT_STATE_QUERY = /* GraphQL */ `
query ExpressRepriceVariantState($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on ProductVariant {
      id
      price
      barcode
      expressAvailable: metafield(namespace: "custom", key: "express_available") { value }
      expressPrice: metafield(namespace: "custom", key: "express_price") { value }
    }
  }
}
`;

const METAFIELDS_SET_MUTATION = /* GraphQL */ `
mutation ExpressRepriceSet($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id namespace key }
    userErrors { field message }
  }
}
`;

export type ProductsUpdateVariant = {
  admin_graphql_api_id?: string | null;
  id?: number | string | null;
  price?: string | number | null;
  barcode?: string | null;
};

export type ProductsUpdatePayload = {
  id?: number | string | null;
  admin_graphql_api_id?: string | null;
  handle?: string | null;
  variants?: ProductsUpdateVariant[] | null;
};

export type ExpressRepriceVariantChange = {
  variantId: string;
  physicalQty: number;
  price: number | null;
  expressAvailable?: { from: boolean; to: boolean };
  expressPrice?: { from: number | null; to: number };
};

export type ProcessProductsUpdateResult = {
  productId: string | null;
  variantsScanned: number;
  changed: ExpressRepriceVariantChange[];
  warnings: string[];
};

function toVariantGid(idish: number | string | null | undefined): string | null {
  if (idish == null) return null;
  const s = String(idish).trim();
  if (!s) return null;
  if (s.startsWith("gid://")) return s;
  if (/^\d+$/.test(s)) return `gid://shopify/ProductVariant/${s}`;
  return null;
}

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isTruthyMetafield(raw: string | null | undefined): boolean {
  return String(raw ?? "").trim().toLowerCase() === "true";
}

/**
 * On-hand physical qty per variant across express-capable locations
 * (Bussigny + Antica + Lab + COLD BIEN). Keyed by Shopify variant gid.
 * Excludes the online/dropship (Chemin) + supplier (Money Kickz) pools.
 */
export async function loadPhysicalQtyByVariantId(
  variantIds: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = Array.from(new Set(variantIds.map((v) => String(v ?? "").trim()).filter(Boolean)));
  if (ids.length === 0) return out;

  const physicalLocIds = PHYSICAL_LOCATIONS.map((l) => l.id);
  const rows = await prisma.$queryRaw<Array<{ variant_id: string; qty: number }>>`
    SELECT s."shopifyVariantId" AS variant_id, COALESCE(SUM(s."available"), 0)::int AS qty
    FROM "public"."ShopifyVariantLocationStock" s
    WHERE s."shopifyVariantId" = ANY(${ids}::text[])
      AND s."sourceType" = 'physical'
      AND s."locationId" = ANY(${physicalLocIds}::text[])
    GROUP BY s."shopifyVariantId"
  `;
  for (const r of rows) {
    out.set(String(r.variant_id), Math.max(0, Number(r.qty ?? 0)));
  }
  for (const id of ids) if (!out.has(id)) out.set(id, 0);
  return out;
}

type MetafieldSetInput = {
  ownerId: string;
  namespace: string;
  key: string;
  type: "boolean" | "money";
  value: string;
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Recompute express metafields for a set of Shopify variant gids. Pure of the
 * webhook envelope so it can also drive a periodic reconcile over any variant
 * list. Idempotent: writes only diffs, returns the applied changes.
 */
export async function syncExpressForVariants(
  variantIds: string[],
  options: { dryRun?: boolean } = {}
): Promise<{ changed: ExpressRepriceVariantChange[]; scanned: number; warnings: string[] }> {
  const warnings: string[] = [];
  const ids = Array.from(new Set(variantIds.map((v) => String(v ?? "").trim()).filter(Boolean)));
  if (ids.length === 0) return { changed: [], scanned: 0, warnings };

  const { data, errors } = await shopifyGraphQL<{
    nodes: Array<
      | {
          id: string;
          price: string | null;
          barcode: string | null;
          expressAvailable: { value: string | null } | null;
          expressPrice: { value: string | null } | null;
        }
      | null
    >;
  }>(VARIANT_STATE_QUERY, { ids });
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));

  const nodes = (data?.nodes ?? []).filter((n): n is NonNullable<typeof n> => Boolean(n?.id));

  const physicalByVariant = await loadPhysicalQtyByVariantId(nodes.map((n) => n.id));
  const surcharge = readStxExpressSurchargeChf();

  const changes: ExpressRepriceVariantChange[] = [];
  const writes: MetafieldSetInput[] = [];

  for (const node of nodes) {
    const variantId = node.id;
    const price = toNumber(node.price);
    const physicalQty = physicalByVariant.get(variantId) ?? 0;

    const change: ExpressRepriceVariantChange = { variantId, physicalQty, price };
    let dirty = false;

    // 1) express_available := physical on-hand > 0 (exact variant).
    const currentAvailable = isTruthyMetafield(node.expressAvailable?.value);
    const wantAvailable = physicalQty > 0;
    if (currentAvailable !== wantAvailable) {
      writes.push({
        ownerId: variantId,
        namespace: EXPRESS_AVAILABLE_METAFIELD.namespace,
        key: EXPRESS_AVAILABLE_METAFIELD.key,
        type: "boolean",
        value: wantAvailable ? "true" : "false",
      });
      change.expressAvailable = { from: currentAvailable, to: wantAvailable };
      dirty = true;
    }

    // 2) express_price floor: raise back over the current price when a reprice
    //    left it stale (theme hides express when express_price < price).
    const currentExpress = parseExpressPriceMetafieldAmount(node.expressPrice?.value);
    if (
      currentExpress != null &&
      price != null &&
      price > 0 &&
      currentExpress + PRICE_EPSILON < price
    ) {
      const target = ceilToWholeFranc(price + surcharge);
      if (Math.abs(currentExpress - target) > PRICE_EPSILON) {
        writes.push({
          ownerId: variantId,
          namespace: EXPRESS_PRICE_METAFIELD.namespace,
          key: EXPRESS_PRICE_METAFIELD.key,
          type: "money",
          value: JSON.stringify({ amount: target.toFixed(2), currency_code: "CHF" }),
        });
        change.expressPrice = { from: currentExpress, to: target };
        dirty = true;
      }
    }

    if (dirty) changes.push(change);
  }

  // Bulk write — one metafieldsSet per 25 metafields (Shopify cap).
  if (options.dryRun) {
    return { changed: changes, scanned: nodes.length, warnings };
  }
  for (const batch of chunk(writes, 25)) {
    const { errors: setErrors, data: setData } = await shopifyGraphQL<{
      metafieldsSet: { userErrors: Array<{ field?: string[]; message: string }> };
    }>(METAFIELDS_SET_MUTATION, { metafields: batch });
    if (setErrors?.length) throw new Error(setErrors.map((e) => e.message).join("; "));
    const ue = setData?.metafieldsSet?.userErrors ?? [];
    if (ue.length) warnings.push(...ue.map((e) => e.message));
  }

  return { changed: changes, scanned: nodes.length, warnings };
}

/** products/update webhook body → express metafield sync for its variants. */
export async function processProductsUpdatePayload(
  payload: ProductsUpdatePayload
): Promise<ProcessProductsUpdateResult> {
  const productId =
    (payload.admin_graphql_api_id && String(payload.admin_graphql_api_id)) ||
    (payload.id != null ? `gid://shopify/Product/${String(payload.id)}` : null);

  const variantIds = (payload.variants ?? [])
    .map((v) => toVariantGid(v.admin_graphql_api_id ?? v.id))
    .filter((v): v is string => Boolean(v));

  if (variantIds.length === 0) {
    return { productId, variantsScanned: 0, changed: [], warnings: [] };
  }

  const { changed, scanned, warnings } = await syncExpressForVariants(variantIds);
  return { productId, variantsScanned: scanned, changed, warnings };
}
