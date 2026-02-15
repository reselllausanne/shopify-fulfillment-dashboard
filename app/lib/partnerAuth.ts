import { jwtVerify, SignJWT } from "jose";
import type { NextRequest } from "next/server";

export type PartnerSession = {
  partnerId: string;
  partnerKey: string;
  role: string;
};

const COOKIE_NAME = "partner_auth";

function getJwtSecret() {
  const secret = process.env.PARTNER_JWT_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("Missing PARTNER_JWT_SECRET or JWT_SECRET");
  }
  return new TextEncoder().encode(secret);
}

export async function createPartnerToken(payload: PartnerSession) {
  const secret = getJwtSecret();
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
    const secret = getJwtSecret();
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
