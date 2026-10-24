import { NextResponse } from "next/server";
import {
  getReturnableItemsForOrder,
  ShopifyReturnRequestError,
} from "@/shopify/returns/createAndOpenReturn";
import { quoteCustomerExchange } from "@/shopify/returns/customerNativeExchange";
import { toPublicReturnsErrorMessage } from "@/shopify/returns/publicApiErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://resell-lausanne.ch",
  "https://www.resell-lausanne.ch",
];
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 120;
const globalForRateLimit = globalThis as typeof globalThis & {
  __shopifyExchangePreviewRateLimit?: Map<string, number[]>;
};
globalForRateLimit.__shopifyExchangePreviewRateLimit ??= new Map<string, number[]>();
const rateLimitStore = globalForRateLimit.__shopifyExchangePreviewRateLimit!;

function allowedOrigins(): string[] {
  const raw = String(process.env.RETURNS_CORS_ORIGINS ?? "").trim();
  return raw
    ? raw.split(",").map((origin) => origin.trim()).filter(Boolean)
    : DEFAULT_ALLOWED_ORIGINS;
}

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Returns-Key",
    Vary: "Origin",
  };
  if (origin && allowedOrigins().includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function authorize(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins().includes(origin)) {
    throw new ShopifyReturnRequestError("FORBIDDEN_ORIGIN", "Origin is not allowed", 403);
  }
  const required = String(process.env.RETURNS_PUBLIC_API_KEY ?? "").trim();
  const supplied = String(request.headers.get("x-returns-key") ?? "").trim();
  if (required && supplied !== required) {
    throw new ShopifyReturnRequestError("UNAUTHORIZED", "Invalid returns API key", 401);
  }
}

function isRateLimited(request: Request): boolean {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown";
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  const recent = (rateLimitStore.get(ip) ?? []).filter((timestamp) => timestamp > cutoff);
  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    rateLimitStore.set(ip, recent);
    return true;
  }
  recent.push(Date.now());
  rateLimitStore.set(ip, recent);
  return false;
}

export async function OPTIONS(request: Request) {
  const origin = request.headers.get("origin");
  return new NextResponse(null, {
    status: origin && !allowedOrigins().includes(origin) ? 403 : 204,
    headers: corsHeaders(origin),
  });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin);
  try {
    authorize(request);
    if (isRateLimited(request)) {
      throw new ShopifyReturnRequestError("RATE_LIMITED", "Too many requests", 429);
    }
    const body = await request.json().catch(() => ({}));
    const requested = Array.isArray(body?.items) ? body.items : [];
    if (!requested.length) {
      throw new ShopifyReturnRequestError("VALIDATION_ERROR", "No exchange items", 400);
    }

    const returnable = await getReturnableItemsForOrder({
      orderNumber: body?.orderNumber,
      email: body?.email,
    });
    const byId = new Map(
      returnable.items.map((item) => [item.fulfillmentLineItemId, item])
    );
    const returnLines: Array<{ fulfillmentLineItemId: string; quantity: number }> = [];
    const exchangeLines: Array<{ variantId: string; quantity: number }> = [];
    for (const item of requested) {
      const fulfillmentLineItemId = String(item?.fulfillmentLineItemId ?? "").trim();
      const variantId = String(item?.replacementVariantId ?? "").trim();
      const line = byId.get(fulfillmentLineItemId);
      const quantity = Math.max(1, Math.floor(Number(item?.quantity ?? 1)));
      if (!line || !variantId || quantity > line.quantity) {
        throw new ShopifyReturnRequestError(
          "VALIDATION_ERROR",
          "Invalid exchange line",
          400
        );
      }
      returnLines.push({ fulfillmentLineItemId, quantity });
      exchangeLines.push({ variantId, quantity });
    }

    const quote = await quoteCustomerExchange({
      orderId: returnable.orderId,
      returnLines,
      exchangeLines,
    });
    return NextResponse.json({ success: true, ...quote }, { status: 200, headers });
  } catch (error: unknown) {
    if (error instanceof ShopifyReturnRequestError) {
      return NextResponse.json(
        {
          success: false,
          error: error.code,
          message: toPublicReturnsErrorMessage(error),
          details: error.details ?? null,
        },
        { status: error.status, headers }
      );
    }
    console.error("[SHOPIFY][RETURNS][EXCHANGE-PREVIEW] Unhandled error", error);
    return NextResponse.json(
      { success: false, error: "SERVER_ERROR", message: "Unexpected server error" },
      { status: 500, headers }
    );
  }
}
