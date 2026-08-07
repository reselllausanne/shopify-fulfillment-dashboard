import { NextRequest, NextResponse } from "next/server";

import { requireHealthAdmin } from "@/app/lib/healthAdminAuth";
import { mockGarminProvider } from "@/healthdata/providers/mockGarmin";
import { upsertIntegrationAccount } from "@/healthdata/repository";
import { hasTokenEncryptionKey } from "@/healthdata/crypto/tokens";

/** One-click mock Garmin connect (no external redirect). */
export async function POST(req: NextRequest) {
  const denied = await requireHealthAdmin(req);
  if (denied) return denied;

  if (!hasTokenEncryptionKey()) {
    return NextResponse.json(
      { ok: false, error: "HEALTH_TOKEN_ENCRYPTION_KEY missing" },
      { status: 400 }
    );
  }

  const tokens = await mockGarminProvider.exchangeAuthorizationCode("mock", {
    codeVerifier: "mock",
    codeChallenge: "mock",
    codeChallengeMethod: "S256",
  });
  const account = await upsertIntegrationAccount({
    provider: "mock_garmin",
    tokens,
    displayName: "Mock Garmin",
  });

  return NextResponse.json({ ok: true, account });
}
