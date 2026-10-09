import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { POST as stockxPlaywright } from "@/app/api/stockx/playwright/route";
import { stockxCredentialsFromEnv } from "@/lib/stockxAutoLogin";
import {
  GALAXUS_STOCKX_SESSION_FILE,
  GALAXUS_STOCKX_SESSION_META_FILE,
  GALAXUS_STOCKX_TOKEN_FILE,
  readGalaxusStockxToken,
} from "@/lib/stockxGalaxusAuth";
import { stockxTokenExpiresAt } from "@/lib/stockxServerToken";

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

/** StockX bearers live ~12h, so a headless mint well before expiry keeps jobs from ever seeing 401. */
const REFRESH_WHEN_LESS_THAN_MS = 3 * 60 * 60 * 1000;

export type StockxRefreshResult = {
  ok: boolean;
  token: string | null;
  reused: boolean;
  expiresAt: Date | null;
  profileReset: boolean;
  needsManualLogin: boolean;
  error: string | null;
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
 */
export async function refreshStockxToken(
  options: { force?: boolean; maxWaitMs?: number; account?: StockxRefreshAccount } = {}
): Promise<StockxRefreshResult> {
  const force = Boolean(options.force ?? false);
  const account = options.account ?? "default";
  const files = ACCOUNT_FILES[account];

  if (!force) {
    const token = await readGalaxusStockxToken(files.tokenFile);
    const expiresAt = token ? stockxTokenExpiresAt(token) : null;
    const remaining = expiresAt ? expiresAt.getTime() - Date.now() : 0;
    if (token && remaining > REFRESH_WHEN_LESS_THAN_MS) {
      return {
        ok: true,
        token,
        reused: true,
        expiresAt,
        profileReset: false,
        needsManualLogin: false,
        error: null,
      };
    }
  }

  const hasCredentials = Boolean(stockxCredentialsFromEnv(account));
  if (!(await hasStockxProfile(account)) && !hasCredentials) {
    return {
      ok: false,
      token: null,
      reused: false,
      expiresAt: null,
      profileReset: false,
      needsManualLogin: true,
      error: `No persistent StockX browser profile or credentials for account "${account}".`,
    };
  }

  const snapshot = await backupAuthFiles(files);
  // True Playwright headless is blocked by Cloudflare ("Just a moment" / Error page).
  // Use a headed Chromium on the container Xvfb display instead — same path as phone login,
  // no human needed when the saved profile session is still valid.
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
      // Login page first so credential fill can run; then we navigate to buying/orders.
      startUrl: "https://stockx.com/login",
      maxWaitMs: Math.min(Number(options.maxWaitMs ?? 240000), 300000),
      sessionFile: files.sessionFile,
      sessionMetaFile: files.sessionMetaFile,
      tokenFile: files.tokenFile,
      userDataDir: files.profileDir,
      credentialsAccount: account,
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

  if (!token) {
    await restoreAuthFiles(snapshot);
    return {
      ok: false,
      token: null,
      reused: false,
      expiresAt: null,
      profileReset,
      needsManualLogin: profileReset || httpStatus === 401 || httpStatus === 403,
      error: String(payload?.error || `Playwright login failed (HTTP ${httpStatus})`),
    };
  }

  return {
    ok: true,
    token,
    reused: Boolean(payload?.reused),
    expiresAt: stockxTokenExpiresAt(token),
    profileReset: false,
    needsManualLogin: false,
    error: null,
  };
}
