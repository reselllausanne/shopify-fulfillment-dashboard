/**
 * Migrate soldes smart collections from product custom.soldes_48h (+ price_locked OR)
 * to variant custom.delivery_48h only.
 *
 * Usage:
 *   npx tsx scripts/migrate-soldes-collection-to-delivery-48h.ts           # dry-run
 *   npx tsx scripts/migrate-soldes-collection-to-delivery-48h.ts --write
 *   npx tsx scripts/migrate-soldes-collection-to-delivery-48h.ts --write --clear-soldes
 */
import "dotenv/config";
import { shopifyGraphQL } from "../lib/shopifyAdmin";
import {
  DELIVERY_48H_METAFIELD,
  ensureDelivery48hMetafieldDefinition,
} from "../shopify/restock/bussignyDeliveryMetafield";

const SOLDES_48H_KEY = "soldes_48h";
const PRICE_LOCKED_KEY = "price_locked";

const COLLECTIONS_QUERY = /* GraphQL */ `
query SoldesCollections($cursor: String) {
  collections(first: 100, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      title
      handle
      ruleSet {
        appliedDisjunctively
        rules {
          column
          relation
          condition
          conditionObject {
            ... on CollectionRuleMetafieldCondition {
              metafieldDefinition { id namespace key ownerType }
            }
          }
        }
      }
    }
  }
}
`;

const COLLECTION_UPDATE = /* GraphQL */ `
mutation UpdateSoldesCollection($input: CollectionInput!) {
  collectionUpdate(input: $input) {
    collection { id title handle ruleSet { appliedDisjunctively rules { column relation condition } } }
    job { id done }
    userErrors { field message }
  }
}
`;

const CLEAR_SOLDES_QUERY = /* GraphQL */ `
query ProductsWithSoldes48h($cursor: String) {
  products(first: 50, after: $cursor, query: "metafields.custom.soldes_48h:true") {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      title
      metafield(namespace: "custom", key: "soldes_48h") { id value }
    }
  }
}
`;

const CLEAR_SOLDES_MUTATION = /* GraphQL */ `
mutation ClearSoldes48h($metafields: [MetafieldIdentifierInput!]!) {
  metafieldsDelete(identifiers: $metafields) {
    deletedMetafields { key namespace ownerId }
    userErrors { field message }
  }
}
`;

type CollectionNode = {
  id: string;
  title: string;
  handle: string;
  ruleSet: {
    appliedDisjunctively: boolean;
    rules: Array<{
      column: string;
      relation: string;
      condition: string;
      conditionObject?: {
        metafieldDefinition?: { id: string; key: string; ownerType: string } | null;
      } | null;
    }>;
  } | null;
};

function usesSoldesOrPriceLockedRule(collection: CollectionNode): boolean {
  return (collection.ruleSet?.rules ?? []).some((rule) => {
    const key = rule.conditionObject?.metafieldDefinition?.key ?? "";
    return key === SOLDES_48H_KEY || key === PRICE_LOCKED_KEY;
  });
}

function rebuildRuleSet(
  collection: CollectionNode,
  delivery48hDefinitionId: string
): { appliedDisjunctively: boolean; rules: Array<Record<string, string>> } {
  const oldRules = collection.ruleSet?.rules ?? [];
  const kept = oldRules.filter((rule) => {
    const key = rule.conditionObject?.metafieldDefinition?.key ?? "";
    return key !== SOLDES_48H_KEY && key !== PRICE_LOCKED_KEY;
  });

  const deliveryRule = {
    column: "VARIANT_METAFIELD_DEFINITION",
    relation: "EQUALS",
    condition: "true",
    conditionObjectId: delivery48hDefinitionId,
  };

  // soldes-48h: single delivery_48h rule. Others: swap soldes/lock → delivery_48h, keep categories.
  if (collection.handle === "soldes-48h") {
    return { appliedDisjunctively: false, rules: [deliveryRule] };
  }

  return {
    appliedDisjunctively: collection.ruleSet?.appliedDisjunctively ?? true,
    rules: [...kept.map((r) => ({
      column: r.column,
      relation: r.relation,
      condition: r.condition,
      ...(r.conditionObject?.metafieldDefinition?.id
        ? { conditionObjectId: r.conditionObject.metafieldDefinition.id }
        : {}),
    })), deliveryRule],
  };
}

async function listTargetCollections(): Promise<CollectionNode[]> {
  const out: CollectionNode[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const { data, errors } = await shopifyGraphQL<{
      collections: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: CollectionNode[];
      };
    }>(COLLECTIONS_QUERY, { cursor });
    if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
    for (const node of data?.collections?.nodes ?? []) {
      if (usesSoldesOrPriceLockedRule(node)) out.push(node);
    }
    if (!data?.collections?.pageInfo?.hasNextPage) break;
    cursor = data.collections.pageInfo.endCursor;
  }
  return out;
}

async function clearSoldes48hMetafields(write: boolean): Promise<number> {
  let cleared = 0;
  let cursor: string | null = null;
  for (let page = 0; page < 200; page++) {
    const { data, errors } = await shopifyGraphQL<{
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{ id: string; title: string; metafield: { id: string; value: string } | null }>;
      };
    }>(CLEAR_SOLDES_QUERY, { cursor });
    if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
    const nodes = data?.products?.nodes ?? [];
    if (nodes.length === 0) break;

    if (write) {
      const identifiers = nodes
        .filter((p) => p.metafield?.id)
        .map((p) => ({
          ownerId: p.id,
          namespace: "custom",
          key: SOLDES_48H_KEY,
        }));
      if (identifiers.length > 0) {
        const del = await shopifyGraphQL<{
          metafieldsDelete: { userErrors: Array<{ message: string }> };
        }>(CLEAR_SOLDES_MUTATION, { metafields: identifiers });
        const ue = del.data?.metafieldsDelete?.userErrors ?? [];
        if (ue.length) throw new Error(ue.map((e) => e.message).join("; "));
        cleared += identifiers.length;
      }
    } else {
      cleared += nodes.length;
    }

    if (!data?.products?.pageInfo?.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor;
  }
  return cleared;
}

async function main() {
  const write = process.argv.includes("--write");
  const clearSoldes = process.argv.includes("--clear-soldes");

  const def = await ensureDelivery48hMetafieldDefinition();
  if (!def.id) throw new Error("delivery_48h metafield definition missing");

  const targets = await listTargetCollections();
  console.log(
    JSON.stringify(
      {
        write,
        clearSoldes,
        delivery48hDefinitionId: def.id,
        targetCollections: targets.map((c) => ({ handle: c.handle, title: c.title })),
      },
      null,
      2
    )
  );

  for (const collection of targets) {
    const nextRuleSet = rebuildRuleSet(collection, def.id);
    console.log(`\n${collection.handle}:`, JSON.stringify(nextRuleSet, null, 2));

    if (!write) continue;

    const { data, errors } = await shopifyGraphQL<{
      collectionUpdate: {
        collection: CollectionNode | null;
        userErrors: Array<{ message: string }>;
      };
    }>(COLLECTION_UPDATE, {
      input: {
        id: collection.id,
        ruleSet: nextRuleSet,
      },
    });
    if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
    const ue = data?.collectionUpdate?.userErrors ?? [];
    if (ue.length) throw new Error(`${collection.handle}: ${ue.map((e) => e.message).join("; ")}`);
    console.log(`Updated ${collection.handle}`);
  }

  if (clearSoldes) {
    const n = await clearSoldes48hMetafields(write);
    console.log(JSON.stringify({ clearedSoldes48hProducts: n, write }, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
