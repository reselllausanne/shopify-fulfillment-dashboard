import { NextResponse } from "next/server";
import { POST as confirm } from "../confirm/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * AMP for Email size picker. Called by amp-form (XHR) from Gmail / amp.gmail.dev.
 * Reuses the confirm route logic (holds, rate limit, Klaviyo profile PATCH, BFCM Registered event).
 * AMP CORS contract: reflect Origin if it is an AMP-capable mail origin, and AMP-Email-Allow-Sender.
 */
const AMP_ORIGINS = ["https://mail.google.com", "https://amp.gmail.dev", "https://playground.amp.dev"];
const SENDER = process.env.BFCM_AMP_SENDER || "contact@resell-lausanne.ch";

function ampHeaders(origin: string | null, sourceOrigin: string | null) {
  const h: Record<string, string> = {
    "AMP-Email-Allow-Sender": SENDER,
    "Access-Control-Expose-Headers": "AMP-Access-Control-Allow-Source-Origin,AMP-Email-Allow-Sender",
    Vary: "Origin",
  };
  if (origin && AMP_ORIGINS.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  if (sourceOrigin) h["AMP-Access-Control-Allow-Source-Origin"] = sourceOrigin;
  return h;
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...ampHeaders(origin, null),
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const url = new URL(req.url);
  const sourceOrigin = url.searchParams.get("__amp_source_origin");
  const h = ampHeaders(origin, sourceOrigin);
  if (!origin || !AMP_ORIGINS.includes(origin)) {
    return NextResponse.json({ ok: false }, { status: 403, headers: h });
  }
  const form = await req.formData().catch(() => null);
  const email = String(form?.get("email") ?? "");
  const size_range = String(form?.get("size_range") ?? "");
  // Delegate to the confirm route with its allowed web origin.
  const inner = await confirm(
    new Request(req.url, {
      method: "POST",
      headers: {
        origin: "https://www.resell-lausanne.ch",
        "x-forwarded-for": req.headers.get("x-forwarded-for") ?? "",
      },
      body: JSON.stringify({ email, size_range }),
    }),
  );
  const data = await inner.json().catch(() => ({ ok: false }));
  const label = size_range.replace("-", "–");
  return NextResponse.json(
    { ok: !!data.ok && inner.status < 400, label, status: inner.status === 403 ? "blocked" : "saved" },
    { status: inner.status === 403 ? 403 : 200, headers: h },
  );
}
