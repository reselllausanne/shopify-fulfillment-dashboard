import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { POST as stockxPlaywright } from "@/app/api/stockx/playwright/route";
import { stockxCredentialsFromEnv } from "@/lib/stockxAutoLogin";
import { notifyStockxAuthBroken } from "@/lib/stockxAuthAlert";
import {
  GALAXUS_STOCKX_SESSION_FILE,
  GALAXUS_STOCKX_SESSION_META_FILE,
  GALAXUS_STOCKX_TOKEN_FILE,
  readGalaxusStockxToken,
} from "@/lib/stockxGalaxusAuth";
import { stockxTokenExpiresAt } from "@/lib/stockxServerToken";
import {
  readStoredRefreshToken,
  tryRefreshTokenGrant,
  writeStockxTokenFile,
} from "@/lib/stockxSilentAuth0";
import { markWarmToken } from "@/lib/stockxWarmBrowser";

const DATA_DIR = path.join(process.cwd(), ".data");

export type StockxRefreshAccount = "default" | "galaxus";

type AccountFiles = {
  sessionFile: string;
  sessionMetaFile: string;
  tokenFile: string;
  profileDir: string;
};

const ACCOUNT_FILES: Record<StockxRefreshAccount, AccountFiles> = {
  default: {
    sessionFile: path.join(DATA_DIR, "stockx-session.json"),
    sessionMetaFile: path.join(DATA_DIR, "stockx-session-meta.json"),
    tokenFile: path.join(DATA_DIR, "stockx-token.json"),
    profileDir: path.join(DATA_DIR, "stockx-profile"),
  },
  galaxus: {
    sessionFile: GALAXUS_STOCKX_SESSION_FILE,
    sessionMetaFile: GALAXUS_STOCKX_SESSION_META_FILE,
    tokenFile: GALAXUS_STOCKX_TOKEN_FILE,
    profileDir: path.join(DATA_DIR, "stockx-profile-galaxus"),
  },
};

export function stockxAccountFiles(account: StockxRefreshAccount): AccountFiles {
  return ACCOUNT_FILES[account];
}

export function parseStockxRefreshAccount(raw: unknown): StockxRefreshAccount {
  return raw === "galaxus" ? "galaxus" : "default";
}

/**
 * StockX bearers live ~12h. Remint while ≥6h remain so a failed night still leaves buffer.
 * Dead cookies cannot remint — proactive keep-alive is what prevents VNC every morning.
 */
const REFRESH_WHEN_LESS_THAN_MS = 6 * 60 * 60 * 1000;
/** Touch StockX / warm browser every ~90m so cf session never goes cold on vacation. */
const KEEP_ALIVE_EVERY_MS = 90 * 60 * 1000;

export type StockxRefreshResult = {
  ok: boolean;
  token: string | null;
  reused: boolean;
  expiresAt: Date | null;
  profileReset: boolean;
  needsManualLogin: boolean;
  error: string | null;
  reason?: "reused" | "near_expiry" | "keep_alive" | "forced" | "missing" | "failed";
};

async function backupAuthFiles(files: AccountFiles): Promise<Map<string, Buffer>> {
  const snapshot = new Map<string, Buffer>();
  for (const file of [files.sessionFile, files.sessionMetaFile, files.tokenFile]) {
    try {
      snapshot.set(file, await fs.readFile(file));
    } catch {
      // absent file needs no backup
    }
  }
  return snapshot;
}

async function restoreAuthFiles(snapshot: Map<string, Buffer>): Promise<void> {
  for (const [file, contents] of snapshot) {
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, contents);
    } catch {
      // best effort
    }
  }
}

async function readTokenUpdatedAt(tokenFile: string): Promise<Date | null> {
  try {
    const raw = await fs.readFile(tokenFile, "utf8");
    const parsed = JSON.parse(raw) as { updatedAt?: string };
    if (!parsed?.updatedAt) return null;
    const at = new Date(parsed.updatedAt);
    return Number.isNaN(at.getTime()) ? null : at;
  } catch {
    return null;
  }
}

export async function hasStockxProfile(account: StockxRefreshAccount = "default"): Promise<boolean> {
  try {
    const entries = await fs.readdir(ACCOUNT_FILES[account].profileDir);
    return entries.length > 0;
  } catch {
    return false;
  }
}

/** Whether unattended refresh is possible for this account (profile or env credentials). */
export async function canRefreshStockxAccount(account: StockxRefreshAccount): Promise<boolean> {
  return Boolean(stockxCredentialsFromEnv(account)) || (await hasStockxProfile(account));
}

/**
 * Mints a fresh bearer from the persistent browser profile without any human present. A transient
 * Cloudflare challenge makes the login route delete the profile and token, so the auth files are
 * snapshotted first and restored on failure — otherwise one bad night would force a manual login.
 *
 * Profile dir lives on the host bind mount `./.data:/app/.data` (docker-compose) — deploys do not
 * wipe Chromium profiles. Remint fails when Auth0/session cookies are already dead or Turnstile
 * blocks headed automation; keep-alive while JWT is still valid avoids that cliff.
 */
export async function refreshStockxToken(
  options: { force?: boolean; maxWaitMs?: number; account?: StockxRefreshAccount } = {}
): Promise<StockxRefreshResult> {
  const force = Boolean(options.force ?? false);
  const account = options.account ?? "default";
  const files = ACCOUNT_FILES[account];

  const existingToken = await readGalaxusStockxToken(files.tokenFile);
  const existingExpiresAt = existingToken ? stockxTokenExpiresAt(existingToken) : null;
  const existingRemaining = existingExpiresAt ? existingExpiresAt.getTime() - Date.now() : 0;
  const updatedAt = await readTokenUpdatedAt(files.tokenFile);
  const ageMs = updatedAt ? Date.now() - updatedAt.getTime() : Number.POSITIVE_INFINITY;

  let remintReason: StockxRefreshResult["reason"] = "missing";
  if (force) {
    remintReason = "forced";
  } else if (existingToken && existingRemaining > REFRESH_WHEN_LESS_THAN_MS && ageMs < KEEP_ALIVE_EVERY_MS) {
    return {
      ok: true,
      token: existingToken,
      reused: true,
      expiresAt: existingExpiresAt,
      profileReset: false,
      needsManualLogin: false,
      error: null,
      reason: "reused",
    };
  } else if (existingToken && existingRemaining > REFRESH_WHEN_LESS_THAN_MS) {
    remintReason = "keep_alive";
  } else if (existingToken) {
    remintReason = "near_expiry";
  }

  const hasCredentials = Boolean(stockxCredentialsFromEnv(account));
  if (!(await hasStockxProfile(account)) && !hasCredentials) {
    const result: StockxRefreshResult = {
      ok: false,
      token: null,
      reused: false,
      expiresAt: null,
      profileReset: false,
      needsManualLogin: true,
      error: `No persistent StockX browser profile or credentials for account "${account}".`,
      reason: "failed",
    };
    await notifyStockxAuthBroken({ account, error: result.error }).catch(() => undefined);
    return result;
  }

  console.log(
    `[STOCKX-REFRESH] remint account=${account} reason=${remintReason} display=${process.env.DISPLAY || "(unset→:99)"}`
  );

  // Path 0: Auth0 refresh_token grant — no browser, no Turnstile (when previously captured).
  const storedRefresh = await readStoredRefreshToken(files.tokenFile);
  if (storedRefresh) {
    const refreshed = await tryRefreshTokenGrant(storedRefresh);
    if (refreshed.token) {
      await writeStockxTokenFile(files.tokenFile, refreshed.token, {
        refreshToken: refreshed.refreshToken,
        source: "auth0-refresh-token",
      });
      await markWarmToken(account).catch(() => undefined);
      const expiresAt = stockxTokenExpiresAt(refreshed.token);
      console.log(
        `[STOCKX-REFRESH] refresh_token grant ok account=${account} exp=${expiresAt?.toISOString() ?? "?"}`
      );
      return {
        ok: true,
        token: refreshed.token,
        reused: false,
        expiresAt,
        profileReset: false,
        needsManualLogin: false,
        error: null,
        reason: remintReason,
      };
    }
    console.warn(
      `[STOCKX-REFRESH] refresh_token grant failed account=${account}: ${refreshed.error}`
    );
  }

  const snapshot = await backupAuthFiles(files);
  // True Playwright headless is blocked by Cloudflare ("Just a moment" / Error page).
  // Prefer warm CDP Chromium; else headed launch on Xvfb and leave it warm.
  if (!process.env.DISPLAY) {
    process.env.DISPLAY = ":99";
  }
  const request = new NextRequest("http://internal/api/stockx/playwright", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      headless: false,
      persistent: true,
      forceLogin: false,
      reuseTokenFile: !force,
      autoNavigate: true,
      autoLogin: true,
      allowProfileReset: false,
      // Only Chromium is installed in the container image.
      browser: "chromium",
      // Cookie-first: reuse the persistent profile on buying/orders. Going to /login first
      // forces Cloudflare Turnstile even when the session cookies are still valid.
      startUrl: "https://stockx.com/buying/orders",
      // Sit-still Turnstile + silent Auth0 needs headroom; cron allows ~9m.
      maxWaitMs: Math.min(Number(options.maxWaitMs ?? 240000), 420000),
      sessionFile: files.sessionFile,
      sessionMetaFile: files.sessionMetaFile,
      tokenFile: files.tokenFile,
      userDataDir: files.profileDir,
      credentialsAccount: account,
      // Vacation path: attach warm CDP if up; leave browser open after mint.
      useWarmCdp: true,
      leaveWarm: true,
      silentAuth0: true,
    }),
  });

  let payload: Record<string, any> = {};
  let httpStatus = 500;
  try {
    const response = await stockxPlaywright(request);
    httpStatus = response.status;
    payload = await response.json().catch(() => ({}));
  } catch (error: any) {
    payload = { error: error?.message || "Playwright refresh crashed" };
  }

  const token = typeof payload?.token === "string" ? payload.token : null;
  const profileReset = Boolean(payload?.reset);
  const expiresAt = token ? stockxTokenExpiresAt(token) : null;
  const stillFresh = Boolean(expiresAt && expiresAt.getTime() - Date.now() > 60_000);

  if (!token || !stillFresh) {
    await restoreAuthFiles(snapshot);
    const error = !token
      ? String(payload?.error || `Playwright login failed (HTTP ${httpStatus})`)
      : `Playwright returned an already-expired bearer (exp ${expiresAt?.toISOString() ?? "?"})`;
    const result: StockxRefreshResult = {
      ok: false,
      token: null,
      reused: false,
      expiresAt: null,
      profileReset,
      needsManualLogin: true,
      error,
      reason: "failed",
    };
    // Alert only after cookie + warm + silent Auth0 paths failed (playwright already exhausted).
    await notifyStockxAuthBroken({ account, error: result.error }).catch(() => undefined);
    return result;
  }

  await markWarmToken(account).catch(() => undefined);
  return {
    ok: true,
    token,
    reused: Boolean(payload?.reused),
    expiresAt,
    profileReset: false,
    needsManualLogin: false,
    error: null,
    reason: remintReason,
  };
}
