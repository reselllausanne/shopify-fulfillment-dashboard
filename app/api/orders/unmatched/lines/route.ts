import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { isPackageProtectionShopifyLine } from "@/app/utils/matching";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/orders/unmatched/lines?orderId=gid://shopify/Order/...
 * Returns Shopify line items shaped for ManualEntryModal / openManualEntryModal.
 */
export async function GET(req: NextRequest) {
  try {
    const orderId = String(req.nextUrl.searchParams.get("orderId") || "").trim();
    if (!orderId) {
      return NextResponse.json({ ok: false, error: "Missing orderId" }, { status: 400 });
    }

    const query = /* GraphQL */ `
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

    const { data, errors } = await shopifyGraphQL<{
      order: {
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
      } | null;
    }>(query, { id: orderId });

    if (errors?.length) {
      return NextResponse.json(
        { ok: false, error: errors.map((e: any) => e.message).join("; ") },
        { status: 502 }
      );
    }
    const order = data?.order;
    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }

    const existing = await prisma.orderMatch.findMany({
      where: { shopifyOrderId: order.id },
      select: { shopifyLineItemId: true },
    });
    const matchedIds = new Set(
      existing.map((m) => {
        const raw = String(m.shopifyLineItemId || "");
        return raw.startsWith("gid://")
          ? raw
          : `gid://shopify/LineItem/${raw.replace(/\D/g, "")}`;
      })
    );

    const customerName = [order.customer?.firstName, order.customer?.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();

    const lines = (order.lineItems?.edges ?? []).map(({ node: li }) => {
      const qty =
        Number(li.currentQuantity ?? li.quantity ?? 0) || Number(li.quantity ?? 0) || 1;
      const unit = Number(li.originalUnitPriceSet?.shopMoney?.amount ?? 0) || 0;
      const lineItemId = li.id.startsWith("gid://")
        ? li.id
        : `gid://shopify/LineItem/${String(li.id).replace(/\D/g, "")}`;
      const sizeOpt = (li.variant?.selectedOptions ?? []).find((o) => /size/i.test(o.name));
      const sizeEU = sizeOpt?.value || li.variantTitle || null;
      const protection = isPackageProtectionShopifyLine(li.title, li.sku);
      const alreadyMatched = matchedIds.has(lineItemId);

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
      };
    });

    const openLines = lines.filter((l) => !l.isPackageProtection && !l.alreadyMatched);

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
    });
  } catch (err: any) {
    console.error("[unmatched/lines]", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
