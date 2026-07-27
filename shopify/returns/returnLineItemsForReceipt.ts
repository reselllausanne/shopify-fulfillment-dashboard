import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import type { RequestedShopifyReturnLine } from "@/shopify/returns/requestedReturns";

export type ProcessReturnLineItem = {
  id: string;
  quantity: number;
};

const RETURN_LINE_ITEMS_QUERY = /* GraphQL */ `
query ReturnLineItemsForReceipt($id: ID!) {
  return(id: $id) {
    id
    returnLineItems(first: 50) {
      edges {
        node {
          __typename
          ... on ReturnLineItem {
            id
            quantity
            customerNote
            restockingFee {
              percentage
              amountSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
            }
            returnReasonDefinition {
              handle
              name
            }
            fulfillmentLineItem {
              lineItem {
                title
                name
                sku
                variantTitle
                originalUnitPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
          ... on UnverifiedReturnLineItem {
            id
            quantity
            customerNote
          }
        }
      }
    }
  }
}
`;

export function isReturnLineItemGid(id: string): boolean {
  return id.startsWith("gid://shopify/ReturnLineItem/");
}

export function normalizeReturnLineItemGid(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (isReturnLineItemGid(value)) return value;
  const digits = value.replace(/\D/g, "");
  if (/^\d+$/.test(value) && digits) {
    return `gid://shopify/ReturnLineItem/${digits}`;
  }
  return null;
}

function mapGraphqlReturnLine(node: any): RequestedShopifyReturnLine | null {
  const id = normalizeReturnLineItemGid(node?.id);
  if (!id) return null;

  const lineItem = node?.fulfillmentLineItem?.lineItem;
  const money = lineItem?.originalUnitPriceSet?.shopMoney;
  const restockMoney = node?.restockingFee?.amountSet?.shopMoney;
  const reasonDef = node?.returnReasonDefinition;

  return {
    id,
    title: String(lineItem?.title || lineItem?.name || "Item"),
    sku: lineItem?.sku ?? null,
    variantTitle: lineItem?.variantTitle ?? null,
    quantity: Math.max(1, Math.trunc(Number(node?.quantity ?? 1) || 1)),
    unitAmount: money?.amount != null ? Number(money.amount) : null,
    currencyCode: money?.currencyCode ?? null,
    returnReason: reasonDef?.handle ?? null,
    returnReasonLabel: reasonDef?.name ?? null,
    customerNote: node?.customerNote ?? null,
    restockingFeePercent:
      node?.restockingFee?.percentage != null
        ? Number(node.restockingFee.percentage)
        : null,
    restockingFeeAmount:
      restockMoney?.amount != null ? Number(restockMoney.amount) : null,
  };
}

export function lineItemsFromRawJson(rawJson: unknown): ProcessReturnLineItem[] {
  const lines: unknown[] = Array.isArray((rawJson as any)?.lineItems)
    ? (rawJson as any).lineItems
    : [];
  const out: ProcessReturnLineItem[] = [];

  for (const line of lines) {
    const id = normalizeReturnLineItemGid(
      (line as any)?.id ?? (line as any)?.returnLineItemId
    );
    if (!id) continue;
    const quantity = Math.max(
      1,
      Math.trunc(Number((line as any)?.quantity ?? (line as any)?.selectedQuantity ?? 1) || 1)
    );
    out.push({ id, quantity });
  }

  return out;
}

export async function fetchShopifyReturnLineItems(
  returnId: string
): Promise<RequestedShopifyReturnLine[]> {
  const normalizedReturnId = String(returnId || "").trim();
  if (!normalizedReturnId) return [];

  const { data, errors } = await shopifyGraphQL<{
    return?: {
      returnLineItems?: { edges?: Array<{ node?: any }> };
    } | null;
  }>(RETURN_LINE_ITEMS_QUERY, { id: normalizedReturnId });

  if (errors?.length) {
    throw new Error(errors.map((e) => e.message).join("; "));
  }

  return (data?.return?.returnLineItems?.edges ?? [])
    .map((edge) => mapGraphqlReturnLine(edge?.node))
    .filter((line): line is RequestedShopifyReturnLine => Boolean(line?.id));
}

export async function resolveProcessReturnLineItems(input: {
  rawJson: unknown;
  returnId: string;
}): Promise<{
  items: ProcessReturnLineItem[];
  lineItemsForStorage: RequestedShopifyReturnLine[];
  source: "raw" | "shopify" | "none";
}> {
  const fromRaw = lineItemsFromRawJson(input.rawJson);
  if (fromRaw.length) {
    const rawLines: unknown[] = Array.isArray((input.rawJson as any)?.lineItems)
      ? (input.rawJson as any).lineItems
      : [];
    return {
      items: fromRaw,
      lineItemsForStorage: rawLines as RequestedShopifyReturnLine[],
      source: "raw",
    };
  }

  const fetched = await fetchShopifyReturnLineItems(input.returnId);
  const items = fetched.map((line) => ({
    id: line.id,
    quantity: Math.max(1, Math.trunc(line.quantity || 1)),
  }));

  return {
    items,
    lineItemsForStorage: fetched,
    source: items.length ? "shopify" : "none",
  };
}

export function mergeReturnLineItemsForStorage(
  existingLineItems: unknown,
  incoming: RequestedShopifyReturnLine[]
): RequestedShopifyReturnLine[] {
  const existing = Array.isArray(existingLineItems)
    ? (existingLineItems as RequestedShopifyReturnLine[])
    : [];
  const incomingWithGids = incoming.filter((line) => isReturnLineItemGid(line.id));
  const existingWithGids = existing.filter((line) => isReturnLineItemGid(String(line?.id ?? "")));

  if (incomingWithGids.length) return incomingWithGids;
  if (existingWithGids.length) return existingWithGids;
  return incoming;
}
