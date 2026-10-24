/**
 * Shopify StockX batch buy — fast path vs cold PDP Turnstile hell.
 *
 * Rules:
 * 1. LemonPrime sticky from first navigation; warm /buying/orders before PDP
 * 2. Fail fast: max 2 sticky rotates then abort item (no 30min loops)
 * 3. Soft nav search→PDP when possible (hard goto only as fallback)
 * 4. One browser session for the whole batch (no relaunch per SKU)
 * 5. desiredLane forced STANDARD + selectAndVerifyStockxLane
 *
 * Default dryRun=true — never Place Order unless confirmLive / --go.
 */
import { prisma } from "@/app/lib/prisma";
import { pageLooksLikeCloudflare } from "@/lib/stockxAutoLogin";
import {
  nextStockxPlaywrightProxy,
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

const MAX_STICKY_ROTATES = 2;
const CF_PROBE_MS = 12_000;

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
  navMethod?: "soft_search" | "hard_goto" | "cf" | "skipped";
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
  items: ShopifyBatchBuyItemResult[];
};

type LiveSession = {
  ctx: BrowserContext;
  page: Page;
  proxy: PlaywrightProxyConfig | null;
  rotatesUsed: number;
};

async function isCf(page: Page): Promise<boolean> {
  const title = await page.title().catch(() => "");
  const body = (await page.locator("body").innerText().catch(() => "")) || "";
  return pageLooksLikeCloudflare(page.url(), title, body);
}

async function warmBuyingOrders(page: Page): Promise<{ ok: boolean; cf: boolean }> {
  try {
    await page.goto("https://stockx.com/buying/orders", {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
  } catch {
    // network/timeout — still probe CF
  }
  await page.waitForTimeout(Math.min(CF_PROBE_MS, 8_000));
  const cf = await isCf(page);
  return { ok: !cf, cf };
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
        if (await isCf(page)) return { ok: false, method: "cf" };
        if (page.url().includes(slugTail)) return { ok: true, method: "soft_search" };
      }
    }
  } catch {
    // fall through
  }

  try {
    await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  } catch {
    // ignore
  }
  await page.waitForTimeout(2500);
  if (await isCf(page)) return { ok: false, method: "cf" };
  return { ok: true, method: "hard_goto" };
}

async function openStickySession(
  rotatesUsed = 0,
  proxy?: PlaywrightProxyConfig | null
): Promise<LiveSession> {
  const sticky = proxy === undefined ? nextStockxPlaywrightProxy() : proxy;
  if (sticky) {
    console.log(
      `[SHOPIFY-BATCH-BUY] sticky${rotatesUsed ? ` rotate=${rotatesUsed}` : "-first"} proxy=${sticky.label}`
    );
  } else {
    console.warn("[SHOPIFY-BATCH-BUY] no proxy pool — direct launch (CF risk)");
  }
  const launched = await launchStockxContext({
    proxy: sticky,
    useStickyProxy: Boolean(sticky),
  });
  return {
    ctx: launched.ctx,
    page: launched.page,
    proxy: launched.proxy,
    rotatesUsed,
  };
}

async function rotateSticky(session: LiveSession): Promise<LiveSession> {
  await session.ctx.close().catch(() => undefined);
  if (session.rotatesUsed >= MAX_STICKY_ROTATES) {
    throw new Error(`Sticky rotate budget exhausted (max ${MAX_STICKY_ROTATES})`);
  }
  const next = nextStockxPlaywrightProxy();
  if (!next) throw new Error("No LemonPrime/StockX sticky left in pool");
  console.warn(
    `[SHOPIFY-BATCH-BUY] sticky rotate ${session.rotatesUsed + 1}/${MAX_STICKY_ROTATES} → ${next.label}`
  );
  const launched = await openStickySession(session.rotatesUsed + 1, next);
  await warmBuyingOrders(launched.page);
  return launched;
}

async function ensureWarmSession(): Promise<LiveSession> {
  process.env.STOCKX_BROWSER_PROXY_MODE = "always";
  let session = await openStickySession(0);
  let warm = await warmBuyingOrders(session.page);
  while (warm.cf && session.rotatesUsed < MAX_STICKY_ROTATES) {
    session = await rotateSticky(session);
    warm = await warmBuyingOrders(session.page);
  }
  if (warm.cf) {
    await session.ctx.close().catch(() => undefined);
    throw new Error(
      `Cloudflare/Turnstile after ${MAX_STICKY_ROTATES} sticky rotates on /buying/orders — abort batch`
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
 * Sequential Shopify buys on one sticky session.
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
          stickyRotates: session.rotatesUsed,
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

      let nav = await softNavToPdp(session.page, slug, null);
      while (!nav.ok && nav.method === "cf" && session.rotatesUsed < MAX_STICKY_ROTATES) {
        session = await rotateSticky(session);
        nav = await softNavToPdp(session.page, slug, null);
      }
      if (!nav.ok) {
        aborted += 1;
        out.push({
          orderName,
          slug,
          sizeEU,
          stickyRotates: session.rotatesUsed,
          proxyLabel: session.proxy?.label ?? null,
          navMethod: "cf",
          result: {
            kind: "aborted",
            reason: "cf_sticky_exhausted",
            detail: `CF after ${session.rotatesUsed} sticky rotates (max ${MAX_STICKY_ROTATES})`,
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
        stickyRotates: session.rotatesUsed,
        proxyLabel: session.proxy?.label ?? null,
        navMethod: nav.method,
        result,
      });

      // Soft reset to buying/orders between SKUs (keep same sticky session).
      await warmBuyingOrders(session.page).catch(() => undefined);
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
