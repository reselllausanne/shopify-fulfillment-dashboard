import { randomBytes } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { requireHealthAdmin } from "@/app/lib/healthAdminAuth";
import { resolveGarminProvider } from "@/healthdata/providers";
import { createPkce } from "@/healthdata/providers/types";

export async function GET(req: NextRequest) {
  const denied = await requireHealthAdmin(req);
  if (denied) return denied;

  const provider = resolveGarminProvider();
  const pkce = createPkce();
  const state = randomBytes(16).toString("hex");

  const response = NextResponse.redirect(
    new URL(provider.getAuthorizationUrl(state, pkce), req.url)
  );

  // Short-lived cookies for OAuth round-trip (not the OAuth tokens themselves).
  const cookieOpts = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  };
  response.cookies.set("health_oauth_state", state, cookieOpts);
  response.cookies.set("health_oauth_verifier", pkce.codeVerifier, cookieOpts);
  response.cookies.set("health_oauth_provider", provider.id, cookieOpts);
  return response;
}
