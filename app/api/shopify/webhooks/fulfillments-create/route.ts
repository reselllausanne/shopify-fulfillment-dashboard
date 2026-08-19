import { NextResponse } from "next/server";
import { verifyShopifyWebhookHmac } from "@/shopify/orders/ordersPaidConvergence";
import {
  processFulfillmentWebhook,
  type ShopifyFulfillmentWebhookPayload,
} from "@/shopify/orders/fulfillmentsWebhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  const rawBuf = Buffer.from(await req.arrayBuffer());
  const hmac = req.headers.get("x-shopify-hmac-sha256");
  const topic = req.headers.get("x-shopify-topic") ?? "";
  const shop = req.headers.get("x-shopify-shop-domain") ?? "";
  const webhookId = req.headers.get("x-shopify-webhook-id") ?? "";

  if (!verifyShopifyWebhookHmac(rawBuf, hmac)) {
    console.warn("[shopify][webhook][fulfillments] hmac mismatch", {
      topic,
      shop,
      webhookId,
      bodyBytes: rawBuf.length,
    });
    return NextResponse.json({ ok: false, error: "invalid_hmac" }, { status: 401 });
  }

  let payload: ShopifyFulfillmentWebhookPayload;
  try {
    payload = JSON.parse(rawBuf.toString("utf8"));
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  try {
    const result = await processFulfillmentWebhook(payload);
    console.info("[shopify][webhook][fulfillments] processed", {
      topic,
      shop,
      webhookId,
      shopifyOrderId: result.shopifyOrderId,
      trackingNumber: result.trackingNumber,
      email: result.email ?? null,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[shopify][webhook][fulfillments] failed", {
      topic,
      shop,
      webhookId,
      error: err?.message ?? err,
    });
    return NextResponse.json({ ok: false, error: "processing_failed" }, { status: 500 });
  }
}
