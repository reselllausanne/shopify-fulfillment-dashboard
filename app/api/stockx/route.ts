import { NextRequest, NextResponse } from "next/server";
import { readStockxSessionHeaders } from "@/lib/stockxSessionCookies";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, operationName, query, variables } = body;
    const debug = process.env.STOCKX_DEBUG === "1";

    // Validation: token is required
    if (!token || typeof token !== "string" || token.trim() === "") {
      console.error("[API] Missing or invalid token");
      return NextResponse.json(
        { error: "Bearer token is required" },
        { status: 400 }
      );
    }

    console.log("[API] Calling StockX with operation:", operationName);

    // Prepare the request to StockX Pro API
    const url = "https://stockx.com/api/graphql";
    const sessionHeaders = await readStockxSessionHeaders();
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "authorization": `Bearer ${token}`,
      "origin": "https://stockx.com",
      "referer": "https://stockx.com/buying/orders",
      "apollographql-client-name": "Iron",
      "apollographql-client-version": "2026.01.11.01",
      "app-platform": "Iron",
      "app-version": "2026.01.11.01",
      // Some intermittent responses come back as HTML (WAF/edge); a stable UA helps.
      "user-agent": "Mozilla/5.0 (compatible; ResellLausanneBot/1.0; +https://resell-lausanne.ch)",
    };
    if (sessionHeaders?.cookie) {
      headers.cookie = sessionHeaders.cookie;
    }
    if (sessionHeaders?.deviceId) {
      headers["x-stockx-device-id"] = sessionHeaders.deviceId;
    }
    if (sessionHeaders?.sessionId) {
      headers["x-stockx-session-id"] = sessionHeaders.sessionId;
    }

    const opts: RequestInit = {
      method: "POST",
      headers,
      body: JSON.stringify({
        operationName,
        query,
        variables,
      }),
    };

    const r = await fetch(url, opts);
    const raw = await r.text();

    const debugHeaders = {
      "content-type": r.headers.get("content-type"),
      "cf-ray": r.headers.get("cf-ray"),
      "cf-cache-status": r.headers.get("cf-cache-status"),
      "x-request-id": r.headers.get("x-request-id"),
      "x-stockx-request-id": r.headers.get("x-stockx-request-id"),
      "set-cookie": r.headers.get("set-cookie"),
      "session-cookie": sessionHeaders?.cookie ? "present" : "missing",
      "stockx-device-id": sessionHeaders?.deviceId ? "present" : "missing",
      "stockx-session-id": sessionHeaders?.sessionId ? "present" : "missing",
    };
    const rawHead = raw.slice(0, 1200);

    if (debug) {
      console.log("stockx status", r.status);
      console.log("headers", debugHeaders);
      console.log("raw head", rawHead);
    } else {
      console.log("[API] StockX response status:", r.status);
    }

    // Get the response data
    let data;
    
    try {
      data = JSON.parse(raw);
    } catch (parseError: any) {
      console.error("[API] Failed to parse StockX response:", parseError.message);
      console.error("stockx status", r.status);
      console.error("content-type", r.headers.get("content-type"));
      console.error("headers", debugHeaders);
      console.error("raw head", rawHead);
      return NextResponse.json(
        {
          error: "Invalid JSON response from StockX",
          details: `StockX non-JSON or truncated. status=${r.status} raw_head=${rawHead}`,
          debug: {
            status: r.status,
            statusText: r.statusText,
            rawLength: raw.length,
            rawHead,
            headers: debugHeaders,
          },
        },
        { status: 502 }
      );
    }

    // Return the response with the same status code
    return NextResponse.json(data, { status: r.status });
  } catch (error: any) {
    // Handle any errors
    console.error("[API] Error:", error.message, error.stack);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 }
    );
  }
}

