/**
 * Product metafield `custom.soldes_48h` (boolean) — theme SALES badge.
 *
 * Set when a warehouse sale is applied to an in-stock size
 * (`custom.delivery_48h` + compare-at above price). Cleared on reprice
 * when that reduction is gone, even if the size is still in stock.
 * Stock alone does not keep the badge. Tag `soldes-48h` is removed with it.
 *
 * Idempotent: writes only when the product-level value differs.
 */
import { shopifyGraphQL, type ShopifyGraphQLResult } from "@/lib/shopifyAdmin";

export const PRODUCT_SOLDES_48H_METAFIELD = {
  namespace: "custom",
  key: "soldes_48h",
} as const;

export const SOLDES_48H_TAG = "soldes-48h";

const PRODUCT_SOLDES_QUERY = /* GraphQL */ `
query ProductSoldes48h($id: ID!) {
  product(id: $id) {
    id
    tags
    soldes: metafield(namespace: "custom", key: "soldes_48h") { value }
    variants(first: 100) {
      nodes {
        price
        compareAtPrice
        delivery48h: metafield(namespace: "custom", key: "delivery_48h") { value }
      }
    }
  }
}
`;

const METAFIELD_SET_MUTATION = /* GraphQL */ `
mutation SetProductSoldes48h($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    userErrors { field message }
  }
}
`;

const TAGS_REMOVE_MUTATION = /* GraphQL */ `
mutation RemoveSoldes48hTag($id: ID!, $tags: [String!]!) {
  tagsRemove(id: $id, tags: $tags) {
    userErrors { field message }
  }
}
`;

function isTrue(raw: string | null | undefined): boolean {
  return String(raw ?? "").trim().toLowerCase() === "true";
}

function money(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

/** compare-at is a real markdown, not merely present. */
export function hasRealDiscount(
  price: string | number | null | undefined,
  compareAt: string | number | null | undefined
): boolean {
  const p = money(price);
  const c = money(compareAt);
  return p != null && c != null && c > p && c > 0;
}

type SoldesVariantNode = {
  price?: string | null;
  compareAtPrice?: string | null;
  delivery48h?: { value: string | null } | null;
};

/** Warehouse sale still on this size: delivery_48h and compare-at above price. */
export function variantKeepsSoldesBadge(variant: SoldesVariantNode | null | undefined): boolean {
  if (!variant) return false;
  return isTrue(variant.delivery48h?.value) && hasRealDiscount(variant.price, variant.compareAtPrice);
}

function hasSoldesTag(tags: string[] | null | undefined): boolean {
  return (tags ?? []).some((tag) => String(tag).toLowerCase() === SOLDES_48H_TAG);
}

async function resolveProductIdFromVariantId(variantId: string): Promise<string | null> {
  const id = String(variantId ?? "").trim();
  if (!id) return null;
  const { data, errors } = await shopifyGraphQL<{
    productVariant: { product: { id: string } | null } | null;
  }>(
    `query($id: ID!) { productVariant(id: $id) { product { id } } }`,
    { id }
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  return data?.productVariant?.product?.id ?? null;
}

export async function writeProductSoldes48h(productId: string, enabled: boolean): Promise<void> {
  const { errors, data } = await shopifyGraphQL<{
    metafieldsSet: { userErrors: Array<{ message: string }> };
  }>(METAFIELD_SET_MUTATION, {
    metafields: [
      {
        ownerId: productId,
        namespace: PRODUCT_SOLDES_48H_METAFIELD.namespace,
        key: PRODUCT_SOLDES_48H_METAFIELD.key,
        type: "boolean",
        value: enabled ? "true" : "false",
      },
    ],
  });
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  const ue = data?.metafieldsSet?.userErrors ?? [];
  if (ue.length) throw new Error(ue.map((e) => e.message).join("; "));
}

async function removeSoldesTag(productId: string): Promise<void> {
  const { errors, data } = await shopifyGraphQL<{
    tagsRemove: { userErrors: Array<{ message: string }> };
  }>(TAGS_REMOVE_MUTATION, { id: productId, tags: [SOLDES_48H_TAG] });
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  const ue = data?.tagsRemove?.userErrors ?? [];
  if (ue.length) throw new Error(ue.map((e) => e.message).join("; "));
}

/**
 * Sync product `custom.soldes_48h` from live warehouse sale prices.
 * True only while some variant still has delivery_48h and compare-at > price.
 * Reprice (compare-at cleared or no longer above price) turns it off and
 * drops tag soldes-48h. Diff-only. Non-throwing: pushes issues into `warnings`.
 */
export async function syncProductSoldes48hMetafield(
  productId: string,
  changes: string[] = [],
  warnings: string[] = []
): Promise<void> {
  if (!productId) return;
  try {
    const { data, errors } = await shopifyGraphQL<{
      product: {
        tags: string[] | null;
        soldes: { value: string | null } | null;
        variants: { nodes: SoldesVariantNode[] };
      } | null;
    }>(PRODUCT_SOLDES_QUERY, { id: productId });
    if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
    const product = data?.product;
    if (!product) return;

    const current = isTrue(product.soldes?.value);
    const want = (product.variants?.nodes ?? []).some((v) => variantKeepsSoldesBadge(v));
    if (current !== want) {
      await writeProductSoldes48h(productId, want);
      changes.push(
        `Shopify product soldes_48h=${want ? "true" : "false"} (warehouse sale compare-at)`
      );
    }
    if (!want && hasSoldesTag(product.tags)) {
      await removeSoldesTag(productId);
      changes.push(`Shopify tag ${SOLDES_48H_TAG} removed`);
    }
  } catch (err: any) {
    warnings.push(`Shopify soldes_48h metafield failed: ${err?.message ?? err}`);
  }
}

/** Resolve product from a variant id, then sync soldes_48h. Convenience for hooks. */
export async function syncProductSoldes48hForVariant(
  variantId: string,
  changes: string[] = [],
  warnings: string[] = []
): Promise<void> {
  try {
    const productId = await resolveProductIdFromVariantId(variantId);
    if (productId) await syncProductSoldes48hMetafield(productId, changes, warnings);
  } catch (err: any) {
    warnings.push(`Shopify soldes_48h resolve failed: ${err?.message ?? err}`);
  }
}

// Sweep reads price / compare-at / availability only — no per-variant metafields.
const RECONCILE_SOLDES_QUERY = /* GraphQL */ `
query ReconcileSoldes48h($cursor: String) {
  products(first: 10, after: $cursor, query: "metafields.custom.soldes_48h:true") {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      handle
      tags
      soldes: metafield(namespace: "custom", key: "soldes_48h") { value }
      variants(first: 40) {
        nodes { id availableForSale price compareAtPrice }
      }
    }
  }
}
`;

type ReconcileNode = {
  id: string;
  handle: string;
  tags: string[] | null;
  soldes: { value: string | null } | null;
  variants: {
    nodes: Array<{
      id: string;
      availableForSale: boolean;
      price: string | null;
      compareAtPrice: string | null;
    }>;
  };
};
type ReconcileResponse = {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: ReconcileNode[];
  };
};

export type ReconcileSoldes48hResult = {
  scanned: number;
  cleared: number;
  setTrue: number;
  errors: number;
  sample: string[];
};

/**
 * Full sweep over products currently flagged `custom.soldes_48h:true`.
 * Clears the flag when no in-stock variant still has compare-at > price
 * (repriced, or the discounted size sold out). Idempotent; dry-run supported.
 */
export async function reconcileProductSoldes48hMetafields(options?: {
  dryRun?: boolean;
  maxPages?: number;
}): Promise<ReconcileSoldes48hResult> {
  const dryRun = options?.dryRun === true;
  const maxPages = options?.maxPages ?? 200;
  let cursor: string | null = null;
  let scanned = 0;
  let cleared = 0;
  let setTrue = 0;
  let errorCount = 0;
  const sample: string[] = [];

  for (let page = 0; page < maxPages; page += 1) {
    const resp = (await shopifyGraphQL<ReconcileResponse>(
      RECONCILE_SOLDES_QUERY,
      { cursor },
      { estimatedQueryCost: 300 }
    )) as ShopifyGraphQLResult<ReconcileResponse>;
    if (resp.errors?.length) {
      throw new Error(resp.errors.map((e) => e.message).join("; "));
    }
    const conn: ReconcileResponse["products"] | undefined = resp.data?.products;
    if (!conn) break;

    for (const p of conn.nodes) {
      if (!isTrue(p.soldes?.value)) continue;
      scanned += 1;
      const stillOnSale = (p.variants?.nodes ?? []).some(
        (v) => v.availableForSale && hasRealDiscount(v.price, v.compareAtPrice)
      );
      if (stillOnSale) continue;
      try {
        if (!dryRun) {
          await writeProductSoldes48h(p.id, false);
          if (hasSoldesTag(p.tags)) await removeSoldesTag(p.id);
        }
        cleared += 1;
        if (sample.length < 50) sample.push(p.handle);
      } catch {
        errorCount += 1;
      }
    }

    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }

  return { scanned, cleared, setTrue, errors: errorCount, sample };
}
