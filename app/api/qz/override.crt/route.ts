import { NextResponse } from "next/server";
import { getQzPublicCertificate } from "@/lib/qzSecurity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Downloadable override.crt for packing PCs (QZ Tray silent trust).
 * Same public cert as /api/qz/certificate — never the private key.
 *
 * Install:
 *   Mac: /Applications/QZ Tray.app/Contents/Resources/override.crt
 *   Windows: C:\Program Files\QZ Tray\override.crt
 * Then restart QZ Tray.
 */
export async function GET() {
  const certificate = getQzPublicCertificate();
  if (!certificate) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "QZ certificate not configured on server (QZ_PUBLIC_CERT). Ask admin to set env once.",
        configured: false,
      },
      { status: 503 }
    );
  }

  // PEM body — QZ accepts this as override.crt
  const body = certificate.endsWith("\n") ? certificate : `${certificate}\n`;
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "application/x-x509-ca-cert; charset=utf-8",
      "content-disposition": 'attachment; filename="override.crt"',
      "cache-control": "no-store",
    },
  });
}
