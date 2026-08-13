import type { AdsConfig, MerchantOauthConfig } from "@/adsanalytics/config";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
/** Refresh a little early so a long backfill never runs into a mid-flight expiry. */
const EXPIRY_SAFETY_MS = 60_000;

type CachedToken = { accessToken: string; expiresAtMs: number };

const cache = new Map<string, CachedToken>();

export class GoogleAuthError extends Error {
  readonly status: number;

  constructor(status: number, body: string) {
    super(`Google OAuth token request failed (HTTP ${status}): ${body}`);
    this.name = "GoogleAuthError";
    this.status = status;
  }
}

type OAuthLike = Pick<AdsConfig, "clientId" | "clientSecret" | "refreshToken"> | MerchantOauthConfig;

export async function getAccessTokenForOAuth(config: OAuthLike): Promise<string> {
  const cacheKey = `${config.clientId}:${config.refreshToken.slice(-12)}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAtMs > Date.now()) return cached.accessToken;

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: "refresh_token",
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const text = await res.text();
  if (!res.ok) throw new GoogleAuthError(res.status, text.slice(0, 500));

  const parsed = JSON.parse(text) as { access_token?: string; expires_in?: number };
  if (!parsed.access_token) throw new GoogleAuthError(res.status, "response had no access_token");

  const ttlMs = (parsed.expires_in ?? 3600) * 1000;
  cache.set(cacheKey, {
    accessToken: parsed.access_token,
    expiresAtMs: Date.now() + Math.max(ttlMs - EXPIRY_SAFETY_MS, 0),
  });

  return parsed.access_token;
}

export async function getAccessToken(config: AdsConfig): Promise<string> {
  return getAccessTokenForOAuth(config);
}

export function clearTokenCache(): void {
  cache.clear();
}
