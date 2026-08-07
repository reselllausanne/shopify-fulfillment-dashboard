import { timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { resolveHealthConfig } from "@/healthdata/config";
import { getProvider, resolveGarminProvider } from "@/healthdata/providers";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Provider webhook ingress. Public path; gated by HEALTH_WEBHOOK_SECRET header.
 * Does not log Authorization or token material.
 */
export async function POST(req: NextRequest) {
  const config = resolveHealthConfig();
  const secret = config.webhookSecret;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "Webhook not configured" }, { status: 503 });
  }

  // Shared secret until provider-specific signature verification is wired from official docs.
  const provided = req.headers.get("x-health-webhook-secret") ?? "";
  if (!provided || !safeEqual(provided, secret)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const providerHint = (req.headers.get("x-health-provider") ?? "garmin").toLowerCase();
  const provider =
    providerHint === "whoop" ? getProvider("whoop") : resolveGarminProvider();

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const result = await provider.handleWebhook(req.headers, body);
  return NextResponse.json({
    ok: result.acknowledged,
    shouldPull: result.shouldPull,
    resourceHints: result.resourceHints,
    // Trigger incremental sync out-of-band via CLI/cron; keep webhook fast.
    message: result.message ?? "acked",
  });
}
