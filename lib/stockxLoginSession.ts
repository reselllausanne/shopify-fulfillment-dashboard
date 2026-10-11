import { NextRequest } from "next/server";
import { POST as stockxPlaywright } from "@/app/api/stockx/playwright/route";
import { readGalaxusStockxToken } from "@/lib/stockxGalaxusAuth";
import {
  hasStockxProfile,
  stockxAccountFiles,
  type StockxRefreshAccount,
} from "@/lib/stockxSessionRefresh";
import { stockxTokenExpiresAt } from "@/lib/stockxServerToken";

const LOGIN_WINDOW_MS = 900000;

export type StockxLoginState = {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  ok: boolean | null;
  error: string | null;
  profileReset: boolean;
};

function idleState(): StockxLoginState {
  return {
    running: false,
    startedAt: null,
    finishedAt: null,
    ok: null,
    error: null,
    profileReset: false,
  };
}

const states: Record<StockxRefreshAccount, StockxLoginState> = {
  default: idleState(),
  galaxus: idleState(),
};

/**
 * Drives the login browser on the server display so it can be completed from anywhere through
 * noVNC. Returns as soon as the browser is up: the operator needs the request to finish long
 * before they have typed their password and 2FA code.
 */
export function startInteractiveStockxLogin(
  options: { reset?: boolean; account?: StockxRefreshAccount } = {}
): StockxLoginState {
  const account = options.account ?? "default";
  const state = states[account];
  // One server display: never run two login browsers at once.
  if (states.default.running || states.galaxus.running) return { ...state };

  Object.assign(state, idleState(), { running: true, startedAt: new Date().toISOString() });
  const files = stockxAccountFiles(account);

  const request = new NextRequest("http://internal/api/stockx/playwright", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      headless: false,
      persistent: true,
      forceLogin: Boolean(options.reset),
      reuseTokenFile: false,
      autoLogin: true,
      browser: "chromium",
      startUrl: "https://stockx.com/login",
      waitForUserClose: false,
      maxWaitMs: LOGIN_WINDOW_MS,
      sessionFile: files.sessionFile,
      sessionMetaFile: files.sessionMetaFile,
      tokenFile: files.tokenFile,
      userDataDir: files.profileDir,
      credentialsAccount: account,
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

export async function getStockxLoginStatus(account: StockxRefreshAccount = "default") {
  const [token, profile] = await Promise.all([
    readGalaxusStockxToken(stockxAccountFiles(account).tokenFile),
    hasStockxProfile(account),
  ]);
  const expiresAt = token ? stockxTokenExpiresAt(token) : null;
  return {
    account,
    login: { ...states[account] },
    otherAccountRunning: states[account === "default" ? "galaxus" : "default"].running,
    hasProfile: profile,
    token: token ? { source: account, expiresAt: expiresAt?.toISOString() ?? null } : null,
  };
}
