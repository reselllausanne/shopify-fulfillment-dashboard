import { NextResponse } from "next/server";
import {
  processOrdersPaidPayload,
  verifyShopifyWebhookHmac,
  webhookSigningSecrets,
  type OrderPaidPayload,
} from "@/shopify/orders/ordersPaidConvergence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Phase 4.4 — Shopify order webhook trigger.
 *
 * Shopify commits physical stock on orders/paid. We sync the mirror, converge
 * listing mode (keep liquidation when lane stock remains, else revert to dropship),
 * and relist STX when the liquidation lane hits 0. Idempotent on redeliveries.
 *
 * Webhook topic: orders/paid
 * Verify: HMAC-SHA256(raw body, SHOPIFY_API_SECRET) base64 == X-Shopify-Hmac-Sha256
 */

export async function POST(req: Request) {
  const rawBuf = Buffer.from(await req.arrayBuffer());
  const hmac = req.headers.get("x-shopify-hmac-sha256");
  const topic = req.headers.get("x-shopify-topic") ?? "";
  const shop = req.headers.get("x-shopify-shop-domain") ?? "";
  const webhookId = req.headers.get("x-shopify-webhook-id") ?? "";

  const verified = verifyShopifyWebhookHmac(rawBuf, hmac);
  if (!verified) {
    console.warn("[shopify][webhook][orders-paid] hmac mismatch", {
      topic,
      shop,
      webhookId,
      secretCandidates: webhookSigningSecrets().length,
      bodyBytes: rawBuf.length,
    });
    return NextResponse.json({ ok: false, error: "invalid_hmac" }, { status: 401 });
  }

  let payload: OrderPaidPayload;
  try {
    payload = JSON.parse(rawBuf.toString("utf8"));
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const items = Array.isArray(payload.line_items) ? payload.line_items : [];
  const orderId = String(payload.admin_graphql_api_id ?? payload.id ?? "");

  let gtins: string[] = [];
  let results: Awaited<ReturnType<typeof processOrdersPaidPayload>>["results"] = [];
  try {
    const processed = await processOrdersPaidPayload(payload);
    gtins = processed.gtins;
    results = processed.results;
  } catch (err: any) {
    console.error("[shopify][webhook][orders-paid] gtin resolve failed", {
      orderId,
      error: err?.message ?? err,
    });
  }

  console.info("[shopify][webhook][orders-paid] processed", {
    topic,
    shop,
    webhookId,
    orderId,
    lineItems: items.length,
    gtins: gtins.length,
    changed: results.filter((r) => r.changed).length,
    errors: results.filter((r) => r.error).length,
  });

  return NextResponse.json({
    ok: true,
    orderId,
    gtins: gtins.length,
    results,
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "POST /api/shopify/webhooks/orders-paid",
    verify: "HMAC-SHA256(raw body, SHOPIFY_API_SECRET) base64 == X-Shopify-Hmac-Sha256",
    secretEnvKeys: ["SHOPIFY_API_SECRET", "SHOPIFY_CLIENT_SECRET", "SHOPIFY_WEBHOOK_SECRET"],
  });
}
