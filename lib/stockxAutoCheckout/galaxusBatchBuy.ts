/**
 * Galaxus StockX batch buy — EXPRESS-first HARD RULE (not Shopify Express).
 *
 * Session/proxy rules mirror shopifyBatchBuy (direct → one sticky, no rotate storm).
 * Default dryRun=true — never Place Order unless confirmLive / --go.
 */
import { pageLooksLikeCloudflare } from "@/lib/stockxAutoLogin";
import {
  nextStockxPlaywrightProxy,
  stockxBrowserProxyMode,
  type PlaywrightProxyConfig,
} from "@/lib/stockxPlaywrightProxy";
import {
  launchStockxContext,
  runStockxAutoCheckoutForGalaxusLine,
  type GalaxusAutoCheckoutResult,
} from "@/lib/stockxCheckout";
import {
  buildStockxCheckoutBuyUrl,
  convertEuToUs,
  inferBrandFromTitle,
} from "@/lib/stockxAutoCheckout/sizeUsFallback";
import type { GalaxusBuyCandidate } from "@/lib/stockxAutoCheckout/galaxusBuyCandidates";
import { MAX_ALL_IN_CHF } from "@/lib/stockxAutoCheckout/types";
import type { BrowserContext, Page } from "playwright";

const CF_ABORT_MS = 45_000;
const CF_PROBE_MS = 8_000;
const CF_DIRECT_PROBE_MS = Math.max(
  4_000,
  Number(process.env.STOCKX_CF_DIRECT_PROBE_MS ?? "12000")
);

export type GalaxusBatchBuyItemResult = {
  galaxusOrderId: string;
  lineId: string;
  slug: string;
  sizeEU: string;
  stickyRotates: number;
  proxyLabel: string | null;
  result: GalaxusAutoCheckoutResult | { kind: "aborted"; reason: string; detail?: string };
};

export type GalaxusBatchBuySummary = {
  dryRun: boolean;
  lanePolicy: "galaxus_express_first";
  attempted: number;
  bought: number;
  aborted: number;
  skipped: number;
  needsHuman: number;
  stoppedOn402: boolean;
  bandwidthMb: number;
  items: GalaxusBatchBuyItemResult[];
};

type LiveSession = {
  ctx: BrowserContext;
  page: Page;
  proxy: PlaywrightProxyConfig | null;
  stickyUsed: number;
  bandwidthMb: () => number;
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

async function sitCfOrAbort(page: Page, budgetMs = CF_ABORT_MS): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < budgetMs) {
    if (!(await isCf(page))) return true;
    await page.waitForTimeout(2000);
  }
  return !(await isCf(page));
}

async function warmBuyingOrders(
  page: Page,
  cfBudgetMs = CF_ABORT_MS
): Promise<{ ok: boolean; cf: boolean }> {
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
    const cleared = await sitCfOrAbort(page, cfBudgetMs);
    return { ok: cleared, cf: !cleared };
  }
  return { ok: true, cf: false };
}

/**
 * Hard-goto StockX /buy/{slug}?size= — same action every buy.
 * Do NOT land on PDP without size (that forced page scrape + Buy Now).
 */
async function softNavToCheckout(
  page: Page,
  candidate: GalaxusBuyCandidate
): Promise<{ ok: boolean; method: string; checkoutUrl: string }> {
  const sizeUS =
    convertEuToUs(candidate.sizeEU, {
      title: candidate.productName,
      brand: inferBrandFromTitle(candidate.productName),
    }) || candidate.sizeEU;
  const checkoutUrl = buildStockxCheckoutBuyUrl(candidate.slug, sizeUS);
  try {
    await page.goto(checkoutUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  } catch (e: any) {
    if (looksProxy402(String(e?.message || e))) throw new Proxy402Error(String(e?.message || e));
  }
  await page.waitForTimeout(2500);
  if (await isCf(page)) {
    const cleared = await sitCfOrAbort(page, CF_ABORT_MS);
    if (!cleared) return { ok: false, method: "cf", checkoutUrl };
  }
  return { ok: true, method: "hard_buy_url", checkoutUrl };
}

async function openSession(opts: {
  proxy: PlaywrightProxyConfig | null;
  stickyUsed: number;
}): Promise<LiveSession> {
  console.log(
    opts.proxy
      ? `[GALAXUS-BATCH-BUY] launch sticky proxy=${opts.proxy.label}`
      : `[GALAXUS-BATCH-BUY] launch DIRECT (mode=${stockxBrowserProxyMode()})`
  );
  // Shared warm + softNav session MUST be galaxus profile end-to-end
  // (reuse in runStockxAutoCheckoutForGalaxusLine never re-launches).
  const launched = await launchStockxContext({
    account: "galaxus",
    proxy: opts.proxy,
    useStickyProxy: Boolean(opts.proxy),
  });
  return {
    ctx: launched.ctx,
    page: launched.page,
    proxy: launched.proxy,
    stickyUsed: opts.stickyUsed,
    bandwidthMb: () => launched.bandwidth.mb(),
  };
}

async function ensureWarmSession(): Promise<LiveSession> {
  let session = await openSession({ proxy: null, stickyUsed: 0 });
  let warm = await warmBuyingOrders(session.page, CF_DIRECT_PROBE_MS);

  if (warm.cf && stockxBrowserProxyMode() !== "off") {
    console.warn(
      `[GALAXUS-BATCH-BUY] direct CF after ≤${Math.round(CF_DIRECT_PROBE_MS / 1000)}s — ONE sticky`
    );
    await session.ctx.close().catch(() => undefined);
    const sticky = nextStockxPlaywrightProxy();
    if (!sticky) throw new Error("Direct CF and no sticky — abort Galaxus batch");
    session = await openSession({ proxy: sticky, stickyUsed: 1 });
    warm = await warmBuyingOrders(session.page);
    if (warm.cf) {
      await session.ctx.close().catch(() => undefined);
      throw new Error("CF on sole sticky — abort Galaxus batch (no rotate)");
    }
  } else if (warm.cf) {
    await session.ctx.close().catch(() => undefined);
    throw new Error("Direct CF and proxy mode=off — abort");
  }
  return session;
}

export async function runGalaxusBatchBuy(options: {
  candidates: GalaxusBuyCandidate[];
  dryRun?: boolean;
  confirmLive?: boolean;
  maxAllInChf?: number;
}): Promise<GalaxusBatchBuySummary> {
  const dryRun = options.confirmLive ? false : options.dryRun !== false;
  const maxAllInChf = Math.min(MAX_ALL_IN_CHF, Number(options.maxAllInChf ?? MAX_ALL_IN_CHF));
  const out: GalaxusBatchBuyItemResult[] = [];
  let bought = 0;
  let aborted = 0;
  let skipped = 0;
  let needsHuman = 0;
  let stoppedOn402 = false;
  let bandwidthMb = 0;
  let session: LiveSession | null = null;

  try {
    session = await ensureWarmSession();

    for (const candidate of options.candidates) {
      if (stoppedOn402) break;

      let nav: { ok: boolean; method: string };
      try {
        nav = await softNavToCheckout(session.page, candidate);
      } catch (e: any) {
        if (e instanceof Proxy402Error || looksProxy402(String(e?.message || e))) {
          stoppedOn402 = true;
          aborted += 1;
          out.push({
            galaxusOrderId: candidate.galaxusOrderId,
            lineId: candidate.lineId,
            slug: candidate.slug,
            sizeEU: candidate.sizeEU,
            stickyRotates: session.stickyUsed,
            proxyLabel: session.proxy?.label ?? null,
            result: { kind: "aborted", reason: "proxy_402", detail: String(e?.message || e) },
          });
          break;
        }
        throw e;
      }

      if (!nav.ok && session.stickyUsed === 0 && stockxBrowserProxyMode() !== "off") {
        console.warn(`[GALAXUS-BATCH-BUY] CF on ${candidate.slug} — switching to ONE sticky`);
        bandwidthMb += session.bandwidthMb();
        await session.ctx.close().catch(() => undefined);
        const sticky = nextStockxPlaywrightProxy();
        if (!sticky) {
          aborted += 1;
          out.push({
            galaxusOrderId: candidate.galaxusOrderId,
            lineId: candidate.lineId,
            slug: candidate.slug,
            sizeEU: candidate.sizeEU,
            stickyRotates: 0,
            proxyLabel: null,
            result: { kind: "aborted", reason: "cf_no_sticky" },
          });
          continue;
        }
        session = await openSession({ proxy: sticky, stickyUsed: 1 });
        const warm = await warmBuyingOrders(session.page);
        if (warm.cf) {
          aborted += 1;
          out.push({
            galaxusOrderId: candidate.galaxusOrderId,
            lineId: candidate.lineId,
            slug: candidate.slug,
            sizeEU: candidate.sizeEU,
            stickyRotates: 1,
            proxyLabel: session.proxy?.label ?? null,
            result: { kind: "aborted", reason: "cf_sticky_abort" },
          });
          break;
        }
        nav = await softNavToCheckout(session.page, candidate);
      }

      if (!nav.ok) {
        aborted += 1;
        out.push({
          galaxusOrderId: candidate.galaxusOrderId,
          lineId: candidate.lineId,
          slug: candidate.slug,
          sizeEU: candidate.sizeEU,
          stickyRotates: session.stickyUsed,
          proxyLabel: session.proxy?.label ?? null,
          result: { kind: "aborted", reason: "cf_abort_45s" },
        });
        if (session.stickyUsed >= 1) break;
        continue;
      }

      const result = await runStockxAutoCheckoutForGalaxusLine({
        candidate,
        maxAllInChf,
        dryRun,
        reuse: { ctx: session.ctx, page: session.page },
        skipGoto: true,
      });

      if (result.kind === "easy_buy" && !dryRun && result.stockxOrderNumber) bought += 1;
      else if (result.kind === "easy_buy" && dryRun) bought += 1;
      else if (result.kind === "skipped") skipped += 1;
      else needsHuman += 1;

      out.push({
        galaxusOrderId: candidate.galaxusOrderId,
        lineId: candidate.lineId,
        slug: candidate.slug,
        sizeEU: candidate.sizeEU,
        stickyRotates: session.stickyUsed,
        proxyLabel: session.proxy?.label ?? null,
        result,
      });

      await warmBuyingOrders(session.page).catch((e: any) => {
        if (looksProxy402(String(e?.message || e))) {
          stoppedOn402 = true;
          console.error("[GALAXUS-BATCH-BUY] LemonPrime 402 mid-batch — STOP");
        }
      });
    }
  } catch (e: any) {
    if (e instanceof Proxy402Error || looksProxy402(String(e?.message || e))) {
      stoppedOn402 = true;
      console.error("[GALAXUS-BATCH-BUY] LemonPrime 402 — STOP", e?.message || e);
    } else {
      throw e;
    }
  } finally {
    if (session) bandwidthMb += session.bandwidthMb();
    await session?.ctx.close().catch(() => undefined);
    console.log(
      `[GALAXUS-BATCH-BUY] transfer ~${bandwidthMb.toFixed(1)}MB bought=${bought} attempted=${out.length}`
    );
  }

  return {
    dryRun,
    lanePolicy: "galaxus_express_first",
    attempted: out.length,
    bought,
    aborted,
    skipped,
    needsHuman,
    stoppedOn402,
    bandwidthMb: Number(bandwidthMb.toFixed(1)),
    items: out,
  };
}
