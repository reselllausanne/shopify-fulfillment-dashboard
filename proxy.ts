import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

// Paths that don't require authentication
const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
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
];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1. Allow public paths
  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  // 2. Get token from cookies
  const token = req.cookies.get("auth_token")?.value;

  if (!token) {
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

    // If Logistics, check if path is allowed
    if (role === "logistics") {
      const isAllowed = LOGISTICS_ALLOWED_PATHS.some((path) => 
        pathname === path || pathname.startsWith(path + "/")
      );

      if (isAllowed) {
        return NextResponse.next();
      }

      // Logistics blocked from this path - redirect to scan
      return NextResponse.redirect(new URL("/scan", req.url));
    }

    // Unknown role - redirect to login
    return NextResponse.redirect(new URL("/login", req.url));
  } catch (error) {
    console.error("[PROXY] Auth error:", error);
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
