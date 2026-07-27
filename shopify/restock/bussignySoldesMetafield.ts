import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { BUSSIGNY_LOCATION_ID } from "@/shopify/restock/bussignyDeliveryMetafield";

/** Product metafield for Shopify automated collection "soldes 48h". */
export const SOLDES_48H_METAFIELD = {
  namespace: "custom",
  key: "soldes_48h",
} as const;

const PRODUCT_SOLDES_QUERY = /* GraphQL */ `
query ProductSoldes48h($id: ID!) {
  product(id: $id) {
    id
    soldes48h: metafield(namespace: "custom", key: "soldes_48h") { value }
    variants(first: 100) {
      nodes { id }
    }
  }
}
`;

const METAFIELD_SET_MUTATION = /* GraphQL */ `
mutation SetSoldes48h($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    userErrors { field message }
  }
}
`;

const DEFINITION_LIST_QUERY = /* GraphQL */ `
query Soldes48hDefinition {
  metafieldDefinitions(first: 50, ownerType: PRODUCT, namespace: "custom") {
    nodes { id key }
  }
}
`;

const DEFINITION_CREATE_MUTATION = /* GraphQL */ `
mutation CreateSoldes48hDefinition($definition: MetafieldDefinitionInput!) {
  metafieldDefinitionCreate(definition: $definition) {
    createdDefinition { id name namespace key }
    userErrors { field message code }
  }
}
`;

const VARIANT_PRODUCT_QUERY = /* GraphQL */ `
query VariantProduct($id: ID!) {
  productVariant(id: $id) {
    id
    product { id }
  }
}
`;

let soldes48hDefinitionReady: boolean | null = null;

/** Creates pinned PRODUCT definition so `Soldes 48h` shows in Shopify admin. */
export async function ensureSoldes48hMetafieldDefinition(): Promise<{ ok: boolean; created: boolean }> {
  if (soldes48hDefinitionReady) return { ok: true, created: false };

  const { data: listData, errors: listErrors } = await shopifyGraphQL<{
    metafieldDefinitions: { nodes: Array<{ id: string; key: string }> };
  }>(DEFINITION_LIST_QUERY, {});
  if (listErrors?.length) throw new Error(listErrors.map((e) => e.message).join("; "));

  const existing = (listData?.metafieldDefinitions?.nodes ?? []).find(
    (n) => n.key === SOLDES_48H_METAFIELD.key
  );
  if (existing?.id) {
    soldes48hDefinitionReady = true;
    return { ok: true, created: false };
  }

  const { errors, data } = await shopifyGraphQL<{
    metafieldDefinitionCreate: {
      createdDefinition: { id: string } | null;
      userErrors: Array<{ message: string; code?: string }>;
    };
  }>(DEFINITION_CREATE_MUTATION, {
    definition: {
      name: "Soldes 48h",
      namespace: SOLDES_48H_METAFIELD.namespace,
      key: SOLDES_48H_METAFIELD.key,
      description: "Physical stock at Warehouse Bussigny — show in soldes 48h collection.",
      type: "boolean",
      ownerType: "PRODUCT",
      pin: true,
    },
  });
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  const ue = data?.metafieldDefinitionCreate?.userErrors ?? [];
  const msg = ue.map((e) => e.message).join("; ").toLowerCase();
  if (ue.length && !msg.includes("taken") && !msg.includes("already") && !msg.includes("exists")) {
    throw new Error(ue.map((e) => e.message).join("; "));
  }

  soldes48hDefinitionReady = true;
  return { ok: true, created: Boolean(data?.metafieldDefinitionCreate?.createdDefinition?.id) };
}

export async function resolveProductIdFromVariantId(variantId: string): Promise<string | null> {
  const { data, errors } = await shopifyGraphQL<{
    productVariant: { product: { id: string } } | null;
  }>(VARIANT_PRODUCT_QUERY, { id: variantId });
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  return data?.productVariant?.product?.id ?? null;
}

async function readProductSoldes48hState(productId: string): Promise<{
  enabled: boolean;
  variantIds: string[];
}> {
  const { data, errors } = await shopifyGraphQL<{
    product: {
      soldes48h: { value: string | null } | null;
      variants: { nodes: Array<{ id: string }> };
    } | null;
  }>(PRODUCT_SOLDES_QUERY, { id: productId });
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  return {
    enabled: String(data?.product?.soldes48h?.value ?? "").toLowerCase() === "true",
    variantIds: (data?.product?.variants?.nodes ?? []).map((v) => v.id).filter(Boolean),
  };
}

async function bussignyQtyForVariantIds(variantIds: string[]): Promise<number> {
  if (variantIds.length === 0) return 0;
  const rows = await prisma.$queryRaw<Array<{ available: number }>>`
    SELECT COALESCE(SUM(s."available"), 0)::int AS available
    FROM "public"."ShopifyVariantLocationStock" s
    WHERE s."shopifyVariantId" = ANY(${variantIds}::text[])
      AND s."locationId" = ${BUSSIGNY_LOCATION_ID}
      AND s."sourceType" = 'physical'
      AND s."available" > 0
  `;
  return Number(rows[0]?.available ?? 0);
}

/**
 * Bussigny qty restricted to variants whose GTIN carries a REAL liquidation
 * lock (stx_ SupplierVariant.manualLock). Qty alone must not put a product in
 * the soldes collection when its price was never actually changed.
 */
async function bussignyLiquidationQtyForVariantIds(variantIds: string[]): Promise<number> {
  if (variantIds.length === 0) return 0;
  const rows = await prisma.$queryRaw<Array<{ available: number }>>`
    SELECT COALESCE(SUM(s."available"), 0)::int AS available
    FROM "public"."ShopifyVariantLocationStock" s
    WHERE s."shopifyVariantId" = ANY(${variantIds}::text[])
      AND s."locationId" = ${BUSSIGNY_LOCATION_ID}
      AND s."sourceType" = 'physical'
      AND s."available" > 0
      AND EXISTS (
        SELECT 1
        FROM "public"."SupplierVariant" sv
        WHERE sv."gtin" = s."gtin"
          AND sv."supplierVariantId" LIKE 'stx\\_%' ESCAPE '\\'
          AND sv."manualLock" = true
      )
  `;
  return Number(rows[0]?.available ?? 0);
}

export async function getBussignyQtyForProduct(productId: string): Promise<number> {
  const { variantIds } = await readProductSoldes48hState(productId);
  return bussignyQtyForVariantIds(variantIds);
}

export async function readProductSoldes48h(productId: string): Promise<boolean> {
  const { enabled } = await readProductSoldes48hState(productId);
  return enabled;
}

export async function writeProductSoldes48h(productId: string, enabled: boolean): Promise<void> {
  await ensureSoldes48hMetafieldDefinition();
  const { errors, data } = await shopifyGraphQL<{
    metafieldsSet: { userErrors: Array<{ message: string }> };
  }>(METAFIELD_SET_MUTATION, {
    metafields: [
      {
        ownerId: productId,
        namespace: SOLDES_48H_METAFIELD.namespace,
        key: SOLDES_48H_METAFIELD.key,
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
 * Set product custom.soldes_48h when any variant has Bussigny mirror stock > 0
 * WITH a real liquidation lock (price actually changed); clear otherwise.
 */
export async function syncSoldes48hProductMetafield(
  productId: string | null | undefined,
  changes: string[],
  warnings: string[]
): Promise<void> {
  if (!productId) return;
  try {
    const { enabled, variantIds } = await readProductSoldes48hState(productId);
    const liquidationQty = await bussignyLiquidationQtyForVariantIds(variantIds);
    const want = liquidationQty > 0;
    if (want !== enabled) {
      await writeProductSoldes48h(productId, want);
      changes.push(
        `Shopify product soldes_48h=${want ? "true" : "false"} (Bussigny liquidation qty=${liquidationQty})`
      );
    }
  } catch (err: any) {
    warnings.push(`Shopify soldes_48h metafield failed: ${err?.message ?? err}`);
  }
}
