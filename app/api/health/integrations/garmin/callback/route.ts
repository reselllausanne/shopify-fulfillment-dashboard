import { NextRequest, NextResponse } from "next/server";

import { requireHealthAdmin } from "@/app/lib/healthAdminAuth";
import { getProvider } from "@/healthdata/providers";
import { upsertIntegrationAccount } from "@/healthdata/repository";
import type { HealthProviderId } from "@/healthdata/types";

export async function GET(req: NextRequest) {
  const denied = await requireHealthAdmin(req);
  if (denied) return denied;

  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("health_oauth_state")?.value;
  const verifier = req.cookies.get("health_oauth_verifier")?.value;
  const providerId = (req.cookies.get("health_oauth_provider")?.value ||
    url.searchParams.get("provider") ||
    "mock_garmin") as HealthProviderId;

  if (!code || !state || !cookieState || state !== cookieState || !verifier) {
    return NextResponse.redirect(new URL("/health/ops?error=oauth_state", req.url));
  }

  try {
    const resolvedId: HealthProviderId =
      providerId === "whoop"
        ? "whoop"
        : providerId === "garmin"
          ? "garmin"
          : providerId === "mock_garmin"
            ? "mock_garmin"
            : "mock_garmin";
    const provider = getProvider(resolvedId);
    const tokens = await provider.exchangeAuthorizationCode(code, {
      codeVerifier: verifier,
      codeChallenge: "",
      codeChallengeMethod: "S256",
    });
    await upsertIntegrationAccount({
      provider: provider.id,
      tokens,
      displayName: `${provider.id} account`,
    });

    const res = NextResponse.redirect(
      new URL(`/health/ops?connected=1&provider=${provider.id}`, req.url)
    );
    res.cookies.set("health_oauth_state", "", { path: "/", maxAge: 0 });
    res.cookies.set("health_oauth_verifier", "", { path: "/", maxAge: 0 });
    res.cookies.set("health_oauth_provider", "", { path: "/", maxAge: 0 });
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : "oauth_failed";
    return NextResponse.redirect(
      new URL(`/health/ops?error=${encodeURIComponent(message.slice(0, 120))}`, req.url)
    );
  }
}
