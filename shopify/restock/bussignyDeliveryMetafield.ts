import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { LOCATIONS } from "@/shopify/inventory/locationConfig";

export const DELIVERY_48H_METAFIELD = {
  namespace: "custom",
  key: "delivery_48h",
} as const;

export const BUSSIGNY_LOCATION_ID =
  (process.env.SHOPIFY_LOC_BUSSIGNY ?? "").trim() ||
  LOCATIONS.find((l) => /bussigny/i.test(l.name))?.id ||
  "gid://shopify/Location/111267971458";

const METAFIELD_SET_MUTATION = /* GraphQL */ `
mutation SetDelivery48h($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    userErrors { field message }
  }
}
`;

const VARIANT_DELIVERY_48H_QUERY = /* GraphQL */ `
query ReadDelivery48h($id: ID!) {
  productVariant(id: $id) {
    id
    metafield(namespace: "custom", key: "delivery_48h") { value }
  }
}
`;

const DEFINITION_LIST_QUERY = /* GraphQL */ `
query Delivery48hDefinition {
  metafieldDefinitions(first: 50, ownerType: PRODUCTVARIANT, namespace: "custom") {
    nodes { id key useAsCollectionCondition }
  }
}
`;

const DEFINITION_CREATE_MUTATION = /* GraphQL */ `
mutation CreateDelivery48hDefinition($definition: MetafieldDefinitionInput!) {
  metafieldDefinitionCreate(definition: $definition) {
    createdDefinition { id key useAsCollectionCondition }
    userErrors { field message code }
  }
}
`;

const DEFINITION_UPDATE_MUTATION = /* GraphQL */ `
mutation UpdateDelivery48hDefinition($definition: MetafieldDefinitionUpdateInput!) {
  metafieldDefinitionUpdate(definition: $definition) {
    updatedDefinition { id key useAsCollectionCondition }
    userErrors { field message code }
  }
}
`;

let delivery48hDefinitionReady: string | null = null;

/** Pin variant custom.delivery_48h + enable smart-collection condition. */
export async function ensureDelivery48hMetafieldDefinition(): Promise<{
  ok: boolean;
  created: boolean;
  id: string | null;
}> {
  if (delivery48hDefinitionReady) {
    return { ok: true, created: false, id: delivery48hDefinitionReady };
  }

  const { data: listData, errors: listErrors } = await shopifyGraphQL<{
    metafieldDefinitions: {
      nodes: Array<{ id: string; key: string; useAsCollectionCondition: boolean }>;
    };
  }>(DEFINITION_LIST_QUERY, {});
  if (listErrors?.length) throw new Error(listErrors.map((e) => e.message).join("; "));

  const existing = (listData?.metafieldDefinitions?.nodes ?? []).find(
    (n) => n.key === DELIVERY_48H_METAFIELD.key
  );

  if (existing?.id) {
    if (!existing.useAsCollectionCondition) {
      const { errors, data } = await shopifyGraphQL<{
        metafieldDefinitionUpdate: {
          updatedDefinition: { id: string } | null;
          userErrors: Array<{ message: string }>;
        };
      }>(DEFINITION_UPDATE_MUTATION, {
        definition: {
          namespace: DELIVERY_48H_METAFIELD.namespace,
          key: DELIVERY_48H_METAFIELD.key,
          ownerType: "PRODUCTVARIANT",
          useAsCollectionCondition: true,
        },
      });
      if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
      const ue = data?.metafieldDefinitionUpdate?.userErrors ?? [];
      if (ue.length) throw new Error(ue.map((e) => e.message).join("; "));
    }
    delivery48hDefinitionReady = existing.id;
    return { ok: true, created: false, id: existing.id };
  }

  const { errors, data } = await shopifyGraphQL<{
    metafieldDefinitionCreate: {
      createdDefinition: { id: string } | null;
      userErrors: Array<{ message: string; code?: string }>;
    };
  }>(DEFINITION_CREATE_MUTATION, {
    definition: {
      name: "Delivery 48h",
      namespace: DELIVERY_48H_METAFIELD.namespace,
      key: DELIVERY_48H_METAFIELD.key,
      description: "Warehouse liquidation lane — 48h delivery + soldes collection.",
      type: "boolean",
      ownerType: "PRODUCTVARIANT",
      pin: true,
      useAsCollectionCondition: true,
    },
  });
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  const ue = data?.metafieldDefinitionCreate?.userErrors ?? [];
  const msg = ue.map((e) => e.message).join("; ").toLowerCase();
  if (ue.length && !msg.includes("taken") && !msg.includes("already") && !msg.includes("exists")) {
    throw new Error(ue.map((e) => e.message).join("; "));
  }

  const createdId = data?.metafieldDefinitionCreate?.createdDefinition?.id ?? null;
  if (createdId) delivery48hDefinitionReady = createdId;
  return { ok: true, created: Boolean(createdId), id: createdId };
}

export async function readShopifyDelivery48h(variantId: string): Promise<boolean> {
  const { data, errors } = await shopifyGraphQL<{
    productVariant: { metafield: { value: string | null } | null } | null;
  }>(VARIANT_DELIVERY_48H_QUERY, { id: variantId });
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  return String(data?.productVariant?.metafield?.value ?? "").toLowerCase() === "true";
}

export async function writeShopifyDelivery48h(variantId: string, enabled: boolean): Promise<void> {
  await ensureDelivery48hMetafieldDefinition();
  const { errors, data } = await shopifyGraphQL<{
    metafieldsSet: { userErrors: Array<{ message: string }> };
  }>(METAFIELD_SET_MUTATION, {
    metafields: [
      {
        ownerId: variantId,
        namespace: DELIVERY_48H_METAFIELD.namespace,
        key: DELIVERY_48H_METAFIELD.key,
        type: "boolean",
        value: enabled ? "true" : "false",
      },
    ],
  });
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  const ue = data?.metafieldsSet?.userErrors ?? [];
  if (ue.length) throw new Error(ue.map((e) => e.message).join("; "));
}
