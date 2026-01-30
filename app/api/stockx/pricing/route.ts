import { NextRequest, NextResponse } from "next/server";

const GRAPHQL_URL = "https://pro.stockx.com/api/graphql";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, variables } = body ?? {};

    if (!token) {
      console.error("[PRICING] Missing token");
      return NextResponse.json({ error: "Missing token" }, { status: 400 });
    }
    if (!variables?.orderNumber || !variables?.variants?.length) {
      console.error("[PRICING] Missing variables", variables);
      return NextResponse.json(
        { error: "Missing variables.orderNumber/variants" },
        { status: 400 }
      );
    }
    
    console.log("[PRICING] Fetching pricing for order:", variables.orderNumber);

    const query = `query PurchasePricing($currencyCode: CurrencyCode, $tradeContext: String = "buying", $variants: [PricingVariantInput], $buyerVatId: String, $orderNumber: String) {
      pricing {
        estimate(
          pricingInput: {buyerVatId: $buyerVatId, localCurrencyCode: $currencyCode, tradeContextInput: {is: $tradeContext}, variants: $variants, buyOrder: $orderNumber}
          pricingRequestParams: {includeTaxes: true, includeDdp: true, includeProducts: false, combineAdjustments: false}
        ) {
          subtotal
          total
          adjustments {
            amount
            text
            translationKey
            __typename
          }
          __typename
        }
        __typename
      }
    }`;

    const upstream = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        origin: "https://pro.stockx.com",
        referer: "https://pro.stockx.com/purchasing/orders",
      },
      body: JSON.stringify({
        operationName: "PurchasePricing",
        query,
        variables,
      }),
    });

    const responseText = await upstream.text();
    let data;
    
    try {
      data = JSON.parse(responseText);
    } catch (parseError: any) {
      console.error("[PRICING] Failed to parse response:", parseError.message);
      return NextResponse.json(
        { error: "Invalid JSON response", details: parseError.message },
        { status: 500 }
      );
    }
    
    return NextResponse.json(data, { status: upstream.status });
  } catch (error: any) {
    console.error("[PRICING] Error:", error.message, error.stack);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 }
    );
  }
}

