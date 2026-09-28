/**
 * Product metafield `custom.soldes_48h` (boolean).
 *
 * Legacy soldes flag the FullStack theme still reads to render the "SALES"
 * promotional picto on the product card / PDP. The soldes system moved to the
 * variant metafield `custom.delivery_48h` (+ product `custom.physical_in_stock`),
 * but nothing kept `soldes_48h` in sync — so a pair that was once on soldes and
 * later sold out kept `soldes_48h=true` and showed a stuck SALES badge.
 *
 * Rule (link to OUR stock): soldes_48h(product) = true iff ANY variant has
 * `custom.delivery_48h=true`. delivery_48h is itself stock-linked (convergence
 * sets it only with a real liquidation lock + physical qty > 0, and clears it
 * when physical hits 0), so soldes_48h follows local stock automatically.
 *
 * Idempotent: writes only when the product-level value differs.
 */
import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL, type ShopifyGraphQLResult } from "@/lib/shopifyAdmin";
import { PHYSICAL_LOCATIONS } from "@/shopify/inventory/locationConfig";

export const PRODUCT_SOLDES_48H_METAFIELD = {
  namespace: "custom",
  key: "soldes_48h",
} as const;

const PRODUCT_SOLDES_QUERY = /* GraphQL */ `
query ProductSoldes48h($id: ID!) {
  product(id: $id) {
    id
    soldes: metafield(namespace: "custom", key: "soldes_48h") { value }
    variants(first: 100) {
      nodes {
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

function isTrue(raw: string | null | undefined): boolean {
  return String(raw ?? "").trim().toLowerCase() === "true";
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

/**
 * Sync product `custom.soldes_48h` from variant `custom.delivery_48h` (OR).
 * Diff-only. Non-throwing: pushes issues into `warnings`.
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
        soldes: { value: string | null } | null;
        variants: { nodes: Array<{ delivery48h: { value: string | null } | null }> };
      } | null;
    }>(PRODUCT_SOLDES_QUERY, { id: productId });
    if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
    const product = data?.product;
    if (!product) return;

    const current = isTrue(product.soldes?.value);
    const want = (product.variants?.nodes ?? []).some((v) => isTrue(v.delivery48h?.value));
    if (current !== want) {
      await writeProductSoldes48h(productId, want);
      changes.push(`Shopify product soldes_48h=${want ? "true" : "false"} (any variant delivery_48h)`);
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

// Cheap sweep query: variant IDs only (no per-variant metafields). Physical
// stock is resolved from the DB mirror, so we never pay Shopify query cost for
// delivery_48h across the whole soldes set (that read throttles hard).
const RECONCILE_SOLDES_QUERY = /* GraphQL */ `
query ReconcileSoldes48h($cursor: String) {
  products(first: 10, after: $cursor, query: "metafields.custom.soldes_48h:true") {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      handle
      soldes: metafield(namespace: "custom", key: "soldes_48h") { value }
      variants(first: 40) { nodes { id } }
    }
  }
}
`;

type ReconcileNode = {
  id: string;
  handle: string;
  soldes: { value: string | null } | null;
  variants: { nodes: Array<{ id: string }> };
};
type ReconcileResponse = {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: ReconcileNode[];
  };
};

/** Physical on-hand qty across express/soldes-capable locations for a variant set. */
async function physicalQtyForVariantIds(variantIds: string[]): Promise<number> {
  if (variantIds.length === 0) return 0;
  const physIds = PHYSICAL_LOCATIONS.map((l) => l.id);
  const rows = await prisma.$queryRaw<Array<{ qty: number }>>`
    SELECT COALESCE(SUM(s."available"), 0)::int AS qty
    FROM "public"."ShopifyVariantLocationStock" s
    WHERE s."shopifyVariantId" = ANY(${variantIds}::text[])
      AND s."sourceType" = 'physical'
      AND s."locationId" = ANY(${physIds}::text[])
      AND s."available" > 0
  `;
  return Number(rows[0]?.qty ?? 0);
}

export type ReconcileSoldes48hResult = {
  scanned: number;
  cleared: number;
  setTrue: number;
  errors: number;
  sample: string[];
};

/**
 * Full sweep over products currently flagged `custom.soldes_48h:true`.
 * Clears the flag when no variant has delivery_48h=true (i.e. no live soldes
 * stock). Idempotent; dry-run supported.
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
      const variantIds = (p.variants?.nodes ?? []).map((v) => v.id).filter(Boolean);
      const physicalQty = await physicalQtyForVariantIds(variantIds);
      if (physicalQty > 0) continue; // still holds local stock — keep soldes as-is
      try {
        if (!dryRun) await writeProductSoldes48h(p.id, false);
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
