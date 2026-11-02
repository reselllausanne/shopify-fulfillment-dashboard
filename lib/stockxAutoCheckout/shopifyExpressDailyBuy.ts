/**
 * Daily Shopify Express → StockX auto-buy (lag 0).
 *
 * Finds unmatched paid Shopify orders in the lookback window whose line is
 * Express, Place Orders on StockX EXPRESS, then emails the operator a digest
 * (bought + needs_human + skipped). Standard Shopify stays on the cashflow queue.
 */
import { prisma } from "@/app/lib/prisma";
import { isPackageProtectionShopifyLine } from "@/app/utils/matching";
import { sendStockxEmail } from "@/lib/stockxAuthAlert";
import { detectShopifyExpress } from "@/lib/stockxAutoCheckout/detectShopifyExpress";
import { emailStockxNeedsHuman } from "@/lib/stockxAutoCheckout/emailNeedsHuman";
import {
  STOCKX_NEEDS_HUMAN_REASON_FR,
  type StockxNeedsHumanPayload,
} from "@/lib/stockxAutoCheckout/types";
import {
  loadShopifyLine,
  runStockxAutoCheckoutForOrder,
  type StockxAutoCheckoutResult,
} from "@/lib/stockxCheckout";

export type ShopifyExpressDailyItem = {
  orderName: string;
  lineItemId: string | null;
  title: string;
  sizeEU: string;
  result: StockxAutoCheckoutResult;
};

export type ShopifyExpressDailySummary = {
  ok: boolean;
  dryRun: boolean;
  lookbackDays: number;
  scannedOrders: number;
  expressCandidates: number;
  attempted: number;
  bought: number;
  skipped: number;
  needsHuman: number;
  emailSent: boolean;
  items: ShopifyExpressDailyItem[];
};

function normalizeName(n: string): string {
  const t = String(n || "").trim();
  if (!t) return "";
  return t.startsWith("#") ? t : `#${t}`;
}

async function listUnmatchedShopifyOrderNames(days: number, limit: number): Promise<string[]> {
  const since = new Date(Date.now() - Math.max(1, days) * 86_400_000);
  const orders = await prisma.shopifyOrder.findMany({
    where: {
      createdAt: { gte: since },
      cancelledAt: null,
      financialStatus: { in: ["paid", "partially_paid", "PAID", "PARTIALLY_PAID"] },
    },
    select: { orderName: true, shopifyOrderId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: Math.min(300, Math.max(limit * 4, 80)),
  });
  if (!orders.length) return [];

  const names = orders.map((o) => o.orderName);
  const ids = orders.map((o) => o.shopifyOrderId);
  const matches = await prisma.orderMatch.findMany({
    where: {
      OR: [{ shopifyOrderName: { in: names } }, { shopifyOrderId: { in: ids } }],
      stockxOrderNumber: { not: "" },
    },
    select: { shopifyOrderName: true, shopifyOrderId: true, shopifyLineItemId: true },
  });

  // Order-level skip only when at least one real STX # exists — multi-line may still need buy.
  // Express daily: include order if ANY line may be unlinked; per-line already_matched handles rest.
  // Keep scanning orders that have zero STX # — Express daily must not wait for cashflow lag.
  // Orders with a match may still have another Express line; include those too (cheap).
  const matchedNames = new Set(
    matches.map((m) => m.shopifyOrderName).filter(Boolean) as string[]
  );
  const unmatchedFirst = orders
    .filter((o) => !matchedNames.has(o.orderName))
    .map((o) => normalizeName(o.orderName));
  const matchedRest = orders
    .filter((o) => matchedNames.has(o.orderName))
    .map((o) => normalizeName(o.orderName));
  return [...unmatchedFirst, ...matchedRest].slice(0, Math.min(120, limit * 3));
}

function formatDigest(summary: ShopifyExpressDailySummary): { subject: string; text: string; html: string } {
  const bought = summary.items.filter((i) => i.result.kind === "easy_buy");
  const human = summary.items.filter((i) => i.result.kind === "needs_human");
  const skipped = summary.items.filter((i) => i.result.kind === "skipped");
  const subject = `[Resell] Shopify Express daily — bought ${summary.bought}, human ${human.length}, skip ${skipped.length}`;

  const lines: string[] = [
    "Shopify Express → StockX auto-buy (lag 0)",
    `dryRun=${summary.dryRun} lookbackDays=${summary.lookbackDays}`,
    `scannedOrders=${summary.scannedOrders} expressCandidates=${summary.expressCandidates} attempted=${summary.attempted}`,
    "",
  ];
  if (bought.length) {
    lines.push("BOUGHT:");
    for (const b of bought) {
      const r = b.result;
      lines.push(
        `- ${b.orderName} · ${b.title.slice(0, 50)} · ${b.sizeEU} · ${r.totalChf ?? "?"} CHF · ${r.stockxOrderNumber ?? "?"}`
      );
    }
    lines.push("");
  }
  if (human.length) {
    lines.push("NEEDS HUMAN:");
    for (const h of human) {
      const reason = h.result.needsHuman?.reason || h.result.reason || "?";
      const fr = STOCKX_NEEDS_HUMAN_REASON_FR[reason as keyof typeof STOCKX_NEEDS_HUMAN_REASON_FR] || reason;
      lines.push(`- ${h.orderName} · ${h.title.slice(0, 50)} · ${fr}${h.result.detail ? ` — ${h.result.detail}` : ""}`);
    }
    lines.push("");
  }
  if (skipped.length) {
    lines.push("SKIPPED:");
    for (const s of skipped) {
      lines.push(`- ${s.orderName} · ${s.result.reason || "skipped"}`);
    }
  }
  const text = lines.join("\n");
  const html = `<pre style="font-family:ui-monospace,Menlo,monospace;font-size:13px">${text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")}</pre>`;
  return { subject, text, html };
}

/**
 * Live (or dryRun) Express-only Shopify buy pass + operator digest email.
 */
export async function runShopifyExpressDailyBuy(options?: {
  days?: number;
  maxOrders?: number;
  dryRun?: boolean;
  /** Skip email (tests). */
  skipEmail?: boolean;
}): Promise<ShopifyExpressDailySummary> {
  const lookbackDays = Math.min(30, Math.max(1, Number(options?.days ?? 14) || 14));
  const maxOrders = Math.min(40, Math.max(1, Number(options?.maxOrders ?? 20) || 20));
  const dryRun = Boolean(options?.dryRun);

  const orderNames = await listUnmatchedShopifyOrderNames(lookbackDays, maxOrders);
  const items: ShopifyExpressDailyItem[] = [];
  let expressCandidates = 0;
  let bought = 0;
  let skipped = 0;
  let needsHuman = 0;
  const needsHumanPayloads: StockxNeedsHumanPayload[] = [];

  for (const orderName of orderNames) {
    if (bought + needsHuman >= maxOrders) break;
    let lineCtx;
    try {
      lineCtx = await loadShopifyLine(orderName);
    } catch (e: any) {
      console.warn("[SHOPIFY-EXPRESS-DAILY] load fail", orderName, e?.message || e);
      continue;
    }

    const isExpress = detectShopifyExpress({
      deliveryMode: lineCtx.deliveryMode,
      deliveryModeLabel: lineCtx.deliveryModeLabel,
      shippingLineTitles: lineCtx.shippingLineTitles,
    });
    if (!isExpress) continue;

    // Multi-line: iterate via order-by-name
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

    for (const line of lines) {
      const title = String(line.title || "");
      const sku = String(line.sku || "");
      if (isPackageProtectionShopifyLine(title, sku)) continue;

      const lineExpress = detectShopifyExpress({
        deliveryMode: line.deliveryMode ?? lineCtx.deliveryMode,
        deliveryModeLabel: line.deliveryModeLabel ?? lineCtx.deliveryModeLabel,
        shippingLineTitles: Array.isArray(line.shippingLineTitles)
          ? line.shippingLineTitles
          : lineCtx.shippingLineTitles,
      });
      if (!lineExpress) continue;

      expressCandidates += 1;
      const lineItemId = String(line.lineItemId || "") || null;
      const result = await runStockxAutoCheckoutForOrder({
        orderName,
        lineItemId,
        dryRun,
        desiredLane: "EXPRESS",
      });

      items.push({
        orderName,
        lineItemId,
        title: String(line.title || lineCtx.title || ""),
        sizeEU: String(line.sizeEU || lineCtx.sizeEU || ""),
        result,
      });

      if (result.kind === "easy_buy") bought += 1;
      else if (result.kind === "skipped") skipped += 1;
      else if (result.kind === "needs_human") {
        needsHuman += 1;
        if (result.needsHuman && !["pickup", "physical_stock", "already_matched"].includes(result.needsHuman.reason)) {
          needsHumanPayloads.push(result.needsHuman);
        }
      }

      if (bought + needsHuman >= maxOrders) break;
    }
    if (bought + needsHuman >= maxOrders) break;
  }

  let emailSent = false;
  if (!options?.skipEmail && !dryRun && (bought > 0 || needsHumanPayloads.length > 0 || items.length > 0)) {
    const digest = formatDigest({
      ok: true,
      dryRun,
      lookbackDays,
      scannedOrders: orderNames.length,
      expressCandidates,
      attempted: items.length,
      bought,
      skipped,
      needsHuman,
      emailSent: false,
      items,
    });
    emailSent = await sendStockxEmail(digest.subject, digest.text, digest.html);
    if (needsHumanPayloads.length) {
      await emailStockxNeedsHuman(needsHumanPayloads, {
        subject: `[Resell] Shopify Express — action manuelle (${needsHumanPayloads.length})`,
      });
    }
  }

  return {
    ok: true,
    dryRun,
    lookbackDays,
    scannedOrders: orderNames.length,
    expressCandidates,
    attempted: items.length,
    bought,
    skipped,
    needsHuman,
    emailSent,
    items,
  };
}
