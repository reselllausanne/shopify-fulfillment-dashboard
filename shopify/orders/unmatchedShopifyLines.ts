import {
  isPackageProtectionShopifyLine,
  isShopifyFinancialRefunded,
  type ShopifyLineItem,
} from "@/app/utils/matching";
import { prisma } from "@/app/lib/prisma";
import { resolveShopifyAdminEnv } from "@/lib/shopifyEnv";

export type UnmatchedShopifyLine = ShopifyLineItem & { qty: number };

function gidToId(gid: string): string {
  const s = String(gid || "");
  const m = s.match(/\/(\d+)\s*$/);
  return m ? m[1] : s;
}

async function shopifyGql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const { shop: SHOP, token: SHOPIFY_TOKEN, version: SHOPIFY_API_VERSION } =
    resolveShopifyAdminEnv();
  if (!SHOP || !SHOPIFY_TOKEN) {
    throw new Error("Missing SHOPIFY_SHOP_DOMAIN / SHOPIFY_ADMIN_API_ACCESS_TOKEN");
  }
  const shop = SHOP.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const res = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": SHOPIFY_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Shopify HTTP ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data?: T; errors?: unknown[] };
  if (json.errors?.length) throw new Error(`Shopify GQL: ${JSON.stringify(json.errors)}`);
  return json.data as T;
}

export async function fetchUnmatchedShopifyLines(days: number): Promise<{
  lines: UnmatchedShopifyLine[];
  ordersScanned: number;
  linesScanned: number;
  protectionSkipped: number;
  cancelledSkipped: number;
  refundedSkipped: number;
  alreadyMatchedSkipped: number;
}> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - (days - 1));
  since.setUTCHours(0, 0, 0, 0);

  const matches = await prisma.orderMatch.findMany({
    where: { shopifyCreatedAt: { gte: since } },
    select: { shopifyLineItemId: true },
  });
  const matchedIds = new Set(matches.map((m) => String(m.shopifyLineItemId)));

  const query = `
    query UnmatchedScan($cursor: String) {
      orders(
        first: 50
        after: $cursor
        sortKey: CREATED_AT
        reverse: true
        query: "created_at:>=${since.toISOString().slice(0, 10)} financial_status:paid"
      ) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            name
            createdAt
            displayFinancialStatus
            displayFulfillmentStatus
            cancelledAt
            customer { email firstName lastName }
            lineItems(first: 50) {
              edges {
                node {
                  id
                  title
                  variantTitle
                  sku
                  quantity
                  currentQuantity
                  originalUnitPriceSet { shopMoney { amount currencyCode } }
                  image { url }
                  variant { id barcode selectedOptions { name value } }
                }
              }
            }
          }
        }
      }
    }
  `;

  const out: UnmatchedShopifyLine[] = [];
  let cursor: string | null = null;
  let ordersScanned = 0;
  let linesScanned = 0;
  let protectionSkipped = 0;
  let cancelledSkipped = 0;
  let refundedSkipped = 0;
  let alreadyMatchedSkipped = 0;

  for (;;) {
    const data: {
      orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; edges: any[] };
    } = await shopifyGql(query, { cursor });

    for (const edge of data.orders.edges) {
      const o = edge.node;
      if (o.cancelledAt) {
        cancelledSkipped += 1;
        continue;
      }
      if (isShopifyFinancialRefunded(o.displayFinancialStatus)) {
        refundedSkipped += 1;
        continue;
      }
      ordersScanned += 1;
      const shopifyOrderId = gidToId(o.id);
      for (const liE of o.lineItems?.edges ?? []) {
        const li = liE.node;
        linesScanned += 1;
        const title = String(li.title ?? "");
        const sku = li.sku ? String(li.sku) : null;
        if (isPackageProtectionShopifyLine(title, sku)) {
          protectionSkipped += 1;
          continue;
        }
        const qty = Number(li.currentQuantity ?? li.quantity ?? 0);
        if (!Number.isFinite(qty) || qty <= 0) continue;
        const lineItemGid = String(li.id ?? "");
        const lineItemId = gidToId(lineItemGid);
        if (matchedIds.has(lineItemId) || matchedIds.has(lineItemGid)) {
          alreadyMatchedSkipped += 1;
          continue;
        }

        const sizeOpt = (li.variant?.selectedOptions ?? []).find((opt: any) =>
          /size/i.test(String(opt?.name ?? ""))
        );
        const sizeEU = sizeOpt?.value ? String(sizeOpt.value) : li.variantTitle || null;
        const currency = String(li.originalUnitPriceSet?.shopMoney?.currencyCode || "CHF");
        const unitPrice = Number(li.originalUnitPriceSet?.shopMoney?.amount ?? 0);
        const totalPrice = unitPrice * qty;
        const gtin = String(li.variant?.barcode ?? "").trim() || null;

        out.push({
          shopifyOrderId,
          orderName: String(o.name),
          createdAt: String(o.createdAt),
          displayFinancialStatus: String(o.displayFinancialStatus ?? ""),
          displayFulfillmentStatus: o.displayFulfillmentStatus ?? null,
          customerEmail: o.customer?.email ?? null,
          customerName:
            [o.customer?.firstName, o.customer?.lastName].filter(Boolean).join(" ") || null,
          customerFirstName: o.customer?.firstName ?? null,
          customerLastName: o.customer?.lastName ?? null,
          shippingCountry: null,
          shippingCity: null,
          lineItemId: lineItemGid.startsWith("gid://") ? lineItemGid : lineItemId,
          title,
          sku,
          variantTitle: li.variantTitle ?? null,
          quantity: qty,
          price: String(unitPrice),
          totalPrice: String(totalPrice),
          currencyCode: currency,
          sizeEU,
          lineItemImageUrl: li.image?.url ?? null,
          gtin,
          qty,
        });
      }
    }

    if (!data.orders.pageInfo.hasNextPage) break;
    cursor = data.orders.pageInfo.endCursor;
    if (ordersScanned > 10_000) break;
  }

  return {
    lines: out,
    ordersScanned,
    linesScanned,
    protectionSkipped,
    cancelledSkipped,
    refundedSkipped,
    alreadyMatchedSkipped,
  };
}
