import { NextResponse } from "next/server";

/**
 * Shared-secret gate for the internal kickdb buffer routes.
 * Inactive until KICKDB_INTERNAL_TOKEN is set in the environment, so the POC
 * can run open on localhost first and be locked down at go-live without a
 * code change.
 */
export function checkSharedSecret(req: Request): NextResponse | null {
  const expected = process.env.KICKDB_INTERNAL_TOKEN;
  if (!expected) return null;
  if (req.headers.get("x-internal-token") === expected) return null;
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}
