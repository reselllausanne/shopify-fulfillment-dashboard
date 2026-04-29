import { NextRequest, NextResponse } from "next/server";
import {
  STOCKX_PURCHASE_PRICING_OPERATION_NAME,
  STOCKX_PURCHASE_PRICING_PERSISTED_HASH,
} from "@/app/lib/constants";

const STOCKX_GRAPHQL_URL = "https://stockx.com/api/graphql";
const STOCKX_PRO_GRAPHQL_URL = "https://pro.stockx.com/api/graphql";
const CHROME_147_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

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

    const payload = {
      operationName: STOCKX_PURCHASE_PRICING_OPERATION_NAME,
      variables,
      extensions: {
        persistedQuery: {
          version: 1,
          sha256Hash: STOCKX_PURCHASE_PRICING_PERSISTED_HASH,
        },
      },
    };
    const targets = [STOCKX_GRAPHQL_URL, STOCKX_PRO_GRAPHQL_URL];
    let selectedUrl = targets[0];
    let selectedStatus = 0;
    let responseText = "";

    for (const url of targets) {
      const origin = new URL(url).origin;
      const referer = `${origin}/buying/orders`;
      const upstream = await fetch(url, {
        method: "POST",
        headers: {
          accept: "application/json",
          "accept-language": "en-US",
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          origin,
          referer,
          priority: "u=1, i",
          "apollographql-client-name": "Iron",
          "apollographql-client-version": "2026.04.19.00",
          "app-platform": "Iron",
          "app-version": "2026.04.19.00",
          "selected-country": "CH",
          "x-operation-name": STOCKX_PURCHASE_PRICING_OPERATION_NAME,
          "sec-ch-prefers-color-scheme": "light",
          "sec-ch-ua": '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"macOS"',
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
          "user-agent": CHROME_147_UA,
        },
        body: JSON.stringify(payload),
      });
      selectedUrl = url;
      selectedStatus = upstream.status;
      responseText = await upstream.text();
      if (upstream.status !== 403 && upstream.status !== 404) {
        break;
      }
    }
    let data;
    
    try {
      data = JSON.parse(responseText);
    } catch (parseError: any) {
      console.error("[PRICING] Failed to parse response:", parseError.message);
      return NextResponse.json(
        { error: "Invalid JSON response", details: parseError.message, upstreamUrl: selectedUrl },
        { status: 500 }
      );
    }

    const response = NextResponse.json(data, { status: selectedStatus });
    response.headers.set("x-stockx-pricing-upstream-url", selectedUrl);
    response.headers.set(
      "x-stockx-pricing-hash",
      STOCKX_PURCHASE_PRICING_PERSISTED_HASH
    );
    return response;
  } catch (error: any) {
    console.error("[PRICING] Error:", error.message, error.stack);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 }
    );
  }
}

