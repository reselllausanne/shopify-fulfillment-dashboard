import { NextResponse } from "next/server";
import { verifyShopifyWebhookHmac } from "@/shopify/orders/ordersPaidConvergence";
import {
  processProductsUpdatePayload,
  type ProductsUpdatePayload,
} from "@/shopify/inventory/expressRepriceSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Reprice trigger — Shopify products/update webhook.
 *
 * On any variant price change we recompute the two express metafields per
 * variant (custom.express_available from physical stock, custom.express_price
 * floor >= current price). Idempotent: writes only diffs, so a webhook fired by
 * our own metafield write is a no-op (no loop).
 *
 * Webhook topic: products/update
 * Verify: HMAC-SHA256(raw body, SHOPIFY_API_SECRET) base64 == X-Shopify-Hmac-Sha256
 */
export async function POST(req: Request) {
  const rawBuf = Buffer.from(await req.arrayBuffer());
  const hmac = req.headers.get("x-shopify-hmac-sha256");
  const topic = req.headers.get("x-shopify-topic") ?? "";
  const shop = req.headers.get("x-shopify-shop-domain") ?? "";
  const webhookId = req.headers.get("x-shopify-webhook-id") ?? "";

  if (!verifyShopifyWebhookHmac(rawBuf, hmac)) {
    console.warn("[shopify][webhook][products-update] hmac mismatch", {
      topic,
      shop,
      webhookId,
      bodyBytes: rawBuf.length,
    });
    return NextResponse.json({ ok: false, error: "invalid_hmac" }, { status: 401 });
  }

  let payload: ProductsUpdatePayload;
  try {
    payload = JSON.parse(rawBuf.toString("utf8"));
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  try {
    const result = await processProductsUpdatePayload(payload);
    if (result.changed.length > 0 || result.warnings.length > 0) {
      console.info("[shopify][webhook][products-update] express synced", {
        topic,
        shop,
        webhookId,
        productId: result.productId,
        variantsScanned: result.variantsScanned,
        changed: result.changed,
        warnings: result.warnings,
      });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    console.error("[shopify][webhook][products-update] failed", {
      topic,
      shop,
      webhookId,
      error: err?.message ?? err,
    });
    return NextResponse.json({ ok: false, error: "processing_failed" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "POST /api/shopify/webhooks/products-update",
    verify: "HMAC-SHA256(raw body, SHOPIFY_API_SECRET) base64 == X-Shopify-Hmac-Sha256",
    metafields: ["custom.express_available (boolean)", "custom.express_price (money)"],
  });
}
