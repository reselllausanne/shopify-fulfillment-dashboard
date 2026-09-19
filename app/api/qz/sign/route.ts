import { NextRequest, NextResponse } from "next/server";
import { createSign } from "node:crypto";
import { getQzPrivateKey } from "@/lib/qzSecurity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Signs a QZ Tray request string with the server private key.
 * The private key never reaches the browser.
 */
export async function POST(req: NextRequest) {
  const privateKey = getQzPrivateKey();
  if (!privateKey) {
    return NextResponse.json(
      {
        ok: false,
        error: "QZ signing key not configured on server (QZ_PRIVATE_KEY).",
        configured: false,
      },
      { status: 503 }
    );
  }

  let body: { request?: string } = {};
  try {
    body = (await req.json()) as { request?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const toSign = String(body.request ?? "");
  if (!toSign) {
    return NextResponse.json({ ok: false, error: "Missing request to sign" }, { status: 400 });
  }

  try {
    const signer = createSign("SHA512");
    signer.update(toSign);
    signer.end();
    const signature = signer.sign(privateKey, "base64");
    return NextResponse.json({ ok: true, signature });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Sign failed" },
      { status: 500 }
    );
  }
}
