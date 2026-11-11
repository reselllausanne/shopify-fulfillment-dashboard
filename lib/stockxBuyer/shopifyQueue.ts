/**
 * Shopify side of the unified queue: open paid orders with no StockX link, plus
 * cancelled StockX orders that deserve a rebuy.
 * Order lines are cached on disk: lines never change after the sale, and the Shopify
 * API throttle (~150 points) makes re-scanning 400+ orders take minutes.
 */
import path from "node:path";
import { prisma } from "@/app/lib/prisma";
import { isPackageProtectionShopifyLine } from "@/app/utils/matching";
import { detectShopifyExpress } from "@/lib/stockxAutoCheckout/detectShopifyExpress";
import { isClearlyNotStockxBuyable } from "@/lib/stockxAutoCheckout/nonStockxBuyable";
import { BUYER_DIR, readJson, writeJsonAtomic } from "@/lib/stockxBuyer/ledger";
import { jobKey, shouldRebuyCancelled } from "@/lib/stockxBuyer/policy";

export type ShopifyJob = {
  key: string;
  source: "shopify";
  orderName: string;
  orderRef: string;
  lineItemId: string | null;
  title: string;
  sku: string;
  slug: string;
  sizeEU: string;
  express: boolean;
  createdAt: number;
  saleChf: number | null;
  /** Rebuy of a cancelled StockX order (relink over the cancelled match). */
  rebuyOfCancelled: boolean;
};

export type CachedLine = {
  lineItemId: string | null;
  title: string;
  sku: string;
  sizeEU: string;
  express: boolean;
  skip: boolean;
  saleChf: number | null;
};

const LINES_CACHE = path.join(BUYER_DIR, "shopify-lines-cache.json");

export function normName(n: string): string {
  const t = String(n || "").trim();
  return t.startsWith("#") ? t : `#${t}`;
}

/**
 * Pure. Style ids are colour-coded (DM1275-250, HQ2592-005, 672521116-13), so the first
 * hyphen segment alone misses the KickDB row. Strip a trailing size, then try the full
 * id and progressively shorter hyphen prefixes.
 */
export function skuCandidates(raw: string): string[] {
  const sku = String(raw || "").trim();
  if (!sku) return [];
  const stripped = sku
    .replace(/-(\d{2}(?:\s*[12]\s*\/\s*3|\.\d+)?|OS)\s*$/i, "")
    .replace(/-(XX?S|S|M|L|XX?L|XXXL|[2-4]XL)\s*$/i, "");
  const parts = (stripped || sku).split("-").filter(Boolean);
  const out: string[] = [];
  for (let i = parts.length; i >= 1; i -= 1) out.push(parts.slice(0, i).join("-"));
  if (!out.includes(sku)) out.unshift(sku);
  return out;
}

export async function urlKeyForSku(sku: string): Promise<string | null> {
  for (const styleId of skuCandidates(sku)) {
    const product = await prisma.kickDBProduct.findFirst({
      where: { styleId: { equals: styleId, mode: "insensitive" }, urlKey: { not: null } },
      select: { urlKey: true },
      orderBy: { updatedAt: "desc" },
    });
    const urlKey = product?.urlKey?.trim();
    if (urlKey) return urlKey;
  }
  return null;
}

/** Pure: is this Shopify order worth a StockX buy? Paid, not cancelled, not fully refunded. */
export function orderIsBuyable(o: {
  financialStatus?: string | null;
  netSalesChf?: unknown;
  totalSalesChf?: unknown;
  refundedAmountChf?: unknown;
}): boolean {
  const fin = String(o.financialStatus || "").toUpperCase();
  if (fin.includes("REFUND") && !fin.includes("PARTIAL")) return false;
  const net = Number(o.netSalesChf ?? o.totalSalesChf ?? 0);
  const refunded = Number(o.refundedAmountChf ?? 0);
  const gross = Number(o.totalSalesChf ?? 0);
  if (!(net > 0)) return false;
  if (gross > 0 && refunded >= gross - 0.01) return false;
  return true;
}

type Cache = Record<string, { at: number; lines: CachedLine[] }>;

async function fetchLines(orderName: string): Promise<CachedLine[]> {
  const { POST } = await import("@/app/api/shopify/order-by-name/route");
  const res = await POST(
    new Request("http://local/api/shopify/order-by-name", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderName }),
    }) as any
  );
  const json: any = await res.json();
  const lines: any[] = Array.isArray(json?.lineItems) ? json.lineItems : [];
  return lines.map((line): CachedLine => {
    const title = String(line.title || "");
    const sku = String(line.sku || "").trim();
    const skip =
      isPackageProtectionShopifyLine(title, sku) ||
      Boolean(line.isStorePickup) ||
      (line.physicalStockQty != null && Number(line.physicalStockQty) > 0);
    return {
      lineItemId: String(line.lineItemId || "") || null,
      title,
      sku,
      sizeEU: String(line.sizeEU || line.variantTitle || "")
        .replace(/^EU\s*/i, "")
        .trim(),
      express: detectShopifyExpress({
        deliveryMode: line.deliveryMode ?? null,
        deliveryModeLabel: line.deliveryModeLabel ?? null,
        shippingLineTitles: line.shippingLineTitles ?? null,
      }),
      skip,
      saleChf:
        String(line.currencyCode || "CHF").toUpperCase() === "CHF" && Number.isFinite(Number(line.price))
          ? Number(line.price)
          : null,
    };
  });
}

/** Lines for an order, from cache when present. Throws on API failure (caller skips order this cycle). */
export async function loadOrderLines(orderName: string, cache: Cache): Promise<CachedLine[]> {
  const hit = cache[orderName];
  if (hit && hit.lines.length) return hit.lines;
  const lines = await fetchLines(orderName);
  if (lines.length) cache[orderName] = { at: Date.now(), lines };
  return lines;
}

async function lineAlreadyBought(lineItemId: string): Promise<string | null> {
  const ids = [lineItemId, lineItemId.replace(/\D/g, "")].filter(Boolean);
  const hit = await prisma.orderMatch.findFirst({
    where: {
      shopifyLineItemId: { in: ids },
      stockxOrderNumber: { not: "" },
      NOT: { stockxOrderNumber: { startsWith: "pp:" } },
    },
    select: { stockxOrderNumber: true, stockxStatus: true },
  });
  if (!hit?.stockxOrderNumber?.trim()) return null;
  const st = String(hit.stockxStatus ?? "").toUpperCase();
  // A cancelled StockX order is not "bought": the rebuy sweep owns it.
  if (st.includes("CANCEL") || st.includes("REFUND")) return null;
  return hit.stockxOrderNumber.trim();
}

export type BuildOpts = {
  since: Date;
  /** Restrict to these order names (#7661). */
  only?: Set<string> | null;
  /** Hard cap on Shopify API loads per call, to keep each cycle short. */
  maxApiLoads?: number;
  log?: (msg: string) => void;
};

/** Open Shopify lines that need a StockX buy. Oldest first (caller re-orders with Express). */
export async function buildShopifyJobs(opts: BuildOpts): Promise<ShopifyJob[]> {
  const log = opts.log ?? (() => undefined);
  const cache = await readJson<Cache>(LINES_CACHE, {});
  const names = opts.only ? Array.from(new Set([...opts.only].flatMap((n) => [n, n.replace(/^#/, ""), normName(n)]))) : null;
  const orders = await prisma.shopifyOrder.findMany({
    where: { createdAt: { gte: opts.since }, cancelledAt: null, ...(names ? { orderName: { in: names } } : {}) },
    select: {
      orderName: true,
      createdAt: true,
      netSalesChf: true,
      financialStatus: true,
      refundedAmountChf: true,
      totalSalesChf: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const linkedNames = new Set(
    (
      await prisma.orderMatch.findMany({
        where: {
          shopifyOrderName: { in: orders.map((o) => o.orderName) },
          stockxOrderNumber: { not: "" },
          NOT: { stockxOrderNumber: { startsWith: "pp:" } },
        },
        select: { shopifyOrderName: true },
      })
    ).map((m) => m.shopifyOrderName)
  );

  const jobs: ShopifyJob[] = [];
  let apiLoads = 0;
  const maxLoads = opts.maxApiLoads ?? 25;
  let cacheDirty = false;

  for (const order of orders) {
    if (!orderIsBuyable(order)) continue;
    const orderName = normName(order.orderName);
    let lines = cache[orderName]?.lines;
    if (!lines?.length) {
      // Order with zero links and no cached lines needs one API call; throttle per cycle.
      if (apiLoads >= maxLoads) continue;
      apiLoads += 1;
      try {
        lines = await loadOrderLines(orderName, cache);
        cacheDirty = true;
      } catch (e: any) {
        log(`shopify load fail ${orderName}: ${e?.message || e}`);
        continue;
      }
    }
    // Fully linked single-line orders drop out without any per-line DB hit.
    if (linkedNames.has(order.orderName) && lines.length === 1 && lines[0]?.lineItemId) {
      if (await lineAlreadyBought(lines[0].lineItemId)) continue;
    }
    for (const line of lines) {
      if (line.skip) continue;
      const nb = isClearlyNotStockxBuyable({ title: line.title, sku: line.sku });
      if (nb.notBuyable) continue;
      if (line.lineItemId && (await lineAlreadyBought(line.lineItemId))) continue;
      if (!line.sizeEU) continue;
      const slug = line.sku ? await urlKeyForSku(line.sku) : null;
      if (!slug) continue;
      jobs.push({
        key: jobKey("shopify", { lineItemId: line.lineItemId, orderRef: orderName }),
        source: "shopify",
        orderName,
        orderRef: orderName,
        lineItemId: line.lineItemId,
        title: line.title,
        sku: line.sku,
        slug,
        sizeEU: line.sizeEU,
        express: line.express,
        createdAt: order.createdAt.getTime(),
        saleChf: line.saleChf,
        rebuyOfCancelled: false,
      });
    }
  }
  if (cacheDirty) await writeJsonAtomic(LINES_CACHE, cache).catch(() => undefined);
  return jobs;
}

/**
 * Cancelled StockX orders (Shopify order still alive) that should be bought again.
 * Sold-out / over-margin / excluded pairs are NOT rebought (see shouldRebuyCancelled).
 */
export async function buildCancelRebuyJobs(opts: {
  sinceDays?: number;
  log?: (msg: string) => void;
}): Promise<ShopifyJob[]> {
  const log = opts.log ?? (() => undefined);
  const since = new Date(Date.now() - (opts.sinceDays ?? 30) * 86400_000);
  const matches = await prisma.orderMatch.findMany({
    where: {
      stockxStatus: { contains: "CANCEL", mode: "insensitive" },
      stockxOrderNumber: { not: "" },
      NOT: { stockxOrderNumber: { startsWith: "pp:" } },
      shopifyCreatedAt: { gte: since },
    },
    select: {
      id: true,
      shopifyOrderName: true,
      shopifyLineItemId: true,
      shopifyProductTitle: true,
      shopifySku: true,
      shopifySizeEU: true,
      shopifyCreatedAt: true,
      shopifyTotalPrice: true,
      stockxStatus: true,
    },
    orderBy: { shopifyCreatedAt: "asc" },
  });
  const out: ShopifyJob[] = [];
  const { precheckStockxBuyability } = await import("@/lib/stockxAutoCheckout/precheckAvailability");
  for (const m of matches) {
    const order = await prisma.shopifyOrder.findFirst({
      where: { orderName: { in: [m.shopifyOrderName, normName(m.shopifyOrderName)] } },
      select: { cancelledAt: true, netSalesChf: true, totalSalesChf: true, financialStatus: true, refundedAmountChf: true },
    });
    if (!order || order.cancelledAt || !orderIsBuyable(order)) continue;
    const sku = m.shopifySku ?? "";
    const sizeEU = m.shopifySizeEU ?? "";
    if (!sku || !sizeEU) continue;
    const slug = await urlKeyForSku(sku);
    if (!slug) continue;
    let precheck: string | null = null;
    try {
      const p = await precheckStockxBuyability({
        line: { sku, sizeEU, title: m.shopifyProductTitle, saleChf: Number(m.shopifyTotalPrice) || null },
        desiredLane: "STANDARD",
      });
      precheck = p.status;
    } catch (e: any) {
      log(`rebuy precheck fail ${m.shopifyOrderName}: ${e?.message || e}`);
    }
    const verdict = shouldRebuyCancelled({
      stockxStatus: m.stockxStatus,
      shopifyCancelled: Boolean(order.cancelledAt),
      precheckStatus: precheck,
      alreadyRebought: false,
    });
    if (!verdict.rebuy) {
      log(`rebuy skip ${m.shopifyOrderName}: ${verdict.reason}`);
      continue;
    }
    out.push({
      key: `${jobKey("shopify", { lineItemId: m.shopifyLineItemId, orderRef: m.shopifyOrderName })}:rebuy:${m.id.slice(0, 8)}`,
      source: "shopify",
      orderName: normName(m.shopifyOrderName),
      orderRef: normName(m.shopifyOrderName),
      lineItemId: m.shopifyLineItemId,
      title: m.shopifyProductTitle,
      sku,
      slug,
      sizeEU,
      express: false,
      createdAt: (m.shopifyCreatedAt ?? new Date()).getTime(),
      saleChf: Number(m.shopifyTotalPrice) || null,
      rebuyOfCancelled: true,
    });
  }
  return out;
}
