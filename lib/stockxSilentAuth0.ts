/**
 * Silent Auth0 remint for StockX Iron SPA (client_id from live JWT azp).
 * Only works after Cloudflare has cleared on the page — authorize itself is CF-gated.
 */
import type { BrowserContext, Page } from "playwright";
import crypto from "node:crypto";

/** StockX web (Iron) Auth0 application — from JWT `azp`. */
export const STOCKX_AUTH0_CLIENT_ID = "OVxrt4VJqTx7LIUKd661W0DuVMpcFByD";
export const STOCKX_AUTH0_AUDIENCE = "gateway.stockx.com";
export const STOCKX_AUTH0_DOMAIN = "accounts.stockx.com";
/** Confirmed allowed callback (trailing slash → mismatch). */
export const STOCKX_AUTH0_REDIRECT_URI = "https://stockx.com";

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pkce(): { verifier: string; challenge: string } {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function decodeJwt(tok: string): Record<string, unknown> | null {
  try {
    const p = tok.split(".")[1] || "";
    const normalized = p.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function isFreshStockxAccessToken(tok: string, skewSeconds = 60): boolean {
  const cleaned = tok.replace(/^Bearer\s+/i, "").trim();
  if (!cleaned.startsWith("eyJ")) return false;
  const payload = decodeJwt(cleaned);
  if (!payload) return false;
  const exp = typeof payload.exp === "number" ? payload.exp : 0;
  if (exp <= Math.floor(Date.now() / 1000) + skewSeconds) return false;
  const iss = String(payload.iss || "");
  const aud = payload.aud;
  const audOk =
    (typeof aud === "string" && aud.includes("stockx")) ||
    (Array.isArray(aud) && aud.some((a) => String(a).includes("stockx")));
  return iss.includes("stockx") || audOk;
}

/**
 * prompt=none authorize in the headed context (cookie jar = Auth0 SSO).
 * Returns a fresh access_token when Auth0 session is valid and CF is clear.
 */
export async function trySilentAuth0CodeRemint(
  page: Page,
  options: { timeoutMs?: number } = {}
): Promise<{ token: string | null; refreshToken: string | null; error: string | null }> {
  const timeoutMs = options.timeoutMs ?? 45_000;
  const { verifier, challenge } = pkce();
  const state = b64url(crypto.randomBytes(16));
  const nonce = b64url(crypto.randomBytes(16));
  const url = new URL(`https://${STOCKX_AUTH0_DOMAIN}/authorize`);
  url.searchParams.set("client_id", STOCKX_AUTH0_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", STOCKX_AUTH0_REDIRECT_URI);
  url.searchParams.set("scope", "openid offline_access");
  url.searchParams.set("audience", STOCKX_AUTH0_AUDIENCE);
  url.searchParams.set("prompt", "none");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("response_mode", "query");

  try {
    await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: timeoutMs });
  } catch (err: any) {
    return { token: null, refreshToken: null, error: err?.message || "authorize navigation failed" };
  }

  const finalUrl = page.url();
  let parsed: URL;
  try {
    parsed = new URL(finalUrl);
  } catch {
    return { token: null, refreshToken: null, error: `bad final url: ${finalUrl.slice(0, 120)}` };
  }

  const err = parsed.searchParams.get("error");
  if (err) {
    return {
      token: null,
      refreshToken: null,
      error: `${err}: ${parsed.searchParams.get("error_description") || ""}`.trim(),
    };
  }

  const code = parsed.searchParams.get("code");
  if (!code) {
    // Still on CF / authorize — not silent-ready
    if (/just a moment|un instant|challenges\.cloudflare|__cf_chl/i.test(finalUrl + (await page.title().catch(() => "")))) {
      return { token: null, refreshToken: null, error: "authorize blocked by Cloudflare" };
    }
    return { token: null, refreshToken: null, error: `no code in redirect: ${finalUrl.slice(0, 160)}` };
  }

  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: STOCKX_AUTH0_CLIENT_ID,
      code,
      redirect_uri: STOCKX_AUTH0_REDIRECT_URI,
      code_verifier: verifier,
    });
    const tokenRes = await page.evaluate(async (payload) => {
      const r = await fetch("https://accounts.stockx.com/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: payload,
      });
      return { status: r.status, text: await r.text() };
    }, body.toString());

    if (tokenRes.status >= 400) {
      return {
        token: null,
        refreshToken: null,
        error: `token exchange HTTP ${tokenRes.status}: ${tokenRes.text.slice(0, 180)}`,
      };
    }
    const json = JSON.parse(tokenRes.text) as {
      access_token?: string;
      refresh_token?: string;
    };
    const access = json.access_token || null;
    if (!access || !isFreshStockxAccessToken(access)) {
      return { token: null, refreshToken: null, error: "token exchange returned no fresh access_token" };
    }
    return { token: access, refreshToken: json.refresh_token || null, error: null };
  } catch (err: any) {
    return { token: null, refreshToken: null, error: err?.message || "token exchange failed" };
  }
}

/** Persist refresh_token beside the bearer when Auth0 returns one (offline_access). */
export async function writeStockxTokenFile(
  tokenFile: string,
  token: string,
  extras: { refreshToken?: string | null; source?: string } = {}
): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  await fs.mkdir(path.dirname(tokenFile), { recursive: true });
  const payload: Record<string, unknown> = {
    token: token.replace(/^Bearer\s+/i, "").trim(),
    updatedAt: new Date().toISOString(),
  };
  if (extras.refreshToken) payload.refreshToken = extras.refreshToken;
  if (extras.source) payload.source = extras.source;
  await fs.writeFile(tokenFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

/**
 * Refresh-token grant (no browser) when we previously captured offline_access refresh_token.
 */
export async function tryRefreshTokenGrant(
  refreshToken: string
): Promise<{ token: string | null; refreshToken: string | null; error: string | null }> {
  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: STOCKX_AUTH0_CLIENT_ID,
      refresh_token: refreshToken,
    });
    const res = await fetch(`https://${STOCKX_AUTH0_DOMAIN}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const text = await res.text();
    if (!res.ok) {
      return { token: null, refreshToken: null, error: `refresh_token HTTP ${res.status}: ${text.slice(0, 180)}` };
    }
    const json = JSON.parse(text) as { access_token?: string; refresh_token?: string };
    if (!json.access_token || !isFreshStockxAccessToken(json.access_token)) {
      return { token: null, refreshToken: null, error: "refresh_token grant returned no fresh access_token" };
    }
    return {
      token: json.access_token,
      refreshToken: json.refresh_token || refreshToken,
      error: null,
    };
  } catch (err: any) {
    return { token: null, refreshToken: null, error: err?.message || "refresh_token grant failed" };
  }
}

export async function readStoredRefreshToken(tokenFile: string): Promise<string | null> {
  try {
    const fs = await import("node:fs/promises");
    const raw = await fs.readFile(tokenFile, "utf8");
    const parsed = JSON.parse(raw) as { refreshToken?: string };
    const rt = typeof parsed.refreshToken === "string" ? parsed.refreshToken.trim() : "";
    return rt || null;
  } catch {
    return null;
  }
}

/** Inspect cookie jar for Auth0 SSO markers (does not need navigation). */
export async function contextHasAuth0Cookies(context: BrowserContext): Promise<boolean> {
  const cookies = await context.cookies().catch(() => []);
  return cookies.some(
    (c) =>
      (c.name === "auth0" || c.name === "auth0_compat" || c.name === "did" || c.name === "did_compat") &&
      Boolean(c.value?.trim()) &&
      String(c.domain || "").includes("stockx")
  );
}
