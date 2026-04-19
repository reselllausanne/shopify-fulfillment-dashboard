import { jwtVerify, SignJWT } from "jose";
import type { NextRequest } from "next/server";

type PartnerSession = {
  partnerId: string;
  partnerKey: string;
  role: string;
};

const COOKIE_NAME = "partner_auth";

/** Same server-side signing as other cookies; partners never type this. */
const DEV_FALLBACK_SIGNING_KEY = "partner-portal-local-dev-only-not-for-production";

function resolvePartnerSigningKeyBytes(): Uint8Array {
  const raw =
    process.env.PARTNER_JWT_SECRET ||
    process.env.JWT_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.SESSION_SECRET;
  const trimmed = raw?.trim();
  if (trimmed && trimmed.length >= 8) {
    return new TextEncoder().encode(trimmed);
  }
  if (trimmed) {
    throw new Error("Signing secret must be at least 8 characters");
  }
  if (process.env.NODE_ENV !== "production") {
    return new TextEncoder().encode(DEV_FALLBACK_SIGNING_KEY);
  }
  const err = new Error("PARTNER_SIGNING_NOT_CONFIGURED") as Error & { code?: string };
  err.code = "PARTNER_SIGNING_NOT_CONFIGURED";
  throw err;
}

export async function createPartnerToken(payload: PartnerSession) {
  const secret = resolvePartnerSigningKeyBytes();
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);
}

export async function getPartnerSession(req: NextRequest): Promise<PartnerSession | null> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const secret = resolvePartnerSigningKeyBytes();
    const { payload } = await jwtVerify(token, secret);
    if (!payload?.partnerId || !payload?.partnerKey) return null;
    return {
      partnerId: String(payload.partnerId),
      partnerKey: String(payload.partnerKey),
      role: String(payload.role ?? "partner"),
    };
  } catch {
    return null;
  }
}

export const partnerAuthCookieName = COOKIE_NAME;
