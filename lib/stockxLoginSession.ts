import { NextRequest } from "next/server";
import { POST as stockxPlaywright } from "@/app/api/stockx/playwright/route";
import { hasStockxProfile } from "@/lib/stockxSessionRefresh";
import { readServerStockxToken } from "@/lib/stockxServerToken";

const LOGIN_WINDOW_MS = 900000;

export type StockxLoginState = {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  ok: boolean | null;
  error: string | null;
  profileReset: boolean;
};

const state: StockxLoginState = {
  running: false,
  startedAt: null,
  finishedAt: null,
  ok: null,
  error: null,
  profileReset: false,
};

/**
 * Drives the login browser on the server display so it can be completed from anywhere through
 * noVNC. Returns as soon as the browser is up: the operator needs the request to finish long
 * before they have typed their password and 2FA code.
 */
export function startInteractiveStockxLogin(options: { reset?: boolean } = {}): StockxLoginState {
  if (state.running) return { ...state };

  state.running = true;
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.ok = null;
  state.error = null;
  state.profileReset = false;

  const request = new NextRequest("http://internal/api/stockx/playwright", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      headless: false,
      persistent: true,
      forceLogin: Boolean(options.reset),
      reuseTokenFile: false,
      browser: "chromium",
      startUrl: "https://stockx.com/login",
      waitForUserClose: false,
      maxWaitMs: LOGIN_WINDOW_MS,
    }),
  });

  void stockxPlaywright(request)
    .then(async (response) => {
      const payload = (await response.json().catch(() => ({}))) as Record<string, any>;
      state.ok = Boolean(payload?.token);
      state.error = payload?.token ? null : String(payload?.error || `HTTP ${response.status}`);
      state.profileReset = Boolean(payload?.reset);
    })
    .catch((error: any) => {
      state.ok = false;
      state.error = error?.message || "Playwright crashed";
    })
    .finally(() => {
      state.running = false;
      state.finishedAt = new Date().toISOString();
    });

  return { ...state };
}

export async function getStockxLoginStatus() {
  const [stored, profile] = await Promise.all([readServerStockxToken(), hasStockxProfile()]);
  return {
    login: { ...state },
    hasProfile: profile,
    token: stored
      ? { source: stored.source, expiresAt: stored.expiresAt?.toISOString() ?? null }
      : null,
  };
}
