import { shopifyGraphQL } from "@/lib/shopifyAdmin";

type ShopifyUserError = {
  field?: string[] | null;
  message: string;
};

const PRIMARY_LOCATION_QUERY = /* GraphQL */ `
query PrimaryLocation {
  locations(first: 1, sortKey: NAME) {
    nodes {
      id
      name
    }
  }
}
`;

const VARIANT_SEARCH_QUERY = /* GraphQL */ `
query ProductVariantsSearch($query: String!, $first: Int!) {
  productVariants(first: $first, query: $query) {
    nodes {
      id
      sku
      product {
        id
      }
      inventoryItem {
        id
      }
    }
  }
}
`;

const PRODUCT_CREATE_MUTATION = /* GraphQL */ `
mutation ProductCreate($product: ProductCreateInput!) {
  productCreate(product: $product) {
    product {
      id
      title
      status
      variants(first: 1) {
        nodes {
          id
          sku
          inventoryItem {
            id
          }
        }
      }
    }
    userErrors {
      field
      message
    }
  }
}
`;

/** `productVariantUpdate` removed in Admin API 2026-01 — use bulk update for one variant. */
const PRODUCT_VARIANTS_BULK_UPDATE_MUTATION = /* GraphQL */ `
mutation ProductVariantsBulkUpdatePricing($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    productVariants {
      id
      product {
        id
      }
      inventoryItem {
        id
      }
    }
    userErrors {
      field
      message
    }
  }
}
`;

const INVENTORY_SET_QUANTITIES_MUTATION = /* GraphQL */ `
mutation InventorySetQuantities($input: InventorySetQuantitiesInput!) {
  inventorySetQuantities(input: $input) {
    userErrors {
      field
      message
    }
  }
}
`;

const PRODUCT_ARCHIVE_MUTATION = /* GraphQL */ `
mutation ProductArchive($input: ProductInput!) {
  productUpdate(input: $input) {
    product {
      id
      status
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

export async function getPrimaryLocationId(): Promise<string | null> {
  const { data, errors } = await shopifyGraphQL<{
    locations: {
      nodes: Array<{ id: string; name: string }>;
    };
  }>(PRIMARY_LOCATION_QUERY);
  if (errors?.length) {
    throw new Error(`Shopify locations query failed: ${errors.map((e) => e.message).join("; ")}`);
  }
  return data?.locations?.nodes?.[0]?.id ?? null;
}

type VariantSearchNode = {
  id: string;
  sku: string | null;
  product: { id: string } | null;
  inventoryItem: { id: string } | null;
};

async function searchProductVariants(
  shopifyQuery: string,
  first: number
): Promise<
  Array<{
    variantId: string;
    productId: string;
    inventoryItemId: string | null;
    sku: string | null;
  }>
> {
  const { data, errors } = await shopifyGraphQL<{
    productVariants: { nodes: VariantSearchNode[] };
  }>(VARIANT_SEARCH_QUERY, { query: shopifyQuery, first });
  if (errors?.length) {
    throw new Error(`Shopify variant lookup failed: ${errors.map((e) => e.message).join("; ")}`);
  }
  const nodes = data?.productVariants?.nodes ?? [];
  return nodes
    .filter((node) => node?.id && node?.product?.id)
    .map((node) => ({
      variantId: node.id,
      productId: node.product!.id,
      inventoryItemId: node.inventoryItem?.id ?? null,
      sku: node.sku ?? null,
    }));
}

export async function findVariantBySku(sku: string): Promise<{
  variantId: string;
  productId: string;
  inventoryItemId: string | null;
} | null> {
  const escaped = sku.replace(/"/g, '\\"');
  const rows = await searchProductVariants(`sku:${escaped}`, 1);
  const row = rows[0];
  if (!row) return null;
  return {
    variantId: row.variantId,
    productId: row.productId,
    inventoryItemId: row.inventoryItemId,
  };
}

/** Same GTIN on another variant SKU = duplicate listing risk (e.g. normal vs liquidation). */
export async function findShopifyVariantsByGtin(gtin: string): Promise<
  Array<{
    variantId: string;
    productId: string;
    inventoryItemId: string | null;
    sku: string | null;
  }>
> {
  const cleaned = String(gtin).trim();
  if (!cleaned) return [];
  const escaped = cleaned.replace(/"/g, '\\"');
  return searchProductVariants(`barcode:${escaped}`, 5);
}

export function describeGtinSkuConflict(
  expectedSku: string,
  matches: Array<{ sku: string | null; variantId: string }>
): string | null {
  const exp = String(expectedSku).trim();
  const otherSkus = matches
    .map((m) => String(m.sku ?? "").trim())
    .filter(Boolean)
    .filter((s) => s !== exp);
  if (otherSkus.length === 0) return null;
  const unique = Array.from(new Set(otherSkus));
  return `Shopify already has this barcode (GTIN) on variant(s) with different SKU(s): ${unique.join(", ")}. Remove/rename the conflicting variant or reuse that SKU — refusing to create a duplicate product.`;
}

export async function createProductWithVariant(input: {
  title: string;
  brand: string | null;
  providerKey: string;
  gtin: string | null;
  price: number;
}): Promise<{ productId: string; variantId: string | null; inventoryItemId: string | null }> {
  const productInput = {
    title: input.title,
    vendor: input.brand ?? undefined,
    tags: [input.providerKey, "synced-by-agent"],
    status: "ACTIVE",
  };

  const { data, errors } = await shopifyGraphQL<{
    productCreate: {
      product: {
        id: string;
        variants: {
          nodes: Array<{
            id: string;
            inventoryItem: { id: string } | null;
          }>;
        };
      } | null;
      userErrors: ShopifyUserError[];
    };
  }>(PRODUCT_CREATE_MUTATION, { product: productInput });

  if (errors?.length) {
    throw new Error(`Shopify productCreate failed: ${errors.map((e) => e.message).join("; ")}`);
  }
  assertNoUserErrors(data?.productCreate?.userErrors, "productCreate");

  const productId = data?.productCreate?.product?.id;
  const variantId = data?.productCreate?.product?.variants?.nodes?.[0]?.id ?? null;
  const inventoryItemId =
    data?.productCreate?.product?.variants?.nodes?.[0]?.inventoryItem?.id ?? null;
  if (!productId) {
    throw new Error("productCreate did not return product id");
  }

  if (variantId) {
    await updateVariantPricingAndIdentity({
      productId,
      variantId,
      sku: input.providerKey,
      barcode: input.gtin,
      price: input.price,
    });
  }

  return { productId, variantId, inventoryItemId };
}

export async function updateVariantPricingAndIdentity(input: {
  productId: string;
  variantId: string;
  sku: string;
  barcode: string | null;
  price: number;
}): Promise<{ variantId: string; productId: string | null; inventoryItemId: string | null }> {
  const variantPayload: Record<string, unknown> = {
    id: input.variantId,
    price: input.price.toFixed(2),
    inventoryItem: {
      sku: input.sku,
    },
  };
  if (input.barcode) {
    variantPayload.barcode = input.barcode;
  }

  const { data, errors } = await shopifyGraphQL<{
    productVariantsBulkUpdate: {
      productVariants: Array<{
        id: string;
        product: { id: string } | null;
        inventoryItem: { id: string } | null;
      }>;
      userErrors: ShopifyUserError[];
    };
  }>(PRODUCT_VARIANTS_BULK_UPDATE_MUTATION, {
    productId: input.productId,
    variants: [variantPayload],
  });

  if (errors?.length) {
    throw new Error(`Shopify variant update failed: ${errors.map((e) => e.message).join("; ")}`);
  }
  assertNoUserErrors(data?.productVariantsBulkUpdate?.userErrors, "productVariantsBulkUpdate");

  const variant = data?.productVariantsBulkUpdate?.productVariants?.[0];
  return {
    variantId: variant?.id ?? input.variantId,
    productId: variant?.product?.id ?? input.productId,
    inventoryItemId: variant?.inventoryItem?.id ?? null,
  };
}

export async function setInventoryQuantity(input: {
  inventoryItemId: string;
  locationId: string;
  quantity: number;
}) {
  const payload = {
    name: "available",
    reason: "correction",
    ignoreCompareQuantity: true,
    quantities: [
      {
        inventoryItemId: input.inventoryItemId,
        locationId: input.locationId,
        quantity: Math.max(0, Math.trunc(input.quantity)),
      },
    ],
  };

  const { data, errors } = await shopifyGraphQL<{
    inventorySetQuantities: {
      userErrors: ShopifyUserError[];
    };
  }>(INVENTORY_SET_QUANTITIES_MUTATION, { input: payload });
  if (errors?.length) {
    throw new Error(`Shopify inventorySetQuantities failed: ${errors.map((e) => e.message).join("; ")}`);
  }
  assertNoUserErrors(data?.inventorySetQuantities?.userErrors, "inventorySetQuantities");
}

export async function archiveProduct(productId: string) {
  const { data, errors } = await shopifyGraphQL<{
    productUpdate: {
      product: { id: string; status: string } | null;
      userErrors: ShopifyUserError[];
    };
  }>(PRODUCT_ARCHIVE_MUTATION, {
    input: {
      id: productId,
      status: "ARCHIVED",
    },
  });
  if (errors?.length) {
    throw new Error(`Shopify product archive failed: ${errors.map((e) => e.message).join("; ")}`);
  }
  assertNoUserErrors(data?.productUpdate?.userErrors, "productUpdate");
}
