import { NextResponse } from "next/server";
import { buildAuthRedirect } from "@/app/lib/shopifyAuth";

export const runtime = "edge";

export function GET() {
  try {
    const { state, url } = buildAuthRedirect();
    const response = NextResponse.redirect(url);
    response.cookies.set("shopify_oauth_state", state, {
      httpOnly: true,
      path: "/",
      maxAge: 10 * 60,
    });
    return response;
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Missing Shopify OAuth config" }, { status: 500 });
  }
}

