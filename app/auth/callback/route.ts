import { NextRequest, NextResponse } from "next/server";
import { exchangeAuthCode } from "@/app/lib/shopifyAuth";

export const runtime = "edge";

export async function GET(request: NextRequest) {
  try {
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

    const accessToken = await exchangeAuthCode(shop, code);

    if (!accessToken) {
      return NextResponse.json({ error: "Failed to obtain access token" }, { status: 500 });
    }

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

