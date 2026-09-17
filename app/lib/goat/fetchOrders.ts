import {
  extractOrdersArray,
  normalizeGoatOrder,
  type NormalizedGoatOrder,
} from "@/app/lib/goat/normalize";
import { loadGoatCookie, saveGoatCookie } from "@/app/lib/goat/cookieStore";

export type GoatFetchResult = {
  ok: boolean;
  orders: NormalizedGoatOrder[];
  pageCount: number;
  error?: string;
  status?: number;
};

function buildHeaders(cookie: string, csrfToken?: string | null): Record<string, string> {
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
  if (csrfToken) headers["x-csrf-token"] = csrfToken;
  return headers;
}

async function fetchGoatPage(
  cookie: string,
  csrfToken: string | null,
  page: number
): Promise<{ status: number; json: unknown; blocked: boolean; rawHead: string }> {
  const url = `https://www.goat.com/web-api/v1/orders?filter=buy&page=${page}`;
  const response = await fetch(url, {
    method: "GET",
    headers: buildHeaders(cookie, csrfToken),
  });
  const rawText = await response.text();
  const blocked = /access denied|cf-error|cloudflare/i.test(rawText);
  let json: unknown = null;
  try {
    json = rawText ? JSON.parse(rawText) : null;
  } catch {
    json = null;
  }
  return { status: response.status, json, blocked, rawHead: rawText.slice(0, 180) };
}

/** Cookie-only GOAT buy list. No Playwright. */
export async function fetchGoatBuyOrders(options?: {
  cookie?: string | null;
  csrfToken?: string | null;
  persist?: boolean;
  maxPages?: number;
}): Promise<GoatFetchResult> {
  let cookie = String(options?.cookie ?? "").trim();
  let csrfToken = String(options?.csrfToken ?? "").trim() || null;
  if (!cookie) {
    const stored = await loadGoatCookie();
    cookie = stored?.cookie ?? "";
    csrfToken = csrfToken || stored?.csrfToken || null;
  }
  if (!cookie) {
    return { ok: false, orders: [], pageCount: 0, error: "no_goat_cookie" };
  }

  if (options?.persist !== false && options?.cookie) {
    await saveGoatCookie(cookie, csrfToken).catch(() => undefined);
  }

  const maxPages = Math.max(1, options?.maxPages ?? 8);
  const all: NormalizedGoatOrder[] = [];
  let pageCount = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    const res = await fetchGoatPage(cookie, csrfToken, page);
    pageCount += 1;
    if (res.blocked || res.status === 401 || res.status === 403) {
      return {
        ok: false,
        orders: all,
        pageCount,
        error: res.blocked ? "goat_waf_blocked" : "goat_auth_failed",
        status: res.status,
      };
    }
    if (!res.json || res.status >= 400) {
      if (page === 1) {
        return {
          ok: false,
          orders: [],
          pageCount,
          error: "goat_http_error",
          status: res.status,
        };
      }
      break;
    }
    const rawOrders = extractOrdersArray(res.json);
    const normalized = rawOrders
      .map((raw) => normalizeGoatOrder(raw))
      .filter((order): order is NormalizedGoatOrder => Boolean(order));
    if (normalized.length === 0) break;
    all.push(...normalized);
    if (normalized.length < 10) break;
  }

  return { ok: true, orders: all, pageCount };
}
