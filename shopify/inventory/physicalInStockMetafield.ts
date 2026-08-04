import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";

/**
 * Product metafield `custom.physical_in_stock`.
 * True when any variant has qty > 0 at a physical location (Bussigny/Antica/Lab/COLD BIEN).
 * Used by Shopify smart collection "in stock (physical)" — separate from liquidation
 * `delivery_48h` (soldes pricing). Both can be true for warehouse stock.
 *
 * Also keeps Google Ads filterable attribute in sync:
 *   `mm-google-shopping.custom_label_0` = "in_store" when physical qty > 0
 * Cleared when last physical unit sells (any channel) so product drops out of
 * Google Ads custom-label product groups.
 */

const VARIANT_PRODUCT_QUERY = /* GraphQL */ `
query PhysicalInStockVariantProduct($id: ID!) {
  productVariant(id: $id) {
    id
    product { id }
  }
}
`;

async function resolveProductIdFromVariantId(variantId: string): Promise<string | null> {
  const id = String(variantId ?? "").trim();
  if (!id) return null;
  const { data, errors } = await shopifyGraphQL<{
    productVariant: { product: { id: string } | null } | null;
  }>(VARIANT_PRODUCT_QUERY, { id });
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  return data?.productVariant?.product?.id ?? null;
}

/** Product metafield for Shopify automated collection "in stock (physical)". */
export const PHYSICAL_IN_STOCK_METAFIELD = {
  namespace: "custom",
  key: "physical_in_stock",
} as const;

/**
 * Google Merchant Center / Ads custom label for physical in-store stock.
 * Use as product-group filter when creating Shopping / PMax campaigns.
 */
export const GOOGLE_IN_STORE_CUSTOM_LABEL = {
  namespace: "mm-google-shopping",
  key: "custom_label_0",
  value: "in_store",
} as const;

const PRODUCT_PHYSICAL_QUERY = /* GraphQL */ `
query ProductPhysicalInStock($id: ID!) {
  product(id: $id) {
    id
    physicalInStock: metafield(namespace: "custom", key: "physical_in_stock") { value }
    googleCustomLabel0: metafield(namespace: "mm-google-shopping", key: "custom_label_0") {
      id
      value
    }
    variants(first: 100) {
      nodes { id }
    }
  }
}
`;

const METAFIELD_SET_MUTATION = /* GraphQL */ `
mutation SetPhysicalInStock($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    userErrors { field message }
  }
}
`;

const METAFIELD_DELETE_MUTATION = /* GraphQL */ `
mutation ClearGoogleInStoreCustomLabel($metafields: [MetafieldIdentifierInput!]!) {
  metafieldsDelete(identifiers: $metafields) {
    deletedMetafields { key namespace ownerId }
    userErrors { field message }
  }
}
`;

const DEFINITION_LIST_QUERY = /* GraphQL */ `
query PhysicalInStockDefinition {
  metafieldDefinitions(first: 50, ownerType: PRODUCT, namespace: "custom") {
    nodes { id key }
  }
}
`;

const DEFINITION_CREATE_MUTATION = /* GraphQL */ `
mutation CreatePhysicalInStockDefinition($definition: MetafieldDefinitionInput!) {
  metafieldDefinitionCreate(definition: $definition) {
    createdDefinition { id }
    userErrors { field message code }
  }
}
`;

let definitionReady: boolean | null = null;

export async function ensurePhysicalInStockMetafieldDefinition(): Promise<{ ok: boolean; created: boolean }> {
  if (definitionReady) return { ok: true, created: false };

  const { data: listData, errors: listErrors } = await shopifyGraphQL<{
    metafieldDefinitions: { nodes: Array<{ id: string; key: string }> };
  }>(DEFINITION_LIST_QUERY, {});
  if (listErrors?.length) throw new Error(listErrors.map((e) => e.message).join("; "));

  if ((listData?.metafieldDefinitions?.nodes ?? []).some((n) => n.key === PHYSICAL_IN_STOCK_METAFIELD.key)) {
    definitionReady = true;
    return { ok: true, created: false };
  }

  const { errors, data } = await shopifyGraphQL<{
    metafieldDefinitionCreate: {
      createdDefinition: { id: string } | null;
      userErrors: Array<{ message: string }>;
    };
  }>(DEFINITION_CREATE_MUTATION, {
    definition: {
      name: "Physical in stock",
      namespace: PHYSICAL_IN_STOCK_METAFIELD.namespace,
      key: PHYSICAL_IN_STOCK_METAFIELD.key,
      description:
        "True when any variant has qty > 0 at a physical location (warehouse/shops). Excludes Chemin dropship.",
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

  definitionReady = true;
  return { ok: true, created: Boolean(data?.metafieldDefinitionCreate?.createdDefinition?.id) };
}

async function physicalQtyForVariantIds(variantIds: string[]): Promise<number> {
  if (variantIds.length === 0) return 0;
  const rows = await prisma.$queryRaw<Array<{ available: number }>>`
    SELECT COALESCE(SUM(s."available"), 0)::int AS available
    FROM "public"."ShopifyVariantLocationStock" s
    WHERE s."shopifyVariantId" = ANY(${variantIds}::text[])
      AND s."sourceType" = 'physical'
      AND s."available" > 0
  `;
  return Number(rows[0]?.available ?? 0);
}

export async function readProductPhysicalInStock(productId: string): Promise<boolean> {
  const { data, errors } = await shopifyGraphQL<{
    product: { physicalInStock: { value: string | null } | null } | null;
  }>(PRODUCT_PHYSICAL_QUERY, { id: productId });
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  return String(data?.product?.physicalInStock?.value ?? "").toLowerCase() === "true";
}

export async function writeProductPhysicalInStock(productId: string, enabled: boolean): Promise<void> {
  await ensurePhysicalInStockMetafieldDefinition();
  const { errors, data } = await shopifyGraphQL<{
    metafieldsSet: { userErrors: Array<{ message: string }> };
  }>(METAFIELD_SET_MUTATION, {
    metafields: [
      {
        ownerId: productId,
        namespace: PHYSICAL_IN_STOCK_METAFIELD.namespace,
        key: PHYSICAL_IN_STOCK_METAFIELD.key,
        type: "boolean",
        value: enabled ? "true" : "false",
      },
    ],
  });
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  const ue = data?.metafieldsSet?.userErrors ?? [];
  if (ue.length) throw new Error(ue.map((e) => e.message).join("; "));
}

export async function writeGoogleInStoreCustomLabel(productId: string): Promise<void> {
  const { errors, data } = await shopifyGraphQL<{
    metafieldsSet: { userErrors: Array<{ message: string }> };
  }>(METAFIELD_SET_MUTATION, {
    metafields: [
      {
        ownerId: productId,
        namespace: GOOGLE_IN_STORE_CUSTOM_LABEL.namespace,
        key: GOOGLE_IN_STORE_CUSTOM_LABEL.key,
        type: "single_line_text_field",
        value: GOOGLE_IN_STORE_CUSTOM_LABEL.value,
      },
    ],
  });
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  const ue = data?.metafieldsSet?.userErrors ?? [];
  if (ue.length) throw new Error(ue.map((e) => e.message).join("; "));
}

export async function clearGoogleInStoreCustomLabel(productId: string): Promise<void> {
  const { errors, data } = await shopifyGraphQL<{
    metafieldsDelete: { userErrors: Array<{ message: string }> };
  }>(METAFIELD_DELETE_MUTATION, {
    metafields: [
      {
        ownerId: productId,
        namespace: GOOGLE_IN_STORE_CUSTOM_LABEL.namespace,
        key: GOOGLE_IN_STORE_CUSTOM_LABEL.key,
      },
    ],
  });
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  const ue = data?.metafieldsDelete?.userErrors ?? [];
  // Missing metafield is fine — already cleared.
  const msg = ue.map((e) => e.message).join("; ").toLowerCase();
  if (
    ue.length &&
    !msg.includes("not found") &&
    !msg.includes("does not exist") &&
    !msg.includes("couldn't find")
  ) {
    throw new Error(ue.map((e) => e.message).join("; "));
  }
}

/** Sync product flag + Google Ads custom_label_0 from DB mirror (any physical loc qty > 0). */
export async function syncPhysicalInStockMetafieldForProduct(
  productId: string,
  changes: string[] = [],
  warnings: string[] = []
): Promise<void> {
  if (!productId) return;
  try {
    const { data, errors } = await shopifyGraphQL<{
      product: {
        physicalInStock: { value: string | null } | null;
        googleCustomLabel0: { id: string; value: string | null } | null;
        variants: { nodes: Array<{ id: string }> };
      } | null;
    }>(PRODUCT_PHYSICAL_QUERY, { id: productId });
    if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));

    const enabled = String(data?.product?.physicalInStock?.value ?? "").toLowerCase() === "true";
    const currentLabel = String(data?.product?.googleCustomLabel0?.value ?? "").trim();
    const variantIds = (data?.product?.variants?.nodes ?? []).map((v) => v.id).filter(Boolean);
    const physicalQty = await physicalQtyForVariantIds(variantIds);
    const want = physicalQty > 0;

    if (want !== enabled) {
      await writeProductPhysicalInStock(productId, want);
      changes.push(
        `Shopify product physical_in_stock=${want ? "true" : "false"} (physical qty=${physicalQty})`
      );
    }

    if (want) {
      if (currentLabel !== GOOGLE_IN_STORE_CUSTOM_LABEL.value) {
        await writeGoogleInStoreCustomLabel(productId);
        changes.push(
          `Google custom_label_0=${GOOGLE_IN_STORE_CUSTOM_LABEL.value} (physical qty=${physicalQty})`
        );
      }
    } else if (currentLabel === GOOGLE_IN_STORE_CUSTOM_LABEL.value) {
      await clearGoogleInStoreCustomLabel(productId);
      changes.push(`Google custom_label_0 cleared (physical qty=${physicalQty})`);
    }
  } catch (err: any) {
    warnings.push(`Shopify physical_in_stock metafield failed: ${err?.message ?? err}`);
  }
}

const debounceByProduct = new Map<string, ReturnType<typeof setTimeout>>();

/** Debounced mirror hook — safe during bulk location sync. */
export function schedulePhysicalInStockSyncForVariant(shopifyVariantId: string): void {
  const variantId = String(shopifyVariantId ?? "").trim();
  if (!variantId) return;
  void (async () => {
    const productId = await resolveProductIdFromVariantId(variantId);
    if (!productId) return;
    const existing = debounceByProduct.get(productId);
    if (existing) clearTimeout(existing);
    debounceByProduct.set(
      productId,
      setTimeout(() => {
        debounceByProduct.delete(productId);
        void syncPhysicalInStockMetafieldForProduct(productId).catch(() => {});
      }, 1500)
    );
  })().catch(() => {});
}

/** Full reconcile from mirror — use after bulk location sync or one-time backfill. */
export async function reconcilePhysicalInStockMetafields(options?: {
  dryRun?: boolean;
}): Promise<{
  scanned: number;
  setTrue: number;
  setFalse: number;
  labelSet: number;
  labelCleared: number;
  errors: number;
}> {
  const dryRun = options?.dryRun === true;
  const rows = await prisma.shopifyVariantLocationStock.findMany({
    where: { sourceType: "physical", available: { gt: 0 } },
    select: { shopifyVariantId: true },
    distinct: ["shopifyVariantId"],
  });

  const productIds = new Set<string>();
  for (const row of rows) {
    const productId = await resolveProductIdFromVariantId(row.shopifyVariantId);
    if (productId) productIds.add(productId);
  }

  let setTrue = 0;
  let setFalse = 0;
  let labelSet = 0;
  let labelCleared = 0;
  let errors = 0;

  for (const productId of productIds) {
    try {
      const changes: string[] = [];
      if (dryRun) {
        const { data } = await shopifyGraphQL<{
          product: {
            physicalInStock: { value: string | null } | null;
            googleCustomLabel0: { value: string | null } | null;
            variants: { nodes: Array<{ id: string }> };
          } | null;
        }>(PRODUCT_PHYSICAL_QUERY, { id: productId });
        const variantIds = (data?.product?.variants?.nodes ?? []).map((v) => v.id);
        const qty = await physicalQtyForVariantIds(variantIds);
        const enabled =
          String(data?.product?.physicalInStock?.value ?? "").toLowerCase() === "true";
        const label = String(data?.product?.googleCustomLabel0?.value ?? "").trim();
        if (qty > 0 && !enabled) setTrue += 1;
        if (qty > 0 && label !== GOOGLE_IN_STORE_CUSTOM_LABEL.value) labelSet += 1;
        continue;
      }
      await syncPhysicalInStockMetafieldForProduct(productId, changes);
      if (changes.some((c) => c.includes("physical_in_stock=true"))) setTrue += 1;
      if (changes.some((c) => c.includes("physical_in_stock=false"))) setFalse += 1;
      if (changes.some((c) => c.includes("custom_label_0=in_store"))) labelSet += 1;
      if (changes.some((c) => c.includes("custom_label_0 cleared"))) labelCleared += 1;
    } catch {
      errors += 1;
    }
  }

  return { scanned: productIds.size, setTrue, setFalse, labelSet, labelCleared, errors };
}
