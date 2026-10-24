#!/usr/bin/env npx tsx
/**
 * Ensure smart collection `livraison-48h` exists:
 *   product custom.physical_in_stock = true
 *
 * Homepage / menu "Livraison 48H" must use this — NOT `express-delivery`
 * (variant express_available, polluted by StockX dropship).
 *
 * Usage:
 *   npx tsx scripts/ensure-livraison-48h-collection.ts
 */
import "dotenv/config";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";

const HANDLE = "livraison-48h";
const TITLE = "Livraison 48H";
const PHYSICAL_IN_STOCK_KEY = "physical_in_stock";

const DEF_QUERY = /* GraphQL */ `
query PhysicalInStockDef {
  metafieldDefinitions(first: 20, ownerType: PRODUCT, namespace: "custom", key: "physical_in_stock") {
    nodes { id namespace key }
  }
}
`;

const BY_HANDLE = /* GraphQL */ `
query Livraison48hByHandle($handle: String!) {
  collectionByHandle(handle: $handle) {
    id
    title
    handle
    productsCount { count }
    ruleSet {
      appliedDisjunctively
      rules {
        column
        relation
        condition
        conditionObject {
          ... on CollectionRuleMetafieldCondition {
            metafieldDefinition { id key namespace }
          }
        }
      }
    }
  }
}
`;

const CREATE = /* GraphQL */ `
mutation CreateLivraison48h($input: CollectionInput!) {
  collectionCreate(input: $input) {
    collection { id title handle productsCount { count } }
    userErrors { field message }
  }
}
`;

const UPDATE = /* GraphQL */ `
mutation UpdateLivraison48h($input: CollectionInput!) {
  collectionUpdate(input: $input) {
    collection { id title handle productsCount { count } }
    userErrors { field message }
  }
}
`;

const PUBS = /* GraphQL */ `
query OnlineStorePublication {
  publications(first: 20) { nodes { id name } }
}
`;

const PUBLISH = /* GraphQL */ `
mutation PublishLivraison48h($id: ID!, $input: [PublicationInput!]!) {
  publishablePublish(id: $id, input: $input) {
    userErrors { field message }
  }
}
`;

async function main() {
  const defRes = await shopifyGraphQL<{
    metafieldDefinitions: { nodes: Array<{ id: string; key: string }> };
  }>(DEF_QUERY);
  if (defRes.errors?.length) throw new Error(defRes.errors.map((e) => e.message).join("; "));
  const defId = defRes.data?.metafieldDefinitions?.nodes?.find((n) => n.key === PHYSICAL_IN_STOCK_KEY)?.id;
  if (!defId) throw new Error("metafield definition custom.physical_in_stock not found");

  const ruleSet = {
    appliedDisjunctively: false,
    rules: [
      {
        column: "PRODUCT_METAFIELD_DEFINITION",
        relation: "EQUALS",
        condition: "true",
        conditionObjectId: defId,
      },
    ],
  };

  const existing = await shopifyGraphQL<{
    collectionByHandle: {
      id: string;
      title: string;
      handle: string;
      productsCount: { count: number };
      ruleSet: {
        rules: Array<{
          conditionObject?: { metafieldDefinition?: { key: string } | null } | null;
        }>;
      } | null;
    } | null;
  }>(BY_HANDLE, { handle: HANDLE });
  if (existing.errors?.length) throw new Error(existing.errors.map((e) => e.message).join("; "));

  let collectionId = existing.data?.collectionByHandle?.id ?? null;
  if (!collectionId) {
    const created = await shopifyGraphQL<{
      collectionCreate: {
        collection: { id: string; title: string; handle: string; productsCount: { count: number } } | null;
        userErrors: Array<{ message: string }>;
      };
    }>(CREATE, {
      input: {
        title: TITLE,
        handle: HANDLE,
        descriptionHtml: "<p>Stock physique entrepôt / magasins — expédition sous 48h.</p>",
        sortOrder: "BEST_SELLING",
        ruleSet,
      },
    });
    const ue = created.data?.collectionCreate?.userErrors ?? [];
    if (created.errors?.length || ue.length) {
      throw new Error([...(created.errors ?? []), ...ue].map((e) => e.message).join("; "));
    }
    collectionId = created.data?.collectionCreate?.collection?.id ?? null;
    console.log("[livraison-48h] created", created.data?.collectionCreate?.collection);
  } else {
    const rulesOk = (existing.data?.collectionByHandle?.ruleSet?.rules ?? []).some(
      (r) => r.conditionObject?.metafieldDefinition?.key === PHYSICAL_IN_STOCK_KEY
    );
    if (!rulesOk) {
      const updated = await shopifyGraphQL<{
        collectionUpdate: {
          collection: { id: string; productsCount: { count: number } } | null;
          userErrors: Array<{ message: string }>;
        };
      }>(UPDATE, { input: { id: collectionId, ruleSet } });
      const ue = updated.data?.collectionUpdate?.userErrors ?? [];
      if (updated.errors?.length || ue.length) {
        throw new Error([...(updated.errors ?? []), ...ue].map((e) => e.message).join("; "));
      }
      console.log("[livraison-48h] rules repaired", updated.data?.collectionUpdate?.collection);
    } else {
      console.log("[livraison-48h] ok", {
        id: collectionId,
        count: existing.data?.collectionByHandle?.productsCount?.count,
      });
    }
  }

  if (!collectionId) throw new Error("no collection id");

  const pubs = await shopifyGraphQL<{ publications: { nodes: Array<{ id: string; name: string }> } }>(PUBS);
  const online = (pubs.data?.publications?.nodes ?? []).find((p) => /online store/i.test(p.name));
  if (online) {
    const pub = await shopifyGraphQL<{
      publishablePublish: { userErrors: Array<{ message: string }> };
    }>(PUBLISH, { id: collectionId, input: [{ publicationId: online.id }] });
    const ue = pub.data?.publishablePublish?.userErrors ?? [];
    if (pub.errors?.length || ue.length) {
      console.warn("[livraison-48h] publish warnings", [...(pub.errors ?? []), ...ue]);
    } else {
      console.log("[livraison-48h] published to Online Store");
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
