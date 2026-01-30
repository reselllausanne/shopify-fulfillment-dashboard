import { NextResponse } from "next/server";

export const runtime = "edge";

const SHOP_NAME = process.env.SHOP_NAME_SHOPIFY;
const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_SCOPES = process.env.SHOPIFY_SCOPES;
const SHOPIFY_APP_URL = process.env.SHOPIFY_APP_URL;

export function GET() {
  if (typeof crypto === "undefined" || !crypto.getRandomValues) {
    return NextResponse.json(
      { error: "Edge runtime does not expose `crypto.getRandomValues`" },
      { status: 500 }
    );
  }

  if (!SHOP_NAME || !SHOPIFY_API_KEY || !SHOPIFY_SCOPES || !SHOPIFY_APP_URL) {
    return NextResponse.json(
      { error: "Missing Shopify OAuth configuration in env" },
      { status: 500 }
    );
  }

  const randomBytes = new Uint8Array(16);
  crypto.getRandomValues(randomBytes);
  const state = Array.from(randomBytes)
    .map((b: number) => b.toString(16).padStart(2, "0"))
    .join("");
  const redirectUri = `${SHOPIFY_APP_URL.replace(/\/$/, "")}/auth/callback`;

  const installUrl =
    `https://${SHOP_NAME}/admin/oauth/authorize` +
    `?client_id=${SHOPIFY_API_KEY}` +
    `&scope=${encodeURIComponent(SHOPIFY_SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}`;

  const response = NextResponse.redirect(installUrl);
  response.cookies.set("shopify_oauth_state", state, {
    httpOnly: true,
    path: "/",
    maxAge: 10 * 60,
  });
  return response;
}

