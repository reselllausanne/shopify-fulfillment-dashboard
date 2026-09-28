import { NextRequest, NextResponse } from "next/server";
import { createSign } from "node:crypto";
import { getQzPrivateKey } from "@/lib/qzSecurity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function signRequest(toSign: string, privateKey: string): string {
  const signer = createSign("SHA512");
  signer.update(toSign);
  signer.end();
  return signer.sign(privateKey, "base64");
}

/**
 * Signs a QZ Tray request string with the server private key.
 * Called by the browser on EVERY privileged QZ call (print, find, …).
 * Private key never reaches the browser.
 *
 * Accepts:
 * - POST JSON { request }
 * - GET ?request=… (QZ sample style)
 *
 * Returns text/plain signature by default (QZ docs); JSON if Accept: application/json.
 */
export async function POST(req: NextRequest) {
  return handleSign(req, "POST");
}

export async function GET(req: NextRequest) {
  return handleSign(req, "GET");
}

async function handleSign(req: NextRequest, method: "GET" | "POST") {
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

  let toSign = "";
  if (method === "GET") {
    toSign = String(req.nextUrl.searchParams.get("request") ?? "");
  } else {
    try {
      const body = (await req.json()) as { request?: string };
      toSign = String(body.request ?? "");
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
    }
  }

  if (!toSign) {
    return NextResponse.json({ ok: false, error: "Missing request to sign" }, { status: 400 });
  }

  try {
    const signature = signRequest(toSign, privateKey);
    const wantJson = (req.headers.get("accept") || "").includes("application/json");
    if (wantJson) {
      return NextResponse.json({ ok: true, signature });
    }
    return new NextResponse(signature, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Sign failed" },
      { status: 500 }
    );
  }
}
