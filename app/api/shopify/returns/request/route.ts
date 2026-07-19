import { NextResponse } from "next/server";
import {
  ShopifyReturnRequestError,
  createAndOpenReturnFromFormData,
} from "@/shopify/returns/createAndOpenReturn";
import { toPublicReturnsErrorMessage } from "@/shopify/returns/publicApiErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://resell-lausanne.ch",
  "https://www.resell-lausanne.ch",
];
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 10;

const globalForRateLimit = globalThis as typeof globalThis & {
  __shopifyReturnsRateLimit?: Map<string, number[]>;
};
if (!globalForRateLimit.__shopifyReturnsRateLimit) {
  globalForRateLimit.__shopifyReturnsRateLimit = new Map<string, number[]>();
}
const rateLimitStore = globalForRateLimit.__shopifyReturnsRateLimit;

function resolveAllowedOrigins(): string[] {
  const raw = String(process.env.RETURNS_CORS_ORIGINS ?? "").trim();
  if (!raw) return DEFAULT_ALLOWED_ORIGINS;
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getRequestIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get("x-real-ip")?.trim();
  return real || "unknown";
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const existing = rateLimitStore.get(ip) ?? [];
  const recent = existing.filter((ts) => ts > cutoff);
  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    rateLimitStore.set(ip, recent);
    return true;
  }
  recent.push(now);
  rateLimitStore.set(ip, recent);
  return false;
}

function buildCorsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Returns-Key",
    Vary: "Origin",
  };

  if (!origin) return headers;
  const allowed = resolveAllowedOrigins();
  if (allowed.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function ensureOriginAllowed(origin: string | null) {
  if (!origin) return;
  const allowed = resolveAllowedOrigins();
  if (!allowed.includes(origin)) {
    throw new ShopifyReturnRequestError(
      "FORBIDDEN_ORIGIN",
      "Origin is not allowed",
      403
    );
  }
}

function ensurePublicApiKey(request: Request) {
  const required = String(process.env.RETURNS_PUBLIC_API_KEY ?? "").trim();
  if (!required) return;
  const provided = String(request.headers.get("x-returns-key") ?? "").trim();
  if (!provided || provided !== required) {
    throw new ShopifyReturnRequestError(
      "UNAUTHORIZED",
      "Missing or invalid returns API key",
      401
    );
  }
}

export async function OPTIONS(request: Request) {
  const origin = request.headers.get("origin");
  const headers = buildCorsHeaders(origin);
  try {
    ensureOriginAllowed(origin);
  } catch {
    return new NextResponse(null, { status: 403, headers });
  }
  return new NextResponse(null, { status: 204, headers });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const headers = buildCorsHeaders(origin);
  const ip = getRequestIp(request);

  try {
    ensureOriginAllowed(origin);
    ensurePublicApiKey(request);

    if (isRateLimited(ip)) {
      return NextResponse.json(
        {
          success: false,
          error: "RATE_LIMITED",
          message: "Too many return requests, try again later.",
        },
        { status: 429, headers }
      );
    }

    const body = await request.json().catch(() => ({}));
    const reqUrl = new URL(request.url);
    const publicBaseUrl =
      String(process.env.RETURNS_PUBLIC_BASE_URL || "").trim() ||
      origin ||
      `${reqUrl.protocol}//${reqUrl.host}`;
    const result = await createAndOpenReturnFromFormData({
      orderNumber: body?.orderNumber,
      email: body?.email,
      customerProvidedEmail: body?.customerProvidedEmail,
      reason: body?.reason,
      details: body?.details,
      items: Array.isArray(body?.items) ? body.items : undefined,
    }, { publicBaseUrl });

    return NextResponse.json(result, { status: 200, headers });
  } catch (error: any) {
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
    console.error("[SHOPIFY][RETURNS][REQUEST] Unhandled error", error);
    return NextResponse.json(
      {
        success: false,
        error: "SERVER_ERROR",
        message: error?.message ?? "Unexpected server error",
      },
      { status: 500, headers }
    );
  }
}
