import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;

export async function GET(request: NextRequest) {
  if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET) {
    return NextResponse.json(
      { error: "Shopify API credentials are missing" },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const shop = searchParams.get("shop");
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const hmac = searchParams.get("hmac");
  const storedState = request.cookies.get("shopify_oauth_state")?.value;

  if (!shop || !code || !hmac) {
    return NextResponse.json({ error: "Missing required query parameters" }, { status: 400 });
  }

  if (!storedState || storedState !== state) {
    return NextResponse.json({ error: "Invalid OAuth state" }, { status: 400 });
  }

  try {
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: SHOPIFY_API_KEY,
        client_secret: SHOPIFY_API_SECRET,
        code,
      }),
    });

    const tokenJson = await tokenRes.json();
    const accessToken = tokenJson?.access_token;

    if (!accessToken) {
      console.error("[SHOPIFY-OAUTH] Access token response:", tokenJson);
      return NextResponse.json({ error: "Failed to obtain access token" }, { status: 500 });
    }

    console.log("[SHOPIFY-OAUTH] ACCESS_TOKEN:", accessToken);

    const response = NextResponse.json({
      success: true,
      message: "Paste this access token into ACCESS_TOKEN_SHOPIFY",
      accessToken,
    });
    response.cookies.delete("shopify_oauth_state");
    return response;
  } catch (error: any) {
    console.error("[SHOPIFY-OAUTH] Error exchanging code:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to exchange OAuth code" },
      { status: 500 }
    );
  }
}

