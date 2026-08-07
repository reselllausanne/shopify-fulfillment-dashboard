import { randomBytes } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { requireHealthAdmin } from "@/app/lib/healthAdminAuth";
import { getProvider } from "@/healthdata/providers";
import { createPkce } from "@/healthdata/providers/types";

export async function GET(req: NextRequest) {
  const denied = await requireHealthAdmin(req);
  if (denied) return denied;

  try {
    const provider = getProvider("whoop");
    const pkce = createPkce(); // unused by WHOOP (no PKCE); kept for interface
    // WHOOP requires state length === 8
    const state = randomBytes(4).toString("hex");
    const authUrl = provider.getAuthorizationUrl(state, pkce);
    const response = NextResponse.redirect(authUrl);
    const cookieOpts = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 600,
    };
    response.cookies.set("health_oauth_state", state, cookieOpts);
    // Placeholder verifier so shared callback cookie checks pass
    response.cookies.set("health_oauth_verifier", "whoop-no-pkce", cookieOpts);
    response.cookies.set("health_oauth_provider", "whoop", cookieOpts);
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : "whoop_oauth_unavailable";
    return NextResponse.redirect(
      new URL(`/health/ops?error=${encodeURIComponent(message.slice(0, 120))}`, req.url)
    );
  }
}
