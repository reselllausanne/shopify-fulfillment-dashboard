/**
 * Long-lived StockX Chromium (CDP) so remint never cold-launches into Turnstile.
 * Ports: default=9222, galaxus=9223. State: .data/stockx-warm-{account}.json
 */
import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { isChromeUsingProfile, killChromeForUserDataDir } from "@/lib/stockxBrowserProcess";
import {
  nextStockxPlaywrightProxy,
  stockxBrowserProxyMode,
} from "@/lib/stockxPlaywrightProxy";

const DATA_DIR = path.join(process.cwd(), ".data");

export type StockxWarmAccount = "default" | "galaxus";

export type StockxWarmState = {
  account: StockxWarmAccount;
  cdpUrl: string;
  port: number;
  profileDir: string;
  pid?: number;
  startedAt: string;
  updatedAt: string;
  lastKeepAliveAt?: string | null;
  lastTokenAt?: string | null;
};

const CDP_PORTS: Record<StockxWarmAccount, number> = {
  default: 9222,
  galaxus: 9223,
};

export function stockxWarmProfileDir(account: StockxWarmAccount): string {
  return path.join(
    DATA_DIR,
    account === "galaxus" ? "stockx-profile-galaxus" : "stockx-profile"
  );
}

export function stockxWarmStatePath(account: StockxWarmAccount): string {
  return path.join(DATA_DIR, `stockx-warm-${account}.json`);
}

export function stockxCdpPort(account: StockxWarmAccount): number {
  return CDP_PORTS[account];
}

export async function readWarmState(account: StockxWarmAccount): Promise<StockxWarmState | null> {
  try {
    const raw = await fs.readFile(stockxWarmStatePath(account), "utf8");
    return JSON.parse(raw) as StockxWarmState;
  } catch {
    return null;
  }
}

export async function writeWarmState(state: StockxWarmState): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(
    stockxWarmStatePath(state.account),
    `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8"
  );
}

async function cdpAlive(cdpUrl: string): Promise<boolean> {
  try {
    const res = await fetch(new URL("/json/version", cdpUrl).toString(), {
      signal: AbortSignal.timeout(2500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Connect to an already-warm Chromium if CDP answers. */
export async function connectWarmBrowser(
  account: StockxWarmAccount
): Promise<{ browser: Browser; context: BrowserContext; cdpUrl: string } | null> {
  const state = await readWarmState(account);
  const port = state?.port ?? stockxCdpPort(account);
  const cdpUrl = state?.cdpUrl || `http://127.0.0.1:${port}`;
  if (!(await cdpAlive(cdpUrl))) return null;
  try {
    const browser = await chromium.connectOverCDP(cdpUrl);
    const context = browser.contexts()[0] || (await browser.newContext());
    console.log(`[STOCKX-WARM] attached CDP account=${account} ${cdpUrl}`);
    return { browser, context, cdpUrl };
  } catch (err: any) {
    console.warn(`[STOCKX-WARM] CDP attach failed account=${account}`, err?.message || err);
    return null;
  }
}

export type LaunchWarmOptions = {
  account: StockxWarmAccount;
  /** Kill existing Chromium on this profile before launch. */
  reclaim?: boolean;
  userAgent?: string;
};

/**
 * Launch headed persistent Chromium with remote debugging and record CDP state.
 * Caller owns the context lifecycle (daemon keeps it; remint may leaveWarm).
 */
export async function launchWarmPersistentContext(options: LaunchWarmOptions): Promise<{
  context: BrowserContext;
  cdpUrl: string;
  port: number;
}> {
  const account = options.account;
  const profileDir = stockxWarmProfileDir(account);
  const port = stockxCdpPort(account);
  const cdpUrl = `http://127.0.0.1:${port}`;
  if (!process.env.DISPLAY) process.env.DISPLAY = ":99";

  if (options.reclaim || (await isChromeUsingProfile(profileDir))) {
    const killed = await killChromeForUserDataDir(profileDir);
    if (killed > 0) console.log(`[STOCKX-WARM] reclaimed ${killed} pid(s) on ${profileDir}`);
  }

  await fs.mkdir(profileDir, { recursive: true });
  const userAgent =
    options.userAgent ||
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

  // Optional residential proxy when STOCKX_BROWSER_PROXY_MODE=always (CF clearer than VPS IP).
  // on_fail leaves warm on direct IP; remint falls back to ephemeral proxy path instead.
  const proxy =
    stockxBrowserProxyMode() === "always" ? nextStockxPlaywrightProxy() : null;
  if (proxy) console.log(`[STOCKX-WARM] launch proxy=${proxy.label}`);

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      `--remote-debugging-port=${port}`,
      "--remote-debugging-address=127.0.0.1",
      "--window-size=1440,900",
    ],
    locale: "fr-FR",
    timezoneId: "Europe/Zurich",
    viewport: { width: 1440, height: 900 },
    userAgent,
    ...(proxy
      ? {
          proxy: {
            server: proxy.server,
            username: proxy.username,
            password: proxy.password,
          },
        }
      : {}),
    env: {
      ...process.env,
      DISPLAY: process.env.DISPLAY || ":99",
    },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  await writeWarmState({
    account,
    cdpUrl,
    port,
    profileDir,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastKeepAliveAt: null,
    lastTokenAt: null,
  });
  console.log(`[STOCKX-WARM] launched account=${account} cdp=${cdpUrl}`);
  return { context, cdpUrl, port };
}

export async function markWarmKeepAlive(account: StockxWarmAccount): Promise<void> {
  const state = (await readWarmState(account)) || {
    account,
    cdpUrl: `http://127.0.0.1:${stockxCdpPort(account)}`,
    port: stockxCdpPort(account),
    profileDir: stockxWarmProfileDir(account),
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await writeWarmState({
    ...state,
    lastKeepAliveAt: new Date().toISOString(),
  });
}

export async function markWarmToken(account: StockxWarmAccount): Promise<void> {
  const state = await readWarmState(account);
  if (!state) return;
  await writeWarmState({ ...state, lastTokenAt: new Date().toISOString() });
}
