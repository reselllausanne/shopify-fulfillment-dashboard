// app/api/shopify/set-metafields/route.ts
import { NextResponse } from "next/server";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";

const MUTATION = /* GraphQL */ `
mutation SetOrderMetafields($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id namespace key type value }
    userErrors { field message }
  }
}
`;

function toDateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  // accepts ISO; returns YYYY-MM-DD
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const shopifyOrderId = String(body?.shopifyOrderId ?? "").trim();
    const stockxOrderNumber = String(body?.stockxOrderNumber ?? "").trim();

    if (!shopifyOrderId || !stockxOrderNumber) {
      return NextResponse.json(
        { error: "Missing shopifyOrderId or stockxOrderNumber" },
        { status: 400 }
      );
    }

    const estimatedDelivery = toDateOnly(body?.estimatedDelivery ?? null);
    const stockxStatus = String(body?.stockxStatus ?? "UNKNOWN");
    const supplierCost = String(body?.supplierCost ?? "0");
    const marginAmount = String(body?.marginAmount ?? "0");
    const marginPercent = String(body?.marginPercent ?? "0");
    const trackingNumber = body?.trackingNumber ? String(body.trackingNumber).trim() : null; // ✅ AWB / tracking number
    let trackingUrl = body?.trackingUrl ? String(body.trackingUrl).trim() : null; // ✅ Full tracking URL
    if (trackingUrl) {
      // Normalize and validate to satisfy Shopify "link" type
      if (!/^https?:\/\//i.test(trackingUrl)) {
        trackingUrl = `https://${trackingUrl}`;
      }
      try {
        const parsed = new URL(trackingUrl);
        trackingUrl = parsed.toString(); // canonical
      } catch (e) {
        return NextResponse.json(
          { error: "Invalid trackingUrl for metafield supplier.url_awb (must be a valid link)" },
          { status: 400 }
        );
      }
    }

    // 🔒 CRITICAL: Check if this Supplier order is already matched to a DIFFERENT Shopify order
    const existingMatch = await prisma.orderMatch.findFirst({
      where: {
        stockxOrderNumber: stockxOrderNumber,
      },
      select: {
        shopifyOrderId: true,
        shopifyOrderName: true,
      },
    });

    if (existingMatch && existingMatch.shopifyOrderId !== shopifyOrderId) {
      console.error(
        `[SHOPIFY] ❌ DUPLICATE PREVENTION: Supplier order ${stockxOrderNumber} is already matched to Shopify order ${existingMatch.shopifyOrderName}!`
      );
      return NextResponse.json(
        {
          error: "Duplicate match prevented",
          message: `This Supplier order (${stockxOrderNumber}) is already matched to Shopify order ${existingMatch.shopifyOrderName}. Cannot match the same Supplier order to multiple Shopify orders.`,
          existingMatch: existingMatch.shopifyOrderName,
        },
        { status: 409 } // 409 Conflict
      );
    }

    console.log(`[SHOPIFY] Setting metafields for order ${shopifyOrderId}`);
    console.log(`  - Supplier Order: ${stockxOrderNumber}`);
    console.log(`  - Status: ${stockxStatus}`);
    console.log(`  - Estimated Delivery: ${estimatedDelivery || "N/A"}`);
    console.log(`  - Supplier Cost: ${supplierCost}`);
    console.log(`  - Margin: ${marginAmount} (${marginPercent}%)`);

    const metafields: any[] = [
      {
        ownerId: shopifyOrderId,
        namespace: "supplier",
        key: "order_number",
        type: "single_line_text_field",
        value: stockxOrderNumber,
      },
      {
        ownerId: shopifyOrderId,
        namespace: "supplier",
        key: "status",
        type: "single_line_text_field",
        value: stockxStatus,
      },
      {
        ownerId: shopifyOrderId,
        namespace: "supplier",
        key: "total_cost",
        type: "number_decimal",
        value: supplierCost,
      },
      {
        ownerId: shopifyOrderId,
        namespace: "supplier",
        key: "margin_amount",
        type: "number_decimal",
        value: marginAmount,
      },
      {
        ownerId: shopifyOrderId,
        namespace: "supplier",
        key: "margin_percent",
        type: "number_decimal",
        value: marginPercent,
      },
    ];

    if (estimatedDelivery) {
      metafields.push({
        ownerId: shopifyOrderId,
        namespace: "supplier",
        key: "estimated_delivery",
        type: "date",
        value: estimatedDelivery,
      });
    }

    // ✅ Add tracking_number metafield (AWB)
    if (trackingNumber) {
      metafields.push({
        ownerId: shopifyOrderId,
        namespace: "supplier",
        key: "tracking_number",
        type: "single_line_text_field",
        value: trackingNumber,
      });
    }

    // ✅ Add tracking URL metafield if provided
    if (trackingUrl) {
      metafields.push({
        ownerId: shopifyOrderId,
        namespace: "supplier",
        key: "url_awb",
        type: "url",
        value: trackingUrl,
      });
    }

    const { data, errors } = await shopifyGraphQL<{
      metafieldsSet: {
        metafields: any[];
        userErrors: { field: string[] | null; message: string }[];
      };
    }>(MUTATION, { metafields });

    if (errors?.length) {
      console.error("[SHOPIFY] GraphQL errors:", errors);
      return NextResponse.json({ error: "Shopify GraphQL errors", details: errors }, { status: 500 });
    }

    const userErrors = data?.metafieldsSet?.userErrors ?? [];
    if (userErrors.length) {
      console.error("[SHOPIFY] User errors:", userErrors);
      return NextResponse.json(
        { error: "Shopify userErrors", details: userErrors },
        { status: 400 }
      );
    }

    console.log(`[SHOPIFY] Successfully set ${data.metafieldsSet.metafields.length} metafields`);

    return NextResponse.json({ ok: true, metafields: data.metafieldsSet.metafields });
  } catch (err: any) {
    console.error("[/api/shopify/set-metafields] error:", err);
    return NextResponse.json(
      { error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
