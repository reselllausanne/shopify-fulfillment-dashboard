import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/app/lib/prisma";
import { convergeVariant } from "@/shopify/inventory/convergence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Phase 4.4 — Shopify order webhook trigger.
 *
 * Shopify decrements physical stock itself when a web sale fulfills. We only
 * need to converge state (unlock liquidation + relist STX) the moment physical
 * hits 0 for a GTIN. Runs `convergeVariant(gtin)` for each unique GTIN on the
 * order. Idempotent — safe on webhook redeliveries.
 *
 * Webhook topic: orders/paid
 * Verify: HMAC-SHA256(body, SHOPIFY_API_SECRET) base64 == X-Shopify-Hmac-Sha256
 */

function timingSafeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

async function verifyHmac(rawBody: string, hmacHeader: string | null): Promise<boolean> {
  const secret = process.env.SHOPIFY_API_SECRET ?? "";
  if (!secret || !hmacHeader) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  return timingSafeEq(expected, hmacHeader);
}

type OrderPaidLineItem = {
  id?: number | string;
  variant_id?: number | string | null;
  sku?: string | null;
  quantity?: number | null;
};

type OrderPaidPayload = {
  id?: number | string;
  admin_graphql_api_id?: string;
  line_items?: OrderPaidLineItem[];
};

function toVariantGid(idish: number | string | null | undefined): string | null {
  if (idish == null) return null;
  const s = String(idish).trim();
  if (!s) return null;
  if (s.startsWith("gid://")) return s;
  return `gid://shopify/ProductVariant/${s}`;
}

/** Resolve GTINs for the order's line items via mirror + SupplierVariant fallback. */
async function resolveGtinsForLineItems(items: OrderPaidLineItem[]): Promise<string[]> {
  const variantGids = new Set<string>();
  const skus = new Set<string>();
  for (const it of items) {
    const gid = toVariantGid(it.variant_id ?? null);
    if (gid) variantGids.add(gid);
    const sku = String(it.sku ?? "").trim();
    if (sku) skus.add(sku);
  }

  const out = new Set<string>();

  if (variantGids.size > 0) {
    const rows = await prisma.$queryRaw<Array<{ gtin: string | null }>>`
      SELECT DISTINCT "gtin"
      FROM "public"."ShopifyVariantLocationStock"
      WHERE "shopifyVariantId" = ANY(${Array.from(variantGids)}::text[])
        AND "gtin" IS NOT NULL
    `;
    for (const r of rows) if (r.gtin) out.add(r.gtin);
  }

  if (skus.size > 0) {
    const rows = await prisma.$queryRaw<Array<{ gtin: string | null }>>`
      SELECT DISTINCT "gtin"
      FROM "public"."ShopifyVariantLocationStock"
      WHERE "sku" = ANY(${Array.from(skus)}::text[])
        AND "gtin" IS NOT NULL
    `;
    for (const r of rows) if (r.gtin) out.add(r.gtin);
  }

  // Fallback: SupplierVariant SKU→GTIN mapping (covers variants never mirrored).
  if (out.size === 0 && skus.size > 0) {
    const rows = await prisma.$queryRaw<Array<{ gtin: string | null }>>`
      SELECT DISTINCT sv."gtin"
      FROM "public"."SupplierVariant" sv
      WHERE sv."sku" = ANY(${Array.from(skus)}::text[])
        AND sv."gtin" IS NOT NULL
    `;
    for (const r of rows) if (r.gtin) out.add(r.gtin);
  }

  return Array.from(out);
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256");
  const topic = req.headers.get("x-shopify-topic") ?? "";
  const shop = req.headers.get("x-shopify-shop-domain") ?? "";
  const webhookId = req.headers.get("x-shopify-webhook-id") ?? "";

  const verified = await verifyHmac(rawBody, hmac);
  if (!verified) {
    console.warn("[shopify][webhook][orders-paid] hmac mismatch", { topic, shop, webhookId });
    return NextResponse.json({ ok: false, error: "invalid_hmac" }, { status: 401 });
  }

  let payload: OrderPaidPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const items = Array.isArray(payload.line_items) ? payload.line_items : [];
  const orderId = String(payload.admin_graphql_api_id ?? payload.id ?? "");

  let gtins: string[] = [];
  try {
    gtins = await resolveGtinsForLineItems(items);
  } catch (err: any) {
    console.error("[shopify][webhook][orders-paid] gtin resolve failed", {
      orderId,
      error: err?.message ?? err,
    });
  }

  const results: Array<{ gtin: string; changed: boolean; changes: string[]; error?: string }> = [];
  for (const gtin of gtins) {
    try {
      const res = await convergeVariant(gtin);
      results.push({
        gtin,
        changed: res.changed,
        changes: res.changes,
        error: res.error,
      });
    } catch (err: any) {
      results.push({
        gtin,
        changed: false,
        changes: [],
        error: err?.message ?? String(err),
      });
    }
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
    verify: "HMAC-SHA256(body, SHOPIFY_API_SECRET) base64 == X-Shopify-Hmac-Sha256",
  });
}
