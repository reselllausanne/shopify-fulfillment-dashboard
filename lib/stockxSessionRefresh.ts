import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { POST as stockxPlaywright } from "@/app/api/stockx/playwright/route";
import { readServerStockxToken, stockxTokenExpiresAt } from "@/lib/stockxServerToken";

const DATA_DIR = path.join(process.cwd(), ".data");
const SESSION_FILE = path.join(DATA_DIR, "stockx-session.json");
const SESSION_META_FILE = path.join(DATA_DIR, "stockx-session-meta.json");
const TOKEN_FILE = path.join(DATA_DIR, "stockx-token.json");
const PROFILE_DIR = path.join(DATA_DIR, "stockx-profile");

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

async function backupAuthFiles(): Promise<Map<string, Buffer>> {
  const snapshot = new Map<string, Buffer>();
  for (const file of [SESSION_FILE, SESSION_META_FILE, TOKEN_FILE]) {
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

export async function hasStockxProfile(): Promise<boolean> {
  try {
    const entries = await fs.readdir(PROFILE_DIR);
    return entries.length > 0;
  } catch {
    return false;
  }
}

/**
 * Mints a fresh bearer from the persistent browser profile without any human present. A transient
 * Cloudflare challenge makes the login route delete the profile and token, so the auth files are
 * snapshotted first and restored on failure — otherwise one bad night would force a manual login.
 */
export async function refreshStockxToken(
  options: { force?: boolean; maxWaitMs?: number } = {}
): Promise<StockxRefreshResult> {
  const force = Boolean(options.force ?? false);

  if (!force) {
    const stored = await readServerStockxToken();
    const remaining = stored?.expiresAt ? stored.expiresAt.getTime() - Date.now() : 0;
    if (stored && remaining > REFRESH_WHEN_LESS_THAN_MS) {
      return {
        ok: true,
        token: stored.token,
        reused: true,
        expiresAt: stored.expiresAt,
        profileReset: false,
        needsManualLogin: false,
        error: null,
      };
    }
  }

  if (!(await hasStockxProfile())) {
    return {
      ok: false,
      token: null,
      reused: false,
      expiresAt: null,
      profileReset: false,
      needsManualLogin: true,
      error: "No persistent StockX browser profile. Log in once on the server to create it.",
    };
  }

  const snapshot = await backupAuthFiles();
  const request = new NextRequest("http://internal/api/stockx/playwright", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      headless: true,
      persistent: true,
      forceLogin: false,
      reuseTokenFile: !force,
      autoNavigate: true,
      allowProfileReset: false,
      // Only Chromium is installed in the container image.
      browser: "chromium",
      startUrl: "https://stockx.com/buying/orders",
      maxWaitMs: Math.min(Number(options.maxWaitMs ?? 120000), 300000),
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
