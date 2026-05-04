import { NextRequest, NextResponse } from "next/server";
import { buildAuthRedirect } from "@/app/lib/shopifyAuth";

export const runtime = "edge";

export function GET(request: NextRequest) {
  try {
    const shop = new URL(request.url).searchParams.get("shop");
    const { state, url } = buildAuthRedirect({ shop });
    const response = NextResponse.redirect(url);
    response.cookies.set("shopify_oauth_state", state, {
      httpOnly: true,
      path: "/",
      maxAge: 10 * 60,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    return response;
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Missing Shopify OAuth config" }, { status: 500 });
  }
}

