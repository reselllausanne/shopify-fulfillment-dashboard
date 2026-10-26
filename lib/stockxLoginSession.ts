import { NextRequest } from "next/server";
import { POST as stockxPlaywright } from "@/app/api/stockx/playwright/route";
import {
  clearChromeSingletonLocks,
  isChromeUsingProfile,
  killChromeForUserDataDir,
} from "@/lib/stockxBrowserProcess";
import { readGalaxusStockxToken } from "@/lib/stockxGalaxusAuth";
import {
  hasStockxProfile,
  stockxAccountFiles,
  type StockxRefreshAccount,
} from "@/lib/stockxSessionRefresh";
import { stockxTokenExpiresAt } from "@/lib/stockxServerToken";

const LOGIN_WINDOW_MS = 900000;

const ACCOUNT_LABEL: Record<StockxRefreshAccount, string> = {
  default: "Shopify (resell)",
  galaxus: "Galaxus (contact@)",
};

export type StockxLoginState = {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  ok: boolean | null;
  error: string | null;
  profileReset: boolean;
  blockedBy: StockxRefreshAccount | null;
};

function idleState(): StockxLoginState {
  return {
    running: false,
    startedAt: null,
    finishedAt: null,
    ok: null,
    error: null,
    profileReset: false,
    blockedBy: null,
  };
}

const states: Record<StockxRefreshAccount, StockxLoginState> = {
  default: idleState(),
  galaxus: idleState(),
};

function otherAccount(account: StockxRefreshAccount): StockxRefreshAccount {
  return account === "default" ? "galaxus" : "default";
}

/**
 * Kill Chromium for one or both StockX profiles and clear in-memory login flags.
 * Keeps cookie profiles (only Singleton* locks removed).
 */
export async function stopInteractiveStockxLogin(
  options: { account?: StockxRefreshAccount | "all" } = {}
): Promise<{ stopped: StockxRefreshAccount[]; killed: number }> {
  const targets: StockxRefreshAccount[] =
    options.account === "all" || !options.account
      ? ["default", "galaxus"]
      : [options.account];

  let killed = 0;
  for (const account of targets) {
    const files = stockxAccountFiles(account);
    killed += await killChromeForUserDataDir(files.profileDir);
    Object.assign(states[account], idleState(), {
      finishedAt: new Date().toISOString(),
      error: "Stopped by operator",
      ok: false,
    });
  }
  return { stopped: targets, killed };
}

/**
 * Drives the login browser on the server display so it can be completed from anywhere through
 * noVNC. Returns as soon as the browser is up: the operator needs the request to finish long
 * before they have typed their password and 2FA code.
 *
 * One shared Xvfb/VNC (:99): only one account login browser at a time. Pass force:true to
 * stop the other account first.
 */
export async function startInteractiveStockxLogin(
  options: { reset?: boolean; account?: StockxRefreshAccount; force?: boolean } = {}
): Promise<StockxLoginState> {
  const account = options.account ?? "default";
  const state = states[account];
  const other = otherAccount(account);
  const otherState = states[other];
  const otherProfile = stockxAccountFiles(other).profileDir;
  const thisProfile = stockxAccountFiles(account).profileDir;

  const otherBusy =
    otherState.running || (await isChromeUsingProfile(otherProfile));
  const thisBusy = state.running || (await isChromeUsingProfile(thisProfile));

  if (otherBusy && !options.force) {
    return {
      ...state,
      running: false,
      blockedBy: other,
      error: `Login browser busy with ${ACCOUNT_LABEL[other]}. Finish that Turnstile/login, or Stop browser / Take over.`,
    };
  }

  if (otherBusy && options.force) {
    await stopInteractiveStockxLogin({ account: other });
  }

  if (thisBusy) {
    // Same account already up (or orphan Chromium after deploy) — reclaim before relaunch.
    await stopInteractiveStockxLogin({ account });
  } else {
    await clearChromeSingletonLocks(thisProfile);
  }

  Object.assign(state, idleState(), { running: true, startedAt: new Date().toISOString() });
  const requestStartedAt = state.startedAt;
  const files = stockxAccountFiles(account);

  const request = new NextRequest("http://internal/api/stockx/playwright", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      headless: false,
      persistent: true,
      // Route the interactive VNC login through the residential CH pool. The VPS
      // datacenter IP is hard-blocked by Cloudflare Turnstile (infinite spinner),
      // so a human solving the challenge still fails on the direct IP. A residential
      // proxy makes the Turnstile solvable (this is how the token seed path works).
      useProxy: true,
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
      killExistingProfileBrowser: true,
    }),
  });

  void stockxPlaywright(request)
    .then(async (response) => {
      // Ignore late results if operator already stopped / restarted this account.
      if (state.startedAt !== requestStartedAt) return;
      const payload = (await response.json().catch(() => ({}))) as Record<string, any>;
      state.ok = Boolean(payload?.token);
      state.error = payload?.token ? null : String(payload?.error || `HTTP ${response.status}`);
      state.profileReset = Boolean(payload?.reset);
    })
    .catch((error: any) => {
      if (state.startedAt !== requestStartedAt) return;
      state.ok = false;
      state.error = error?.message || "Playwright crashed";
    })
    .finally(() => {
      if (state.startedAt !== requestStartedAt) return;
      state.running = false;
      state.finishedAt = new Date().toISOString();
    });

  return { ...state };
}

export async function getStockxLoginStatus(account: StockxRefreshAccount = "default") {
  const other = otherAccount(account);
  const [token, profile, thisChrome, otherChrome] = await Promise.all([
    readGalaxusStockxToken(stockxAccountFiles(account).tokenFile),
    hasStockxProfile(account),
    isChromeUsingProfile(stockxAccountFiles(account).profileDir),
    isChromeUsingProfile(stockxAccountFiles(other).profileDir),
  ]);
  const expiresAt = token ? stockxTokenExpiresAt(token) : null;

  // Deploy/restart clears in-memory flags while Chromium can still hold the profile.
  if (thisChrome && !states[account].running) {
    states[account].running = true;
    states[account].startedAt = states[account].startedAt ?? new Date().toISOString();
    states[account].error = "Orphan browser detected (reclaimed) — use Stop if stuck";
  }
  if (otherChrome && !states[other].running) {
    states[other].running = true;
    states[other].startedAt = states[other].startedAt ?? new Date().toISOString();
    states[other].error = "Orphan browser detected (reclaimed) — use Stop if stuck";
  }

  return {
    account,
    login: { ...states[account] },
    otherAccountRunning: states[other].running || otherChrome,
    otherAccountLabel: ACCOUNT_LABEL[other],
    hasProfile: profile,
    token: token ? { source: account, expiresAt: expiresAt?.toISOString() ?? null } : null,
  };
}
