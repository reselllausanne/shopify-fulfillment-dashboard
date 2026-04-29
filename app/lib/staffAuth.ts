import { jwtVerify } from "jose";
import type { NextRequest } from "next/server";

export type StaffRole = "admin" | "logistics";

const STAFF_AUTH_COOKIE = "auth_token";

function normalizeRole(value: unknown): StaffRole | null {
  if (value === "admin" || value === "logistics") return value;
  return null;
}

function resolveJwtSecretBytes(): Uint8Array | null {
  const raw = String(process.env.JWT_SECRET || "").trim();
  if (!raw) return null;
  return new TextEncoder().encode(raw);
}

export async function getStaffRoleFromRequest(req: NextRequest): Promise<StaffRole | null> {
  const token = req.cookies.get(STAFF_AUTH_COOKIE)?.value;
  if (!token) return null;
  const secret = resolveJwtSecretBytes();
  if (!secret) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    return normalizeRole(payload?.role);
  } catch {
    return null;
  }
}

export function resolveSwissPostFrankingLicenseForRole(role: StaffRole | null): string {
  const defaultLicense = String(process.env.SWISS_POST_FRANKING_LICENSE || "").trim();
  const adminLicense = String(process.env.SWISS_POST_FRANKING_LICENSE_ADMIN || "").trim();
  const logisticsLicense = String(
    process.env.SWISS_POST_FRANKING_LICENSE_LOGISTICS ||
      process.env.SWISS_POST_FRANKING_LICENSE_LOGISTIC ||
      ""
  ).trim();

  if (role === "logistics") return logisticsLicense || defaultLicense;
  if (role === "admin") return adminLicense || defaultLicense;
  return defaultLicense;
}
