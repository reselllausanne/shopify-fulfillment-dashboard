/**
 * Vacation warm browser: long-lived headed Chromium per StockX account on Xvfb.
 * Cron remint attaches via CDP (ports 9222 / 9223) instead of cold launch → Turnstile.
 *
 * Usage:
 *   npx tsx scripts/stockx-warm-daemon.ts              # both accounts
 *   npx tsx scripts/stockx-warm-daemon.ts default
 *   npx tsx scripts/stockx-warm-daemon.ts galaxus
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  clearStockxForceLoginTransactions,
  pageLooksLikeCloudflare,
  softNavigateForSilentRemint,
  waitForCookieSessionWarm,
} from "@/lib/stockxAutoLogin";
import {
  isFreshStockxAccessToken,
  trySilentAuth0CodeRemint,
  writeStockxTokenFile,
} from "@/lib/stockxSilentAuth0";
import {
  launchWarmPersistentContext,
  markWarmKeepAlive,
  markWarmToken,
  type StockxWarmAccount,
} from "@/lib/stockxWarmBrowser";
import { hasStockxProfile, stockxAccountFiles } from "@/lib/stockxSessionRefresh";

const KEEP_ALIVE_MS = 90 * 60 * 1000;
const DATA = path.join(process.cwd(), ".data");

function accountsFromArg(): StockxWarmAccount[] {
  const a = String(process.argv[2] || "both").toLowerCase();
  if (a === "default" || a === "shopify") return ["default"];
  if (a === "galaxus") return ["galaxus"];
  return ["default", "galaxus"];
}

async function harvestToken(context: Awaited<
  ReturnType<typeof launchWarmPersistentContext>
>["context"]): Promise<string | null> {
  for (const c of await context.cookies()) {
    if (c.name === "token" && isFreshStockxAccessToken(c.value)) return c.value;
  }
  return null;
}

async function runAccount(account: StockxWarmAccount): Promise<void> {
  if (!(await hasStockxProfile(account))) {
    console.warn(`[warm-daemon] skip account=${account} — no profile`);
    return;
  }
  const files = stockxAccountFiles(account);
  const { context } = await launchWarmPersistentContext({ account, reclaim: true });
  let page = context.pages()[0] || (await context.newPage());

  let lastCaptured: string | null = null;
  context.on("request", (req) => {
    const auth = req.headers()["authorization"];
    if (!auth) return;
    const tok = auth.replace(/^Bearer\s+/i, "").trim();
    if (isFreshStockxAccessToken(tok)) lastCaptured = tok;
  });

  const mintOnce = async (reason: string) => {
    console.log(`[warm-daemon] mint account=${account} reason=${reason}`);
    await clearStockxForceLoginTransactions(context).catch(() => undefined);
    if (page.isClosed()) page = await context.newPage();
    await page.goto("https://stockx.com/buying/orders", {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    }).catch((e) => console.warn(`[warm-daemon] goto`, e?.message || e));

    const warm = await waitForCookieSessionWarm(page, {
      timeoutMs: 240_000,
      hasToken: () => Boolean(lastCaptured),
    });
    console.log(`[warm-daemon] warm=${warm}`);

    if (!lastCaptured) {
      await softNavigateForSilentRemint(page, {
        hasToken: () => Boolean(lastCaptured),
        perUrlWaitMs: 8_000,
      });
    }
    if (!lastCaptured) {
      lastCaptured = await harvestToken(context);
    }
    if (!lastCaptured) {
      const title = await page.title().catch(() => "");
      const body = (await page.locator("body").innerText().catch(() => "")) || "";
      if (!pageLooksLikeCloudflare(page.url(), title, body)) {
        const silent = await trySilentAuth0CodeRemint(page, { timeoutMs: 45_000 });
        if (silent.token) {
          lastCaptured = silent.token;
          await writeStockxTokenFile(files.tokenFile, silent.token, {
            refreshToken: silent.refreshToken,
            source: "warm-daemon-silent-auth0",
          });
        } else {
          console.warn(`[warm-daemon] silent Auth0 missed: ${silent.error}`);
        }
      }
    }
    if (lastCaptured) {
      await writeStockxTokenFile(files.tokenFile, lastCaptured, { source: "warm-daemon" });
      await context.storageState({ path: files.sessionFile }).catch(() => undefined);
      await markWarmToken(account);
      console.log(`[warm-daemon] token ok account=${account}`);
    } else {
      console.warn(`[warm-daemon] no token yet account=${account} — sitting for VNC/CF`);
      await page
        .screenshot({ path: path.join(DATA, `warm-daemon-${account}.png`), fullPage: true })
        .catch(() => undefined);
    }
    await markWarmKeepAlive(account);
  };

  await mintOnce("startup");

  // Keep process alive; soft keep-alive every 90m
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await new Promise((r) => setTimeout(r, KEEP_ALIVE_MS));
    lastCaptured = null;
    await mintOnce("keepalive");
  }
}

async function main() {
  if (!process.env.DISPLAY) process.env.DISPLAY = ":99";
  const accounts = accountsFromArg();
  console.log(`[warm-daemon] DISPLAY=${process.env.DISPLAY} accounts=${accounts.join(",")}`);
  // Sequential launch on shared Xvfb, then both loops would need parallel — run one process per account via compose.
  // Here: start all accounts in parallel after launches.
  await Promise.all(accounts.map((a) => runAccount(a)));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
