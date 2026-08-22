import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { extractOrdersArray, normalizeGoatOrder, type NormalizedGoatOrder } from "@/app/lib/goat/normalize";
import { POST as goatPlaywright } from "@/app/api/goat/playwright/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

async function hasGoatSession(): Promise<boolean> {
  const sessionFile = path.join(process.cwd(), ".data", "goat-session.json");
  const profileDir = path.join(process.cwd(), ".data", "goat-profile");
  try {
    await fs.access(sessionFile);
    return true;
  } catch {
    // continue
  }
  try {
    const entries = await fs.readdir(profileDir);
    return entries.length > 0;
  } catch {
    return false;
  }
}

async function fetchGoatOrdersViaPlaywright(): Promise<NextResponse | null> {
  if (!(await hasGoatSession())) return null;
  try {
    const request = new NextRequest("http://internal/api/goat/playwright", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        headless: true,
        persistent: true,
        browser: "chromium",
        maxWaitMs: 90000,
        includeRaw: false,
        forceLogin: false,
      }),
    });
    const response = await goatPlaywright(request);
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json?.ok === false) return null;
    const orders = Array.isArray(json?.orders) ? json.orders : [];
    return NextResponse.json({
      ok: true,
      page: 1,
      count: orders.length,
      orders,
      viaPlaywright: true,
    });
  } catch (error: any) {
    console.warn("[GOAT] Playwright fallback failed:", error?.message || error);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body?.token || "").trim();
    let cookie = String(body?.cookie || token || "").trim();
    const csrfToken = String(body?.csrfToken || "").trim();

    if (cookie.startsWith("{")) {
      try {
        const parsed = JSON.parse(cookie);
        if (Array.isArray(parsed?.cookies)) {
          cookie = parsed.cookies
            .map((c: { name: string; value: string }) => `${c.name}=${c.value}`)
            .join("; ");
        }
      } catch {
        // not JSON, use as-is
      }
    }
    const page = Math.max(1, Number(body?.page || 1));

    if (!cookie) {
      const fallback = await fetchGoatOrdersViaPlaywright();
      if (fallback) return fallback;
      return NextResponse.json({ ok: true, page: 1, count: 0, orders: [], viaPlaywright: true });
    }

    const headers: Record<string, string> = {
      accept: "application/json",
      "accept-language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
      "cache-control": "no-cache",
      pragma: "no-cache",
      origin: "https://www.goat.com",
      referer: "https://www.goat.com/fr-fr/account/orders",
      "user-agent":
        "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "x-requested-with": "XMLHttpRequest",
    };

    const safeCookie = cookie.replace(/[^\x00-\xFF]/g, "");
    if (safeCookie.toLowerCase().startsWith("bearer ")) {
      headers.authorization = safeCookie;
    } else {
      headers.cookie = safeCookie;
    }
    if (csrfToken) {
      headers["x-csrf-token"] = csrfToken;
    }

    const url = `https://www.goat.com/web-api/v1/orders?filter=buy&page=${page}`;
    console.log("[GOAT] Requesting orders", {
      page,
      hasCookie: Boolean(cookie),
      cookieLength: cookie.length,
      hasCsrfToken: Boolean(csrfToken),
      csrfLength: csrfToken.length,
    });
    const response = await fetch(url, {
      method: "GET",
      headers,
    });

    const rawText = await response.text();
    const contentType = response.headers.get("content-type") || "";
    console.log("[GOAT] Response meta", {
      page,
      status: response.status,
      contentType,
      rawHead: rawText.slice(0, 180),
    });
    let json: unknown = null;
    try {
      json = rawText ? JSON.parse(rawText) : null;
    } catch {
      const blocked = /access denied|cf-error|cloudflare/i.test(rawText);
      if (blocked || page === 1) {
        const fallback = await fetchGoatOrdersViaPlaywright();
        if (fallback) return fallback;
      }
      return NextResponse.json(
        {
          error: blocked ? "GOAT blocked request (WAF / Access denied)" : "Invalid JSON response from GOAT",
          status: response.status,
          contentType,
          details: rawText.slice(0, 300),
        },
        { status: 502 }
      );
    }

    if (!response.ok) {
      if (page === 1) {
        const fallback = await fetchGoatOrdersViaPlaywright();
        if (fallback) return fallback;
      }
      return NextResponse.json(
        {
          error: `GOAT request failed with status ${response.status}`,
          data: json,
        },
        { status: response.status }
      );
    }

    const rawOrders = extractOrdersArray(json);
    const normalizedOrders = rawOrders
      .map((raw) => normalizeGoatOrder(raw))
      .filter((order): order is NormalizedGoatOrder => Boolean(order));

    return NextResponse.json({
      ok: true,
      page,
      count: normalizedOrders.length,
      orders: normalizedOrders,
    });
  } catch (error: any) {
    console.error("[GOAT] Failed to fetch orders:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch GOAT orders",
        details: error?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}

