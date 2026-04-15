import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * Staff gate often lands users on `/login?callbackUrl=/partners/...`.
 * Redirect at the edge of Next so the browser URL is `/partners/login` (302), not a client-only replace.
 */
function decodeCallbackPath(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  if (pathname !== "/login") {
    return NextResponse.next();
  }

  const path = decodeCallbackPath(searchParams.get("callbackUrl"));
  if (!path || !path.startsWith("/") || path.startsWith("//") || !path.startsWith("/partners")) {
    return NextResponse.next();
  }

  const dest = new URL("/partners/login", request.nextUrl.origin);
  if (path !== "/partners/login") {
    dest.searchParams.set("callbackUrl", path);
  }
  return NextResponse.redirect(dest, 307);
}

export const config = {
  matcher: ["/login"],
};
