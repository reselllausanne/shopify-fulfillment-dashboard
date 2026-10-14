import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import {
  countryCode,
  FUNNEL_MAX_BODY_BYTES,
  parseFunnelPayload,
} from "@/app/lib/funnel/payload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public ingest for the Shopify custom pixel (docs/tracking/shopify-custom-pixel.js).
 * Custom pixels run in a sandboxed iframe without allow-same-origin, so browsers
 * send `Origin: null`; the pixel posts text/plain with `mode: "no-cors"` (simple
 * request, no preflight) and never reads the response.
 */

const DEFAULT_ALLOWED_ORIGINS = [
  "https://resell-lausanne.ch",
  "https://www.resell-lausanne.ch",
  "null",
];
const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/[a-z0-9-]+\.myshopify\.com$/i,
  /^https:\/\/([a-z0-9-]+\.)*shopify\.com$/i,
  /^https:\/\/([a-z0-9-]+\.)*shopifycdn\.com$/i,
];
const loggedRejectedOrigins = new Set<string>();

const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX_EVENTS = 500;

const globalForRateLimit = globalThis as typeof globalThis & {
  __funnelTrackRateLimit?: Map<string, number[]>;
};
if (!globalForRateLimit.__funnelTrackRateLimit) {
  globalForRateLimit.__funnelTrackRateLimit = new Map<string, number[]>();
}
const rateLimitStore = globalForRateLimit.__funnelTrackRateLimit;

function resolveAllowedOrigins(): string[] {
  const raw = String(process.env.FUNNEL_TRACK_ORIGINS ?? "").trim();
  if (!raw) return DEFAULT_ALLOWED_ORIGINS;
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return true;
  if (resolveAllowedOrigins().includes(origin)) return true;
  return ALLOWED_ORIGIN_PATTERNS.some((re) => re.test(origin));
}

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (origin && isOriginAllowed(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function getRequestIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function consumeRateLimit(ip: string, count: number): boolean {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const recent = (rateLimitStore.get(ip) ?? []).filter((ts) => ts > cutoff);
  if (recent.length + count > RATE_LIMIT_MAX_EVENTS) {
    rateLimitStore.set(ip, recent);
    return false;
  }
  for (let i = 0; i < count; i++) recent.push(now);
  rateLimitStore.set(ip, recent);
  if (rateLimitStore.size > 20_000) {
    for (const [k, v] of rateLimitStore) {
      if (!v.length || v[v.length - 1] <= cutoff) rateLimitStore.delete(k);
    }
  }
  return true;
}

function keyMatches(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function reply(status: number, origin: string | null, body?: Record<string, unknown>) {
  const headers = corsHeaders(origin);
  if (!body) return new NextResponse(null, { status, headers });
  return NextResponse.json(body, { status, headers });
}

export async function OPTIONS(request: Request) {
  const origin = request.headers.get("origin");
  return reply(isOriginAllowed(origin) ? 204 : 403, origin);
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!isOriginAllowed(origin)) {
    if (origin && loggedRejectedOrigins.size < 50 && !loggedRejectedOrigins.has(origin)) {
      loggedRejectedOrigins.add(origin);
      console.warn("[TRACK_FUNNEL] rejected origin:", origin);
    }
    return reply(403, origin, { ok: false, error: "forbidden_origin" });
  }

  const expectedKey = String(process.env.FUNNEL_TRACK_KEY ?? "").trim();
  if (!expectedKey) {
    return reply(503, origin, { ok: false, error: "tracking_disabled" });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > FUNNEL_MAX_BODY_BYTES) {
    return reply(413, origin, { ok: false, error: "body_too_large" });
  }

  const body = await request.text();
  const parsed = parseFunnelPayload(body);
  if (!parsed.ok) {
    return reply(400, origin, { ok: false, error: parsed.error });
  }
  if (!keyMatches(parsed.key, expectedKey)) {
    return reply(401, origin, { ok: false, error: "invalid_key" });
  }
  if (parsed.events.length === 0) {
    return reply(400, origin, { ok: false, error: "no_valid_events" });
  }
  if (!consumeRateLimit(getRequestIp(request), parsed.events.length)) {
    return reply(429, origin, { ok: false, error: "rate_limited" });
  }

  const geoCountry = countryCode(request.headers.get("cf-ipcountry"));

  try {
    await prisma.funnelEvent.createMany({
      data: parsed.events.map((e) => ({ ...e, geoCountry, props: e.props ?? undefined })),
      skipDuplicates: true,
    });
  } catch (error) {
    console.error("[TRACK_FUNNEL] insert failed:", error);
    return reply(500, origin, { ok: false, error: "insert_failed" });
  }

  return reply(204, origin);
}
