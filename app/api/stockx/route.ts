import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import {
  STOCKX_PERSISTED_OPERATION_NAME,
  STOCKX_PERSISTED_QUERY_HASH,
} from "@/app/lib/constants";

const STOCKX_GATEWAY_GRAPHQL_URL = "https://gateway.stockx.com/api/graphql";
const STOCKX_WEB_GRAPHQL_URL = "https://stockx.com/api/graphql";
const STOCKX_PRO_GRAPHQL_URL = "https://pro.stockx.com/api/graphql";
const DEFAULT_SESSION_FILE = path.join(process.cwd(), ".data", "stockx-session.json");
const DEFAULT_SESSION_META_FILE = path.join(process.cwd(), ".data", "stockx-session-meta.json");
const CHROME_147_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

type StockxSessionMeta = {
  sessionFile?: string;
  userDataDir?: string;
  browserType?: string;
  persistent?: boolean;
  deviceId?: string | null;
  sessionId?: string | null;
  cookieHeader?: string | null;
  lastUrl?: string | null;
};

async function readStockxSessionMeta(): Promise<StockxSessionMeta | null> {
  try {
    const raw = await fs.readFile(DEFAULT_SESSION_META_FILE, "utf8");
    const parsed = JSON.parse(raw) as StockxSessionMeta;
    return parsed || null;
  } catch {
    return null;
  }
}

function readCookieValue(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader || !name) return null;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    if (key !== name) continue;
    const value = trimmed.slice(eqIndex + 1).trim();
    return value || null;
  }
  return null;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payloadPart = String(token || "").split(".")[1] || "";
    if (!payloadPart) return null;
    const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const json = Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isExpiredJwtToken(token: string, skewSeconds = 45): boolean {
  const cleaned = String(token || "").trim().replace(/^bearer\s+/i, "");
  const looksLikeJwt = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(cleaned);
  if (!looksLikeJwt) return false;
  const payload = decodeJwtPayload(cleaned);
  const exp = typeof payload?.exp === "number" ? payload.exp : null;
  if (!exp) return false;
  const now = Math.floor(Date.now() / 1000);
  return exp <= now + skewSeconds;
}

function resolveReferer(
  operationName: string,
  variables: Record<string, unknown>,
  session: StockxSessionMeta | null,
  upstreamOrigin: string
): string {
  const op = String(operationName || "").trim();
  const chainId = typeof variables?.chainId === "string" ? variables.chainId.trim() : "";

  // Pin operation-specific referers first; do not let a stale session URL override these.
  if (op === "getBuyOrder" && chainId) {
    return `${upstreamOrigin}/buying/${chainId}?listingType=STANDARD`;
  }
  if (op === STOCKX_PERSISTED_OPERATION_NAME || op === "FetchCurrentBids") {
    return `${upstreamOrigin}/buying/orders`;
  }
  if (chainId) {
    return `${upstreamOrigin}/buying/${chainId}`;
  }

  if (
    typeof session?.lastUrl === "string" &&
    session.lastUrl.startsWith(`${upstreamOrigin}/`) &&
    session.lastUrl.includes("/buying/")
  ) {
    return session.lastUrl;
  }
  return `${upstreamOrigin}/buying/orders`;
}

function normalizeOperationHeaderName(operationName: string): string {
  return operationName;
}

function resolveUpstreamTarget(operationName: string): { url: string; origin: string } {
  const op = String(operationName || "").trim();
  if (op === "Buying") {
    return {
      url: STOCKX_PRO_GRAPHQL_URL,
      origin: "https://pro.stockx.com",
    };
  }
  if (op === STOCKX_PERSISTED_OPERATION_NAME) {
    return {
      url: STOCKX_GATEWAY_GRAPHQL_URL,
      origin: "https://stockx.com",
    };
  }
  return {
    url: STOCKX_WEB_GRAPHQL_URL,
    origin: "https://stockx.com",
  };
}

function stockxGraphqlHeaders(
  token: string,
  operationName: string,
  variables: Record<string, unknown>,
  session: StockxSessionMeta | null,
  upstreamOrigin: string,
  options?: { includeCookie?: boolean }
): Record<string, string> {
  const referer = resolveReferer(operationName, variables, session, upstreamOrigin);
  const headerOpName = normalizeOperationHeaderName(operationName);
  const headers: Record<string, string> = {
    accept: "application/json",
    "accept-language": "en-US",
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
    origin: upstreamOrigin,
    referer,
    priority: "u=1, i",
    "apollographql-client-name": "Iron",
    "apollographql-client-version": "2026.04.19.00",
    "app-platform": "Iron",
    "app-version": "2026.04.19.00",
    "selected-country": "CH",
    "x-operation-name": headerOpName,
    "sec-ch-prefers-color-scheme": "light",
    "sec-ch-ua": '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent": CHROME_147_UA,
  };
  if (
    options?.includeCookie !== false &&
    typeof session?.cookieHeader === "string" &&
    session.cookieHeader.trim()
  ) {
    headers.cookie = session.cookieHeader.trim();
  }
  const sessionDeviceId =
    typeof session?.deviceId === "string" && session.deviceId.trim()
      ? session.deviceId.trim()
      : "";
  const sessionId =
    typeof session?.sessionId === "string" && session.sessionId.trim()
      ? session.sessionId.trim()
      : "";
  if (sessionDeviceId) headers["x-stockx-device-id"] = sessionDeviceId;
  if (sessionId) headers["x-stockx-session-id"] = sessionId;
  if (!headers.cookie && token) {
    const cookieParts = [`token=${token}`];
    if (sessionDeviceId) cookieParts.push(`stockx_device_id=${sessionDeviceId}`);
    if (sessionId) cookieParts.push(`stockx_session_id=${sessionId}`);
    headers.cookie = cookieParts.join("; ");
  }
  return headers;
}

function applyUpstreamDebugHeaders(
  response: NextResponse,
  upstreamOrigin: string,
  upstreamUrl: string,
  referer: string,
  operationHeaderName: string,
  upstreamHeaders?: Record<string, string>,
  authSource: "cookie" | "input" = "input"
): NextResponse {
  response.headers.set("x-stockx-upstream-origin", upstreamOrigin);
  response.headers.set("x-stockx-upstream-url", upstreamUrl);
  response.headers.set("x-stockx-upstream-referer", referer);
  response.headers.set("x-stockx-upstream-operation", operationHeaderName);
  response.headers.set("x-stockx-upstream-auth-source", authSource);
  response.headers.set(
    "x-stockx-upstream-has-cookie",
    upstreamHeaders?.cookie && upstreamHeaders.cookie.trim() ? "1" : "0"
  );
  response.headers.set(
    "x-stockx-upstream-has-device-id",
    upstreamHeaders?.["x-stockx-device-id"] ? "1" : "0"
  );
  response.headers.set(
    "x-stockx-upstream-has-session-id",
    upstreamHeaders?.["x-stockx-session-id"] ? "1" : "0"
  );
  response.headers.set(
    "x-stockx-upstream-has-cf-clearance",
    upstreamHeaders?.cookie?.includes("cf_clearance=") ? "1" : "0"
  );
  return response;
}

async function tryPlaywrightFallback(args: {
  token: string;
  operationName: string;
  payload: Record<string, unknown>;
  session: StockxSessionMeta | null;
  upstreamUrl: string;
  upstreamOrigin: string;
}): Promise<{ status: number; text: string } | null> {
  const sessionFile =
    typeof args.session?.sessionFile === "string" && args.session.sessionFile.trim()
      ? args.session.sessionFile.trim()
      : DEFAULT_SESSION_FILE;
  try {
    await fs.access(sessionFile);
  } catch {
    return null;
  }

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    storageState: sessionFile,
    userAgent: CHROME_147_UA,
    locale: "en-US",
  });
  const page = await context.newPage();
  try {
    const vars =
      args.payload && typeof args.payload.variables === "object" && args.payload.variables != null
        ? (args.payload.variables as Record<string, unknown>)
        : {};
    const referer = resolveReferer(args.operationName, vars, args.session, args.upstreamOrigin);
    const warmupUrl =
      typeof referer === "string" && referer.startsWith(`${args.upstreamOrigin}/`)
        ? referer
        : `${args.upstreamOrigin}/buying/orders`;

    await page.goto(warmupUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    }).catch(async () => {
      if (warmupUrl !== `${args.upstreamOrigin}/buying/orders`) {
        await page.goto(`${args.upstreamOrigin}/buying/orders`, {
          waitUntil: "domcontentloaded",
          timeout: 45000,
        });
      }
    });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(800);

    const headerOpName = normalizeOperationHeaderName(args.operationName);

    const result = await page.evaluate(
      async (input: {
        url: string;
        token: string;
        operationName: string;
        operationHeaderName: string;
        referer: string;
        payload: Record<string, unknown>;
        deviceId: string | null;
        sessionId: string | null;
      }) => {
        const headers: Record<string, string> = {
          accept: "application/json",
          "accept-language": "en-US",
          "content-type": "application/json",
          authorization: `Bearer ${input.token}`,
          "apollographql-client-name": "Iron",
          "apollographql-client-version": "2026.04.19.00",
          "app-platform": "Iron",
          "app-version": "2026.04.19.00",
          "selected-country": "CH",
          "x-operation-name": input.operationHeaderName,
        };
        if (input.deviceId) headers["x-stockx-device-id"] = input.deviceId;
        if (input.sessionId) headers["x-stockx-session-id"] = input.sessionId;
        const res = await fetch(input.url, {
          method: "POST",
          credentials: "include",
          referrer: input.referer,
          referrerPolicy: "strict-origin-when-cross-origin",
          headers,
          body: JSON.stringify(input.payload),
        });
        const text = await res.text();
        return { status: res.status, text };
      },
      {
        url: args.upstreamUrl,
        token: args.token,
        operationName: args.operationName,
        operationHeaderName: headerOpName,
        referer,
        payload: args.payload,
        deviceId:
          typeof args.session?.deviceId === "string" && args.session.deviceId.trim()
            ? args.session.deviceId.trim()
            : null,
        sessionId:
          typeof args.session?.sessionId === "string" && args.session.sessionId.trim()
            ? args.session.sessionId.trim()
            : null,
      }
    );
    return result;
  } finally {
    await page.close().catch(() => undefined);
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      token,
      operationName,
      query,
      variables,
      extensions,
      persistedQueryHash,
    } = body as Record<string, unknown>;
    const debug = process.env.STOCKX_DEBUG === "1";
    const opName = String(operationName || "").trim() || "Buying";
    const inputToken = typeof token === "string" ? token.trim() : "";
    const session = await readStockxSessionMeta();
    const cookieToken = readCookieValue(session?.cookieHeader, "token")?.trim() || "";
    const inputBearer = inputToken.replace(/^bearer\s+/i, "");
    const authCandidates: Array<{
      source: "input" | "cookie";
      token: string;
      includeCookie: boolean;
    }> = [];
    const seenTokens = new Set<string>();
    const pushAuthCandidate = (
      source: "input" | "cookie",
      candidate: string,
      includeCookie: boolean
    ) => {
      const cleaned = String(candidate || "").trim();
      if (!cleaned) return;
      if (isExpiredJwtToken(cleaned)) return;
      if (seenTokens.has(cleaned)) return;
      seenTokens.add(cleaned);
      authCandidates.push({ source, token: cleaned, includeCookie });
    };
    pushAuthCandidate("input", inputBearer, !cookieToken || cookieToken === inputBearer);
    pushAuthCandidate("cookie", cookieToken, true);
    if (authCandidates.length === 0) {
      return NextResponse.json(
        {
          error: "No valid StockX auth token available",
          details:
            "Bearer token missing or expired. Run StockX Login (Playwright) to refresh token + session cookies.",
        },
        { status: 401 }
      );
    }

    const payload: Record<string, unknown> = {
      operationName: opName,
      variables: variables ?? {},
    };
    if (typeof query === "string" && query.trim().length > 0) {
      payload.query = query;
    }
    if (extensions && typeof extensions === "object") {
      payload.extensions = extensions;
    } else if (typeof persistedQueryHash === "string" && persistedQueryHash.trim()) {
      payload.extensions = {
        persistedQuery: {
          version: 1,
          sha256Hash: persistedQueryHash.trim(),
        },
      };
    }

    const payloadVariables =
      payload.variables && typeof payload.variables === "object" && payload.variables != null
        ? (payload.variables as Record<string, unknown>)
        : {};

    // Keep legacy Buying compat path only for Buying.
    // FetchCurrentBids should run direct upstream request first.
    const isListOpCompat = opName === "Buying";
    if (isListOpCompat) {
      const compatVariables: Record<string, unknown> = {
        first:
          typeof payloadVariables.first === "number" && Number.isFinite(payloadVariables.first)
            ? payloadVariables.first
            : 20,
        sort:
          typeof payloadVariables.sort === "string" && payloadVariables.sort
            ? payloadVariables.sort
            : "MATCHED_AT",
        order:
          typeof payloadVariables.order === "string" && payloadVariables.order
            ? payloadVariables.order
            : "DESC",
        currencyCode:
          typeof payloadVariables.currencyCode === "string" && payloadVariables.currencyCode
            ? payloadVariables.currencyCode
            : "CHF",
        market:
          typeof payloadVariables.market === "string" && payloadVariables.market
            ? payloadVariables.market
            : "CH",
        country:
          typeof payloadVariables.country === "string" && payloadVariables.country
            ? payloadVariables.country
            : "CH",
        state:
          typeof payloadVariables.state === "string" && payloadVariables.state
            ? payloadVariables.state
            : "PENDING",
      };
      if (typeof payloadVariables.after === "string") {
        compatVariables.after = payloadVariables.after;
      }
      if (
        payloadVariables.page &&
        typeof payloadVariables.page === "object" &&
        !Array.isArray(payloadVariables.page)
      ) {
        compatVariables.page = payloadVariables.page as Record<string, unknown>;
      } else {
        compatVariables.page = { index: 1 };
      }
      const compatPayload: Record<string, unknown> = {
        operationName: STOCKX_PERSISTED_OPERATION_NAME,
        variables: compatVariables,
        extensions: {
          persistedQuery: {
            version: 1,
            sha256Hash: STOCKX_PERSISTED_QUERY_HASH,
          },
        },
      };
      const compatTarget = { url: STOCKX_GATEWAY_GRAPHQL_URL, origin: "https://stockx.com" };
      const compatReferer = resolveReferer(
        STOCKX_PERSISTED_OPERATION_NAME,
        compatVariables,
        session,
        compatTarget.origin
      );
      let lastCompat: { status: number; text: string } | null = null;
      for (const authCandidate of authCandidates) {
        const compatRaw = await tryPlaywrightFallback({
          token: authCandidate.token,
          operationName: STOCKX_PERSISTED_OPERATION_NAME,
          payload: compatPayload,
          session,
          upstreamUrl: compatTarget.url,
          upstreamOrigin: compatTarget.origin,
        });
        lastCompat = compatRaw;
        if (!compatRaw?.text) continue;
        try {
          const compatData = JSON.parse(compatRaw.text);
          const compatHeaders = stockxGraphqlHeaders(
            authCandidate.token,
            STOCKX_PERSISTED_OPERATION_NAME,
            compatVariables,
            session,
            compatTarget.origin,
            { includeCookie: authCandidate.includeCookie }
          );
          const compatResponse = applyUpstreamDebugHeaders(
            NextResponse.json(compatData, { status: compatRaw.status }),
            compatTarget.origin,
            compatTarget.url,
            compatReferer,
            normalizeOperationHeaderName(STOCKX_PERSISTED_OPERATION_NAME),
            compatHeaders,
            authCandidate.source
          );
          compatResponse.headers.set("x-stockx-forced-list-path", "1");
          return compatResponse;
        } catch {
          // try next token candidate
        }
      }
      const compatHeaders = stockxGraphqlHeaders(
        authCandidates[0].token,
        STOCKX_PERSISTED_OPERATION_NAME,
        compatVariables,
        session,
        compatTarget.origin,
        { includeCookie: authCandidates[0].includeCookie }
      );
      return applyUpstreamDebugHeaders(
        NextResponse.json(
          {
            error: "Invalid JSON response from StockX",
            details: `status=${lastCompat?.status ?? 403} raw_head=${String(lastCompat?.text || "").slice(
              0,
              400
            )}`,
          },
          { status: 502 }
        ),
        compatTarget.origin,
        compatTarget.url,
        compatReferer,
        normalizeOperationHeaderName(STOCKX_PERSISTED_OPERATION_NAME),
        compatHeaders,
        authCandidates[0].source
      );
    }

    const upstreamOperationHeaderName = normalizeOperationHeaderName(opName);
    const primaryTarget = resolveUpstreamTarget(opName);
    const secondaryTarget =
      primaryTarget.url === STOCKX_PRO_GRAPHQL_URL
        ? { url: STOCKX_GATEWAY_GRAPHQL_URL, origin: "https://stockx.com" }
        : null;

    const runUpstreamRequest = async (
      target: { url: string; origin: string },
      authCandidate: { source: "input" | "cookie"; token: string; includeCookie: boolean }
    ) => {
      const referer = resolveReferer(opName, payloadVariables, session, target.origin);
      const headers = stockxGraphqlHeaders(
        authCandidate.token,
        opName,
        payloadVariables,
        session,
        target.origin,
        { includeCookie: authCandidate.includeCookie }
      );
      const response = await fetch(target.url, {
        method: "POST",
        headers,
        referrer: referer,
        referrerPolicy: "strict-origin-when-cross-origin",
        body: JSON.stringify(payload),
      });
      const raw = await response.text();
      return {
        target,
        referer,
        headers,
        response,
        raw,
        authSource: authCandidate.source,
        authToken: authCandidate.token,
      };
    };

    const runTargetWithAuthFallback = async (target: { url: string; origin: string }) => {
      let latest = await runUpstreamRequest(target, authCandidates[0]);
      for (let i = 1; i < authCandidates.length && latest.response.status === 403; i += 1) {
        latest = await runUpstreamRequest(target, authCandidates[i]);
      }
      return latest;
    };

    let upstream = await runTargetWithAuthFallback(primaryTarget);
    if (
      secondaryTarget &&
      (upstream.response.status === 404 || upstream.response.status === 403)
    ) {
      upstream = await runTargetWithAuthFallback(secondaryTarget);
    }

    const upstreamTarget = upstream.target;
    const upstreamReferer = upstream.referer;
    const upstreamHeaders = upstream.headers;
    const response = upstream.response;
    const raw = upstream.raw;
    const authSource = upstream.authSource;
    const selectedBearer = upstream.authToken;

    let fallbackTried = false;
    let fallbackRaw: { status: number; text: string } | null = null;
    const fallbackTokens = [
      selectedBearer,
      ...authCandidates
        .map((entry) => entry.token)
        .filter((candidate) => candidate && candidate !== selectedBearer),
    ];
    const runPlaywrightJson = async (args: {
      operationName: string;
      payload: Record<string, unknown>;
      upstreamUrl: string;
      upstreamOrigin: string;
    }): Promise<{ status: number; data: any; usedToken: string } | null> => {
      for (const tokenCandidate of fallbackTokens) {
        fallbackRaw = await tryPlaywrightFallback({
          token: tokenCandidate,
          operationName: args.operationName,
          payload: args.payload,
          session,
          upstreamUrl: args.upstreamUrl,
          upstreamOrigin: args.upstreamOrigin,
        });
        if (!fallbackRaw?.text) continue;
        try {
          return {
            status: fallbackRaw.status,
            data: JSON.parse(fallbackRaw.text),
            usedToken: tokenCandidate,
          };
        } catch {
          // try next token candidate
        }
      }
      return null;
    };
    const tryFallbackJson = async (): Promise<any | null> => {
      if (fallbackTried) return null;
      fallbackTried = true;
      const parsed = await runPlaywrightJson({
        operationName: opName,
        payload,
        upstreamUrl: upstreamTarget.url,
        upstreamOrigin: upstreamTarget.origin,
      });
      if (parsed) {
        return { status: parsed.status, data: parsed.data };
      }
      if (debug) {
        console.log("[API] fallback status", fallbackRaw?.status ?? "none");
        console.log("[API] fallback raw head", String(fallbackRaw?.text || "").slice(0, 400));
      }
      return null;
    };
    const shouldUsePlaywrightFallback =
      opName === "Buying" || opName === STOCKX_PERSISTED_OPERATION_NAME;
    const tryBuyingCompatJson = async (): Promise<
      | {
          status: number;
          data: any;
          target: { origin: string; url: string };
          referer: string;
          operationHeaderName: string;
          headers: Record<string, string>;
        }
      | null
    > => {
      if (opName !== "Buying") return null;
      const compatVariables: Record<string, unknown> = {
        first:
          typeof payloadVariables.first === "number" && Number.isFinite(payloadVariables.first)
            ? payloadVariables.first
            : 20,
        sort:
          typeof payloadVariables.sort === "string" && payloadVariables.sort
            ? payloadVariables.sort
            : "MATCHED_AT",
        order:
          typeof payloadVariables.order === "string" && payloadVariables.order
            ? payloadVariables.order
            : "DESC",
        currencyCode:
          typeof payloadVariables.currencyCode === "string" && payloadVariables.currencyCode
            ? payloadVariables.currencyCode
            : "CHF",
        market:
          typeof payloadVariables.market === "string" && payloadVariables.market
            ? payloadVariables.market
            : "CH",
        country:
          typeof payloadVariables.country === "string" && payloadVariables.country
            ? payloadVariables.country
            : "CH",
      };
      if (typeof payloadVariables.state === "string" && payloadVariables.state) {
        compatVariables.state = payloadVariables.state;
      } else {
        compatVariables.state = "PENDING";
      }
      if (typeof payloadVariables.after === "string") {
        compatVariables.after = payloadVariables.after;
      }
      if (
        payloadVariables.page &&
        typeof payloadVariables.page === "object" &&
        !Array.isArray(payloadVariables.page)
      ) {
        compatVariables.page = payloadVariables.page as Record<string, unknown>;
      }
      const compatPayload: Record<string, unknown> = {
        operationName: STOCKX_PERSISTED_OPERATION_NAME,
        variables: compatVariables,
        extensions: {
          persistedQuery: {
            version: 1,
            sha256Hash: STOCKX_PERSISTED_QUERY_HASH,
          },
        },
      };
      const compatTarget = { url: STOCKX_GATEWAY_GRAPHQL_URL, origin: "https://stockx.com" };
      const parsed = await runPlaywrightJson({
        operationName: STOCKX_PERSISTED_OPERATION_NAME,
        payload: compatPayload,
        upstreamUrl: compatTarget.url,
        upstreamOrigin: compatTarget.origin,
      });
      if (!parsed) return null;
      return {
        status: parsed.status,
        data: parsed.data,
        target: compatTarget,
        referer: resolveReferer(
          STOCKX_PERSISTED_OPERATION_NAME,
          compatVariables,
          session,
          compatTarget.origin
        ),
        operationHeaderName: normalizeOperationHeaderName(STOCKX_PERSISTED_OPERATION_NAME),
        headers: stockxGraphqlHeaders(
          parsed.usedToken,
          STOCKX_PERSISTED_OPERATION_NAME,
          compatVariables,
          session,
          compatTarget.origin
        ),
      };
    };

    if (debug) {
      console.log("[API] stockx op", opName, "status", response.status);
      console.log("[API] stockx url", upstreamTarget.url);
      console.log("[API] stockx content-type", response.headers.get("content-type"));
      console.log("[API] stockx referer", upstreamReferer);
      console.log("[API] stockx x-operation-name", upstreamHeaders["x-operation-name"]);
      console.log("[API] stockx raw head", raw.slice(0, 400));
    }

    if (response.status === 403) {
      if (shouldUsePlaywrightFallback) {
        const fallbackJson = await tryFallbackJson();
        if (fallbackJson) {
          return applyUpstreamDebugHeaders(
            NextResponse.json(fallbackJson.data, { status: fallbackJson.status }),
            upstreamTarget.origin,
            upstreamTarget.url,
            upstreamReferer,
            upstreamOperationHeaderName,
            upstreamHeaders,
            authSource
          );
        }
      } else {
        return applyUpstreamDebugHeaders(
          NextResponse.json(
            {
              error: "StockX unauthorized for order details",
              details:
                "StockX returned 403 for getBuyOrder. Refresh StockX session via Playwright login.",
            },
            { status: 401 }
          ),
          upstreamTarget.origin,
          upstreamTarget.url,
          upstreamReferer,
          upstreamOperationHeaderName,
          upstreamHeaders,
          authSource
        );
      }
      const compatJson = await tryBuyingCompatJson();
      if (compatJson) {
        const resp = applyUpstreamDebugHeaders(
          NextResponse.json(compatJson.data, { status: compatJson.status }),
          compatJson.target.origin,
          compatJson.target.url,
          compatJson.referer,
          compatJson.operationHeaderName,
          compatJson.headers,
          "cookie"
        );
        resp.headers.set("x-stockx-compat-fallback", "1");
        return resp;
      }
    }

    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      if (shouldUsePlaywrightFallback) {
        const fallbackJson = await tryFallbackJson();
        if (fallbackJson) {
          return applyUpstreamDebugHeaders(
            NextResponse.json(fallbackJson.data, { status: fallbackJson.status }),
            upstreamTarget.origin,
            upstreamTarget.url,
            upstreamReferer,
            upstreamOperationHeaderName,
            upstreamHeaders,
            authSource
          );
        }
      }
      const compatJson = await tryBuyingCompatJson();
      if (compatJson) {
        const resp = applyUpstreamDebugHeaders(
          NextResponse.json(compatJson.data, { status: compatJson.status }),
          compatJson.target.origin,
          compatJson.target.url,
          compatJson.referer,
          compatJson.operationHeaderName,
          compatJson.headers,
          "cookie"
        );
        resp.headers.set("x-stockx-compat-fallback", "1");
        return resp;
      }
      const fallbackStatus =
        (fallbackRaw as { status: number; text: string } | null)?.status ?? "none";
      const fallbackRawHead = String(
        (fallbackRaw as { status: number; text: string } | null)?.text || ""
      ).slice(0, 400);
      return applyUpstreamDebugHeaders(
        NextResponse.json(
          {
            error: "Invalid JSON response from StockX",
            details: `status=${response.status} raw_head=${raw.slice(0, 400)} fallback_status=${fallbackStatus} fallback_raw_head=${fallbackRawHead}`,
          },
          { status: 502 }
        ),
        upstreamTarget.origin,
        upstreamTarget.url,
        upstreamReferer,
        upstreamOperationHeaderName,
        upstreamHeaders,
        authSource
      );
    }

    return applyUpstreamDebugHeaders(
      NextResponse.json(data, { status: response.status }),
      upstreamTarget.origin,
      upstreamTarget.url,
      upstreamReferer,
      upstreamOperationHeaderName,
      upstreamHeaders,
      authSource
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: "Internal server error", details: error?.message || "Unknown error" },
      { status: 500 }
    );
  }
}

