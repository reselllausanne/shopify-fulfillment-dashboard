/**
 * Fetch order email/phone for Ads enhanced conversions at upload time.
 * Funnel_events intentionally store no PII — pull from OrderMatch cache or Shopify Admin.
 */
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { prisma } from "@/app/lib/prisma";
import { orderGid, shortShopifyId } from "./contract";

export type OrderPii = {
  email: string | null;
  phone: string | null;
  country: string | null;
};

type OrderNode = {
  id: string;
  email?: string | null;
  phone?: string | null;
  customer?: {
    defaultEmailAddress?: { emailAddress?: string | null } | null;
    defaultPhoneNumber?: { phoneNumber?: string | null } | null;
  } | null;
  shippingAddress?: { phone?: string | null; countryCodeV2?: string | null } | null;
  billingAddress?: { phone?: string | null; countryCodeV2?: string | null } | null;
};

function pickEmail(node: OrderNode): string | null {
  return (
    node.customer?.defaultEmailAddress?.emailAddress?.trim() ||
    node.email?.trim() ||
    null
  );
}

function pickPhone(node: OrderNode): string | null {
  return (
    node.customer?.defaultPhoneNumber?.phoneNumber?.trim() ||
    node.shippingAddress?.phone?.trim() ||
    node.billingAddress?.phone?.trim() ||
    node.phone?.trim() ||
    null
  );
}

function pickCountry(node: OrderNode): string | null {
  return node.shippingAddress?.countryCodeV2 || node.billingAddress?.countryCodeV2 || null;
}

/** OrderMatch cache first (no Admin call), then Shopify nodes for gaps. */
export async function loadOrderPiiForUploads(orderIds: string[]): Promise<Map<string, OrderPii>> {
  const out = new Map<string, OrderPii>();
  const numeric = [...new Set(orderIds.map((id) => shortShopifyId(id)).filter(Boolean) as string[])];
  if (!numeric.length) return out;

  const gids = numeric.map((id) => orderGid(id));
  const cached = await prisma.orderMatch.findMany({
    where: { shopifyOrderId: { in: gids }, shopifyCustomerEmail: { not: null } },
    select: { shopifyOrderId: true, shopifyCustomerEmail: true },
    distinct: ["shopifyOrderId"],
  });
  for (const row of cached) {
    const id = shortShopifyId(row.shopifyOrderId);
    if (!id || !row.shopifyCustomerEmail) continue;
    out.set(id, { email: row.shopifyCustomerEmail, phone: null, country: null });
  }

  const missing = numeric.filter((id) => !out.get(id)?.email);
  const BATCH = 50;
  for (let i = 0; i < missing.length; i += BATCH) {
    const chunk = missing.slice(i, i + BATCH).map((id) => orderGid(id));
    const nodes = await fetchShopifyOrderPii(chunk);
    for (const [gid, node] of nodes) {
      const id = shortShopifyId(gid);
      if (!id) continue;
      const prev = out.get(id);
      out.set(id, {
        email: prev?.email || pickEmail(node),
        phone: pickPhone(node),
        country: pickCountry(node),
      });
    }
  }

  return out;
}

async function fetchShopifyOrderPii(ids: string[]): Promise<Map<string, OrderNode>> {
  const out = new Map<string, OrderNode>();
  if (!ids.length) return out;
  const QUERY = /* GraphQL */ `
    query TrackingOrderPii($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Order {
          id
          email
          phone
          customer {
            defaultEmailAddress { emailAddress }
            defaultPhoneNumber { phoneNumber }
          }
          shippingAddress { phone countryCodeV2 }
          billingAddress { phone countryCodeV2 }
        }
      }
    }
  `;
  const { data, errors } = await shopifyGraphQL<{ nodes: Array<OrderNode | null> }>(QUERY, { ids });
  if (errors?.length) {
    throw new Error(errors.map((e) => e.message).join("; "));
  }
  for (const node of data?.nodes ?? []) {
    if (node?.id) out.set(node.id, node);
  }
  return out;
}
