import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { isPackageProtectionShopifyLine } from "@/app/utils/matching";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GqlOrder = {
  id: string;
  name: string;
  createdAt: string;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  cancelledAt: string | null;
  customer: {
    email: string | null;
    firstName: string | null;
    lastName: string | null;
  } | null;
  shippingAddress: { countryCodeV2: string | null; city: string | null } | null;
  lineItems: {
    edges: Array<{
      node: {
        id: string;
        title: string;
        sku: string | null;
        variantTitle: string | null;
        quantity: number;
        currentQuantity: number | null;
        originalUnitPriceSet: { shopMoney: { amount: string; currencyCode: string } };
        image: { url: string | null } | null;
        variant: {
          selectedOptions: Array<{ name: string; value: string }> | null;
        } | null;
      };
    }>;
  };
};

const ORDER_LINES_QUERY = /* GraphQL */ `
  query UnmatchedOrderLines($id: ID!) {
    order(id: $id) {
      id
      name
      createdAt
      displayFinancialStatus
      displayFulfillmentStatus
      cancelledAt
      customer {
        email
        firstName
        lastName
      }
      shippingAddress {
        countryCodeV2
        city
      }
      lineItems(first: 50) {
        edges {
          node {
            id
            title
            sku
            variantTitle
            quantity
            currentQuantity
            originalUnitPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            image {
              url
            }
            variant {
              selectedOptions {
                name
                value
              }
            }
          }
        }
      }
    }
  }
`;

const ORDER_BY_NAME_QUERY = /* GraphQL */ `
  query UnmatchedOrderByName($q: String!) {
    orders(first: 1, query: $q) {
      edges {
        node {
          id
          name
          createdAt
          displayFinancialStatus
          displayFulfillmentStatus
          cancelledAt
          customer {
            email
            firstName
            lastName
          }
          shippingAddress {
            countryCodeV2
            city
          }
          lineItems(first: 50) {
            edges {
              node {
                id
                title
                sku
                variantTitle
                quantity
                currentQuantity
                originalUnitPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                image {
                  url
                }
                variant {
                  selectedOptions {
                    name
                    value
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

function shapeFromGql(order: GqlOrder, existingLineIds: Set<string>, orderAlreadyCosted: boolean) {
  const customerName = [order.customer?.firstName, order.customer?.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();

  const lines = (order.lineItems?.edges ?? []).map(({ node: li }) => {
    const currentQty = Number(li.currentQuantity ?? 0);
    const originalQty = Number(li.quantity ?? 0) || 0;
    const refundedLine = currentQty <= 0 && originalQty > 0;
    const qty = refundedLine
      ? 0
      : currentQty > 0
        ? currentQty
        : originalQty || 1;
    const unit = Number(li.originalUnitPriceSet?.shopMoney?.amount ?? 0) || 0;
    const lineItemId = li.id.startsWith("gid://")
      ? li.id
      : `gid://shopify/LineItem/${String(li.id).replace(/\D/g, "")}`;
    const sizeOpt = (li.variant?.selectedOptions ?? []).find((o) => /size/i.test(o.name));
    const sizeEU = sizeOpt?.value || li.variantTitle || null;
    const protection = isPackageProtectionShopifyLine(li.title, li.sku);
    const alreadyMatched = existingLineIds.has(lineItemId) || orderAlreadyCosted;

    return {
      shopifyOrderId: order.id,
      orderName: order.name,
      createdAt: order.createdAt,
      displayFinancialStatus: order.displayFinancialStatus || "",
      displayFulfillmentStatus: order.displayFulfillmentStatus,
      customerEmail: order.customer?.email ?? null,
      customerName: customerName || null,
      customerFirstName: order.customer?.firstName ?? null,
      customerLastName: order.customer?.lastName ?? null,
      shippingCountry: order.shippingAddress?.countryCodeV2 ?? null,
      shippingCity: order.shippingAddress?.city ?? null,
      lineItemId,
      title: li.title,
      sku: li.sku,
      variantTitle: li.variantTitle,
      quantity: qty,
      price: String(unit),
      totalPrice: String(Number((unit * qty).toFixed(2))),
      currencyCode: li.originalUnitPriceSet?.shopMoney?.currencyCode || "CHF",
      sizeEU,
      lineItemImageUrl: li.image?.url ?? null,
      isPackageProtection: protection,
      alreadyMatched,
      refundedLine,
      deletedFromShopify: false,
    };
  });

  const openLines = lines.filter(
    (l) =>
      !l.isPackageProtection &&
      !l.alreadyMatched &&
      !l.refundedLine &&
      l.quantity > 0
  );

  return { lines, openLines };
}

function shapeFromDb(db: {
  shopifyOrderId: string;
  orderName: string;
  createdAt: Date;
  financialStatus: string | null;
  totalSalesChf: any;
  currencyCode: string | null;
}) {
  const sales = Number(db.totalSalesChf ?? 0);
  const num = db.orderName.replace("#", "");
  const line = {
    shopifyOrderId: db.shopifyOrderId,
    orderName: db.orderName,
    createdAt: db.createdAt.toISOString(),
    displayFinancialStatus: db.financialStatus || "PAID",
    displayFulfillmentStatus: null as string | null,
    customerEmail: null as string | null,
    customerName: null as string | null,
    customerFirstName: null as string | null,
    customerLastName: null as string | null,
    shippingCountry: null as string | null,
    shippingCity: null as string | null,
    lineItemId: `synthetic://manual-deleted/${num}`,
    title: `${db.orderName} (deleted in Shopify — enter COGS)`,
    sku: null as string | null,
    variantTitle: null as string | null,
    quantity: 1,
    price: String(sales),
    totalPrice: String(sales),
    currencyCode: db.currencyCode || "CHF",
    sizeEU: null as string | null,
    lineItemImageUrl: null as string | null,
    isPackageProtection: false,
    alreadyMatched: false,
    refundedLine: false,
    deletedFromShopify: true,
  };
  return { lines: [line], openLines: [line] };
}

/**
 * GET /api/orders/unmatched/lines?orderId=gid://shopify/Order/...
 * Live Shopify lines when available; DB synthetic line if order deleted in Admin.
 */
export async function GET(req: NextRequest) {
  try {
    const orderId = String(req.nextUrl.searchParams.get("orderId") || "").trim();
    if (!orderId) {
      return NextResponse.json({ ok: false, error: "Missing orderId" }, { status: 400 });
    }

    const dbOrder = await prisma.shopifyOrder.findFirst({
      where: { shopifyOrderId: orderId },
      select: {
        shopifyOrderId: true,
        orderName: true,
        createdAt: true,
        financialStatus: true,
        totalSalesChf: true,
        currencyCode: true,
      },
    });

    let order: GqlOrder | null = null;
    let gqlError: string | null = null;

    const byId = await shopifyGraphQL<{ order: GqlOrder | null }>(ORDER_LINES_QUERY, {
      id: orderId,
    });
    if (byId.errors?.length) {
      gqlError = byId.errors.map((e: any) => e.message).join("; ");
    } else {
      order = byId.data?.order ?? null;
    }

    // Deleted/archived in Admin → order(id) null; retry name search
    if (!order && dbOrder?.orderName) {
      const byName = await shopifyGraphQL<{
        orders: { edges: Array<{ node: GqlOrder }> };
      }>(ORDER_BY_NAME_QUERY, { q: `name:${dbOrder.orderName}` });
      if (!byName.errors?.length) {
        order = byName.data?.orders?.edges?.[0]?.node ?? null;
      } else if (!gqlError) {
        gqlError = byName.errors.map((e: any) => e.message).join("; ");
      }
    }

    if (!order) {
      if (!dbOrder) {
        return NextResponse.json(
          {
            ok: false,
            error: gqlError || "Order not found in Shopify or DB",
          },
          { status: 404 }
        );
      }

      // Soft-deleted Shopify order: still allow manual COGS via synthetic line
      const shaped = shapeFromDb(dbOrder);
      const existing = await prisma.orderMatch.findMany({
        where: {
          OR: [
            { shopifyOrderId: dbOrder.shopifyOrderId },
            { shopifyOrderName: dbOrder.orderName },
          ],
        },
        select: { shopifyLineItemId: true },
      });
      if (existing.length > 0) {
        return NextResponse.json({
          ok: true,
          order: {
            shopifyOrderId: dbOrder.shopifyOrderId,
            orderName: dbOrder.orderName,
            createdAt: dbOrder.createdAt.toISOString(),
            financialStatus: dbOrder.financialStatus,
          },
          lines: shaped.lines.map((l) => ({ ...l, alreadyMatched: true })),
          openLines: [],
          deletedFromShopify: true,
        });
      }

      return NextResponse.json({
        ok: true,
        order: {
          shopifyOrderId: dbOrder.shopifyOrderId,
          orderName: dbOrder.orderName,
          createdAt: dbOrder.createdAt.toISOString(),
          financialStatus: dbOrder.financialStatus,
        },
        lines: shaped.lines,
        openLines: shaped.openLines,
        deletedFromShopify: true,
        note: "Shopify Admin deleted this order; COGS via synthetic line from DB totals",
      });
    }

    const existing = await prisma.orderMatch.findMany({
      where: {
        OR: [{ shopifyOrderId: order.id }, { shopifyOrderName: order.name }],
      },
      select: { shopifyLineItemId: true },
    });
    const orderAlreadyCosted = existing.some((m) =>
      String(m.shopifyLineItemId || "").startsWith("synthetic://")
    );
    const matchedIds = new Set(
      existing.map((m) => {
        const raw = String(m.shopifyLineItemId || "");
        if (raw.startsWith("synthetic://")) return raw;
        return raw.startsWith("gid://")
          ? raw
          : `gid://shopify/LineItem/${raw.replace(/\D/g, "")}`;
      })
    );

    const { lines, openLines } = shapeFromGql(order, matchedIds, orderAlreadyCosted);

    return NextResponse.json({
      ok: true,
      order: {
        shopifyOrderId: order.id,
        orderName: order.name,
        createdAt: order.createdAt,
        financialStatus: order.displayFinancialStatus,
      },
      lines,
      openLines,
      deletedFromShopify: false,
    });
  } catch (err: any) {
    console.error("[unmatched/lines]", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
