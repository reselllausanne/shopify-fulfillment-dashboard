/**
 * Shopify StockX batch buy — bandwidth-safe.
 *
 * Rules:
 * 1. Prefer DIRECT browser when Auth0/session warm (STOCKX_BROWSER_PROXY_MODE=on_fail).
 *    Proxy only if direct hits CF — ONE sticky max for whole batch.
 * 2. On CF: sit ≤45s then abort item — NO sticky-rotate storm loading challenge JS.
 * 3. One persistent browser session for the whole batch.
 * 4. desiredLane forced STANDARD + selectAndVerifyStockxLane.
 * 5. Stop batch on LemonPrime 402 (quota).
 *
 * Default dryRun=true — never Place Order unless confirmLive / --go.
 */
import { prisma } from "@/app/lib/prisma";
import { pageLooksLikeCloudflare } from "@/lib/stockxAutoLogin";
import {
  nextStockxPlaywrightProxy,
  stockxBrowserProxyMode,
  type PlaywrightProxyConfig,
} from "@/lib/stockxPlaywrightProxy";
import {
  launchStockxContext,
  runStockxAutoCheckoutForOrder,
  type StockxAutoCheckoutResult,
} from "@/lib/stockxCheckout";
import { buildStockxBuyUrl } from "@/lib/stockxAutoCheckout/sizeUsFallback";
import { MAX_ALL_IN_CHF } from "@/lib/stockxAutoCheckout/types";
import type { BrowserContext, Page } from "playwright";

/** Sit on CF then abort — never rotate through 20 stickies. */
const CF_ABORT_MS = 45_000;
const CF_PROBE_MS = 8_000;

export type ShopifyBatchBuyItem = {
  orderName: string;
  slug: string;
  sizeEU: string;
  lineItemId?: string | null;
};

export type ShopifyBatchBuyItemResult = {
  orderName: string;
  slug: string;
  sizeEU: string;
  stickyRotates: number;
  proxyLabel: string | null;
  navMethod?: "soft_search" | "hard_goto" | "cf" | "skipped" | "direct";
  result: StockxAutoCheckoutResult | { kind: "aborted"; reason: string; detail?: string };
};

export type ShopifyBatchBuySummary = {
  dryRun: boolean;
  desiredLane: "STANDARD";
  attempted: number;
  bought: number;
  aborted: number;
  skipped: number;
  needsHuman: number;
  stoppedOn402: boolean;
  items: ShopifyBatchBuyItemResult[];
};

type LiveSession = {
  ctx: BrowserContext;
  page: Page;
  proxy: PlaywrightProxyConfig | null;
  /** 0 = direct; 1 = one sticky fallback for whole batch. */
  stickyUsed: number;
};

class Proxy402Error extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "Proxy402Error";
  }
}

function looksProxy402(msg: string): boolean {
  return /\b402\b|payment required|quota|bandwidth|out of credit|insufficient/i.test(msg);
}

async function isCf(page: Page): Promise<boolean> {
  const title = await page.title().catch(() => "");
  const body = (await page.locator("body").innerText().catch(() => "")) || "";
  return pageLooksLikeCloudflare(page.url(), title, body);
}

/** Sit still on CF up to CF_ABORT_MS; return true if cleared. */
async function sitCfOrAbort(page: Page, budgetMs = CF_ABORT_MS): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < budgetMs) {
    if (!(await isCf(page))) return true;
    await page.waitForTimeout(2000);
  }
  return !(await isCf(page));
}

async function warmBuyingOrders(page: Page): Promise<{ ok: boolean; cf: boolean }> {
  try {
    await page.goto("https://stockx.com/buying/orders", {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (looksProxy402(msg)) throw new Proxy402Error(msg);
  }
  await page.waitForTimeout(Math.min(CF_PROBE_MS, 6_000));
  if (await isCf(page)) {
    const cleared = await sitCfOrAbort(page, CF_ABORT_MS);
    return { ok: cleared, cf: !cleared };
  }
  return { ok: true, cf: false };
}

async function softNavToPdp(
  page: Page,
  slug: string,
  sizeUS?: string | null
): Promise<{ ok: boolean; method: "soft_search" | "hard_goto" | "cf" }> {
  const productUrl = buildStockxBuyUrl(slug, sizeUS);
  const slugTail = slug.split("/").filter(Boolean).pop() || slug;

  try {
    const search = page
      .locator(
        'input[type="search"], input[placeholder*="Search" i], input[placeholder*="Rechercher" i], input[name="q"]'
      )
      .first();
    if (await search.isVisible({ timeout: 1500 }).catch(() => false)) {
      await search.click({ timeout: 2000 });
      await search.fill("");
      await search.type(slugTail.replace(/-/g, " ").slice(0, 48), { delay: 25 });
      await page.waitForTimeout(900);
      const link = page.locator(`a[href*="/${slugTail}"]`).first();
      if (await link.isVisible({ timeout: 2500 }).catch(() => false)) {
        await link.click();
        await page.waitForTimeout(2000);
        if (await isCf(page)) {
          const cleared = await sitCfOrAbort(page, CF_ABORT_MS);
          if (!cleared) return { ok: false, method: "cf" };
        }
        if (page.url().includes(slugTail)) return { ok: true, method: "soft_search" };
      }
    }
  } catch (e: any) {
    if (looksProxy402(String(e?.message || e))) throw new Proxy402Error(String(e?.message || e));
  }

  try {
    await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  } catch (e: any) {
    if (looksProxy402(String(e?.message || e))) throw new Proxy402Error(String(e?.message || e));
  }
  await page.waitForTimeout(2500);
  if (await isCf(page)) {
    const cleared = await sitCfOrAbort(page, CF_ABORT_MS);
    if (!cleared) return { ok: false, method: "cf" };
  }
  return { ok: true, method: "hard_goto" };
}

async function openSession(opts: {
  proxy: PlaywrightProxyConfig | null;
  stickyUsed: number;
}): Promise<LiveSession> {
  if (opts.proxy) {
    console.log(
      `[SHOPIFY-BATCH-BUY] launch sticky proxy=${opts.proxy.label} (fallback after direct CF)`
    );
  } else {
    console.log(
      `[SHOPIFY-BATCH-BUY] launch DIRECT (mode=${stockxBrowserProxyMode()}) — prefer warm Auth0 session`
    );
  }
  const launched = await launchStockxContext({
    proxy: opts.proxy,
    useStickyProxy: Boolean(opts.proxy),
  });
  return {
    ctx: launched.ctx,
    page: launched.page,
    proxy: launched.proxy,
    stickyUsed: opts.stickyUsed,
  };
}

/**
 * Direct first. Only if /buying/orders stuck on CF → ONE sticky for whole batch.
 * Never rotate stickies on CF (GB killer).
 */
async function ensureWarmSession(): Promise<LiveSession> {
  // Never force MODE=always here — that burned ~10GB via challenges.cloudflare.com.
  let session = await openSession({ proxy: null, stickyUsed: 0 });
  let warm = await warmBuyingOrders(session.page);

  if (warm.cf && stockxBrowserProxyMode() !== "off") {
    console.warn(
      "[SHOPIFY-BATCH-BUY] direct CF after ≤45s sit — trying ONE sticky (no rotate storm)"
    );
    await session.ctx.close().catch(() => undefined);
    const sticky = nextStockxPlaywrightProxy();
    if (!sticky) {
      throw new Error("Direct CF and no LemonPrime sticky in pool — abort batch");
    }
    session = await openSession({ proxy: sticky, stickyUsed: 1 });
    warm = await warmBuyingOrders(session.page);
  }

  if (warm.cf) {
    await session.ctx.close().catch(() => undefined);
    throw new Error(
      "Cloudflare/Turnstile after direct + one sticky (≤45s sit each) — abort batch, no further rotates"
    );
  }
  return session;
}

async function alreadyMatchedOrder(orderName: string): Promise<string | null> {
  const name = orderName.startsWith("#") ? orderName : `#${orderName}`;
  const hit = await prisma.orderMatch.findFirst({
    where: { shopifyOrderName: name, stockxOrderNumber: { not: "" } },
    select: { stockxOrderNumber: true },
  });
  const n = hit?.stockxOrderNumber?.trim();
  return n || null;
}

/**
 * Sequential Shopify buys on one session (direct or one sticky).
 * dryRun default true; confirmLive/GO required to Place Order.
 */
export async function runShopifyBatchBuy(options: {
  items: ShopifyBatchBuyItem[];
  dryRun?: boolean;
  /** Must be true to Place Order. */
  confirmLive?: boolean;
  maxAllInChf?: number;
}): Promise<ShopifyBatchBuySummary> {
  const dryRun = options.confirmLive === true ? false : options.dryRun !== false;
  const desiredLane = "STANDARD" as const;
  const maxAllInChf = Math.min(MAX_ALL_IN_CHF, Number(options.maxAllInChf ?? MAX_ALL_IN_CHF));

  const out: ShopifyBatchBuyItemResult[] = [];
  let bought = 0;
  let aborted = 0;
  let skipped = 0;
  let needsHuman = 0;
  let stoppedOn402 = false;

  let session: LiveSession | null = null;
  try {
    session = await ensureWarmSession();

    for (const item of options.items) {
      const orderName = item.orderName.startsWith("#")
        ? item.orderName
        : `#${item.orderName}`;
      const slug = item.slug.trim();
      const sizeEU = item.sizeEU.trim();

      const matched = await alreadyMatchedOrder(orderName);
      if (matched) {
        skipped += 1;
        out.push({
          orderName,
          slug,
          sizeEU,
          stickyRotates: session.stickyUsed,
          proxyLabel: session.proxy?.label ?? null,
          navMethod: "skipped",
          result: {
            kind: "skipped",
            reason: "already_matched",
            detail: matched,
            needsHuman: null,
          },
        });
        continue;
      }

      let nav: { ok: boolean; method: "soft_search" | "hard_goto" | "cf" };
      try {
        nav = await softNavToPdp(session.page, slug, null);
      } catch (e) {
        if (e instanceof Proxy402Error) {
          stoppedOn402 = true;
          aborted += 1;
          out.push({
            orderName,
            slug,
            sizeEU,
            stickyRotates: session.stickyUsed,
            proxyLabel: session.proxy?.label ?? null,
            navMethod: "cf",
            result: { kind: "aborted", reason: "proxy_402", detail: e.message },
          });
          console.error("[SHOPIFY-BATCH-BUY] LemonPrime 402 — STOP batch");
          break;
        }
        throw e;
      }

      if (!nav.ok) {
        // One sticky fallback for whole batch if still on direct.
        if (session.stickyUsed === 0 && stockxBrowserProxyMode() !== "off") {
          console.warn(
            `[SHOPIFY-BATCH-BUY] CF on ${orderName} via direct — switching to ONE sticky for rest of batch`
          );
          await session.ctx.close().catch(() => undefined);
          const sticky = nextStockxPlaywrightProxy();
          if (!sticky) {
            aborted += 1;
            out.push({
              orderName,
              slug,
              sizeEU,
              stickyRotates: 0,
              proxyLabel: null,
              navMethod: "cf",
              result: {
                kind: "aborted",
                reason: "cf_no_sticky",
                detail: "CF on direct; no sticky left",
              },
            });
            continue;
          }
          session = await openSession({ proxy: sticky, stickyUsed: 1 });
          const warm = await warmBuyingOrders(session.page);
          if (warm.cf) {
            aborted += 1;
            out.push({
              orderName,
              slug,
              sizeEU,
              stickyRotates: 1,
              proxyLabel: session.proxy?.label ?? null,
              navMethod: "cf",
              result: {
                kind: "aborted",
                reason: "cf_sticky_abort",
                detail: "CF after ≤45s on one sticky — abort item (no rotate)",
              },
            });
            continue;
          }
          nav = await softNavToPdp(session.page, slug, null);
        }
      }

      if (!nav.ok) {
        aborted += 1;
        out.push({
          orderName,
          slug,
          sizeEU,
          stickyRotates: session.stickyUsed,
          proxyLabel: session.proxy?.label ?? null,
          navMethod: "cf",
          result: {
            kind: "aborted",
            reason: "cf_abort_45s",
            detail: "CF after ≤45s sit — abort item, no sticky rotate",
          },
        });
        await warmBuyingOrders(session.page).catch(() => undefined);
        continue;
      }

      const result = await runStockxAutoCheckoutForOrder({
        orderName,
        lineItemId: item.lineItemId,
        slug,
        sizeEUOverride: sizeEU,
        maxAllInChf,
        dryRun,
        desiredLane,
        reuse: { ctx: session.ctx, page: session.page },
        skipGoto: true,
      });

      if (result.kind === "easy_buy") bought += 1;
      else if (result.kind === "skipped") skipped += 1;
      else needsHuman += 1;

      out.push({
        orderName,
        slug,
        sizeEU,
        stickyRotates: session.stickyUsed,
        proxyLabel: session.proxy?.label ?? null,
        navMethod: session.proxy ? nav.method : "direct",
        result,
      });

      // Soft reset to buying/orders between SKUs (keep same session).
      await warmBuyingOrders(session.page).catch((e: any) => {
        if (looksProxy402(String(e?.message || e))) {
          stoppedOn402 = true;
          console.error("[SHOPIFY-BATCH-BUY] LemonPrime 402 mid-batch — STOP");
        }
      });
      if (stoppedOn402) break;
    }
  } catch (e: any) {
    if (e instanceof Proxy402Error || looksProxy402(String(e?.message || e))) {
      stoppedOn402 = true;
      console.error("[SHOPIFY-BATCH-BUY] LemonPrime 402 — STOP batch", e?.message || e);
    } else {
      throw e;
    }
  } finally {
    await session?.ctx.close().catch(() => undefined);
  }

  return {
    dryRun,
    desiredLane,
    attempted: out.length,
    bought,
    aborted,
    skipped,
    needsHuman,
    stoppedOn402,
    items: out,
  };
}

/** Planned Oct Shopify STANDARD cohort (excl Mercurial #7424, Essentials #7513). */
export const SHOPIFY_STANDARD_BATCH_13: ShopifyBatchBuyItem[] = [
  { orderName: "#7297", slug: "nike-air-max-270-react-eng-watermelon", sizeEU: "43" },
  { orderName: "#7298", slug: "nike-air-max-plus-triple-black-gs", sizeEU: "39" },
  { orderName: "#7302", slug: "nike-air-max-pulse-black-grey-laser-blue", sizeEU: "47" },
  {
    orderName: "#7392",
    slug: "adidas-sl-72-rs-grey-cloud-white-crystal-white",
    sizeEU: "43 1/3",
  },
  {
    orderName: "#7433",
    slug: "nike-dunk-low-retro-khaki-team-red-pearl-white-womens",
    sizeEU: "37.5",
  },
  {
    orderName: "#7537",
    slug: "adidas-adi-racer-lo-core-black-silver-metallic-womens",
    sizeEU: "43 1/3",
  },
  { orderName: "#7538", slug: "puma-stewie-4-timeless-womens", sizeEU: "40" },
  {
    orderName: "#7535",
    slug: "adidas-handball-spezial-aurora-ivy-ash-green-womens",
    sizeEU: "36 2/3",
  },
  {
    orderName: "#7540",
    slug: "nike-air-force-1-low-cow-print-field-brown-womens",
    sizeEU: "36.5",
  },
  { orderName: "#7532", slug: "adidas-la-trainer-weave-triple-black", sizeEU: "44 2/3" },
  {
    orderName: "#7542",
    slug: "saucony-progrid-omni-9-white-black-silver-pink",
    sizeEU: "38",
  },
  { orderName: "#7536", slug: "adidas-ultra-boost-4-0-running-white", sizeEU: "42" },
  { orderName: "#7534", slug: "supreme-backpack-ss26-red-camo", sizeEU: "OS" },
];

/** User GO cohort 2026-10-24 (9 STANDARD BUY_OK). */
export const SHOPIFY_BUY_OK_9: ShopifyBatchBuyItem[] = [
  { orderName: "#7298", slug: "nike-air-max-plus-triple-black-gs", sizeEU: "39" },
  { orderName: "#7302", slug: "nike-air-max-pulse-black-grey-laser-blue", sizeEU: "47" },
  { orderName: "#7538", slug: "puma-stewie-4-timeless-womens", sizeEU: "40" },
  {
    orderName: "#7535",
    slug: "adidas-handball-spezial-aurora-ivy-ash-green-womens",
    sizeEU: "36 2/3",
  },
  {
    orderName: "#7540",
    slug: "nike-air-force-1-low-cow-print-field-brown-womens",
    sizeEU: "36.5",
  },
  { orderName: "#7532", slug: "adidas-la-trainer-weave-triple-black", sizeEU: "44 2/3" },
  {
    orderName: "#7542",
    slug: "saucony-progrid-omni-9-white-black-silver-pink",
    sizeEU: "38",
  },
  { orderName: "#7536", slug: "adidas-ultra-boost-4-0-running-white", sizeEU: "42" },
  { orderName: "#7534", slug: "supreme-backpack-ss26-red-camo", sizeEU: "OS" },
];
