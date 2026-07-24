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

export async function readShopifyDelivery48h(variantId: string): Promise<boolean> {
  const { data, errors } = await shopifyGraphQL<{
    productVariant: { metafield: { value: string | null } | null } | null;
  }>(VARIANT_DELIVERY_48H_QUERY, { id: variantId });
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  return String(data?.productVariant?.metafield?.value ?? "").toLowerCase() === "true";
}

export async function writeShopifyDelivery48h(variantId: string, enabled: boolean): Promise<void> {
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
