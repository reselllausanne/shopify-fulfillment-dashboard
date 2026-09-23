import { NextResponse } from "next/server";
import { getQzPublicCertificate } from "@/lib/qzSecurity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public certificate for QZ Tray trust. Never returns the private key.
 */
export async function GET() {
  const certificate = getQzPublicCertificate();
  if (!certificate) {
    return NextResponse.json(
      {
        ok: false,
        error: "QZ certificate not configured on server (QZ_PUBLIC_CERT).",
        configured: false,
      },
      { status: 503 }
    );
  }
  return NextResponse.json({ ok: true, configured: true, certificate });
}
