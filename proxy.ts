import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

function decodeCallbackPath(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function isPartnerPortalPath(pathname: string) {
  return pathname === "/partners" || pathname.startsWith("/partners/");
}

function isPartnerApiPath(pathname: string) {
  return pathname.startsWith("/api/partners/");
}

function isPartnerDecathlonApiRequest(pathname: string, searchParams: URLSearchParams) {
  if (!pathname.startsWith("/api/decathlon/")) return false;
  return String(searchParams.get("scope") ?? "").trim().toLowerCase() === "partner";
}

function isShopifyInstallRequest(pathname: string, searchParams: URLSearchParams): boolean {
  if (pathname !== "/") return false;
  const shop = String(searchParams.get("shop") ?? "").trim();
  if (!shop) return false;
  return searchParams.has("hmac") || searchParams.has("host") || searchParams.has("timestamp");
}

// Paths that don't require authentication
const PUBLIC_PATHS = [
  "/login",
  "/auth",
  "/api/auth",
  "/api/auth/login",
  "/api/galaxus",
  "/api/galaxus/ops",
  "/api/galaxus/feeds",
  "/api/galaxus/export",
  "/api/tracking/token",
  "/_next",
  "/static",
  "/favicon.ico",
  "/logo.png",
  "/track", // Public tracking links for customers
];

// Paths that the logistics team CAN access
const LOGISTICS_ALLOWED_PATHS = [
  "/scan",
  "/api/scan-awb",
  "/api/fulfill-from-awb",
  "/api/swiss-post/label-from-awb",
  "/api/shopify/order-by-name", // Used by scanner search
  "/api/notifications/goat-tracking",
];

export async function proxy(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;
  const isApiPath = pathname.startsWith("/api/");
  const token = req.cookies.get("auth_token")?.value;

  // Staff login URL with partner callback → partner login (no auth_token needed)
  if (pathname === "/login" || pathname === "/login/") {
    const cb = decodeCallbackPath(searchParams.get("callbackUrl"));
    if (cb && cb.startsWith("/") && !cb.startsWith("//") && cb.startsWith("/partners")) {
      const dest = new URL("/partners/login", req.url);
      if (cb !== "/partners/login") {
        dest.searchParams.set("callbackUrl", cb);
      }
      return NextResponse.redirect(dest, 302);
    }
  }

  // Shopify install often lands on "/" first (App URL). Bounce unauthenticated traffic to /auth.
  if (!token && isShopifyInstallRequest(pathname, searchParams)) {
    const authUrl = new URL("/auth", req.url);
    const shop = String(searchParams.get("shop") ?? "").trim();
    if (shop) {
      authUrl.searchParams.set("shop", shop);
    }
    return NextResponse.redirect(authUrl, 302);
  }

  // 1. Allow public paths (includes full partner portal + partner APIs)
  if (
    isPartnerPortalPath(pathname) ||
    isPartnerApiPath(pathname) ||
    isPartnerDecathlonApiRequest(pathname, searchParams) ||
    PUBLIC_PATHS.some((path) => pathname.startsWith(path))
  ) {
    return NextResponse.next();
  }

  if (!token) {
    if (isApiPath) {
      return NextResponse.json(
        {
          ok: false,
          error: "Unauthorized",
          details: "Missing auth_token cookie. Login required.",
        },
        { status: 401 }
      );
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  try {
    // 3. Verify JWT
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      console.error("[PROXY] Missing JWT_SECRET");
      return NextResponse.next(); // Fail open in case of config error to prevent lockout
    }

    const secret = new TextEncoder().encode(jwtSecret);
    const { payload } = await jwtVerify(token, secret);
    const role = payload.role as string;

    // 4. Role-Based Access Control
    
    // If Admin, allow everything
    if (role === "admin") {
      return NextResponse.next();
    }

    // Logistics is staff (not partner) → allow normal staff routes.
    if (role === "logistics") {
      return NextResponse.next();
    }

    if (isApiPath) {
      return NextResponse.json(
        { ok: false, error: "Forbidden", details: "Unknown or unauthorized role." },
        { status: 403 }
      );
    }

    // Unknown role - redirect to login
    return NextResponse.redirect(new URL("/login", req.url));
  } catch (error) {
    console.error("[PROXY] Auth error:", error);
    if (isApiPath) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized", details: "Invalid or expired auth_token." },
        { status: 401 }
      );
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api/auth/login (handled in PUBLIC_PATHS)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
