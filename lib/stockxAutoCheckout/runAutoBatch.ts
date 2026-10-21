import { prisma } from "@/app/lib/prisma";
import { isPackageProtectionShopifyLine } from "@/app/utils/matching";
import { emailStockxNeedsHuman } from "@/lib/stockxAutoCheckout/emailNeedsHuman";
import type { StockxNeedsHumanPayload } from "@/lib/stockxAutoCheckout/types";
import { STOCKX_NEEDS_HUMAN_REASON_FR } from "@/lib/stockxAutoCheckout/types";
import {
  runStockxAutoCheckoutForOrder,
  saveStockxLastAutoBatch,
  type StockxAutoCheckoutResult,
} from "@/lib/stockxCheckout";

export type AutoBatchItemResult = {
  orderName: string;
  lineItemId: string | null;
  result: StockxAutoCheckoutResult;
};

export type AutoBatchSummary = {
  scannedOrders: number;
  attempted: number;
  bought: number;
  emailed: number;
  skipped: number;
  emailSent: boolean;
  dryRun: boolean;
  items: AutoBatchItemResult[];
  needsHuman: StockxNeedsHumanPayload[];
};

/**
 * Unmatched Shopify orders (recent) → auto easy buys + email hard cases.
 * Skips physical stock / pickup / package protection / already matched.
 */
export async function runStockxAutoEasyAndEmailRest(options?: {
  days?: number;
  orderNames?: string[];
  dryRun?: boolean;
  maxOrders?: number;
}): Promise<AutoBatchSummary> {
  const days = Math.min(60, Math.max(1, Math.floor(options?.days ?? 14)));
  const maxOrders = Math.min(40, Math.max(1, Math.floor(options?.maxOrders ?? 15)));
  const dryRun = Boolean(options?.dryRun);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  let orderNames: string[] = (options?.orderNames ?? [])
    .map((n) => (String(n).startsWith("#") ? String(n) : `#${n}`))
    .filter(Boolean);

  if (!orderNames.length) {
    const orders = await prisma.shopifyOrder.findMany({
      where: { createdAt: { gte: since }, cancelledAt: null },
      select: { shopifyOrderId: true, orderName: true, netSalesChf: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const names = orders.map((o) => o.orderName);
    const ids = orders.map((o) => o.shopifyOrderId);
    const matched = await prisma.orderMatch.findMany({
      where: {
        OR: [{ shopifyOrderName: { in: names } }, { shopifyOrderId: { in: ids } }],
      },
      select: { shopifyOrderName: true, shopifyOrderId: true, shopifyLineItemId: true },
    });
    // Keep orders that still may have unmatched lines (no match on order name/id at all,
    // or multi-line — we re-check per line in checkout).
    const fullyCovered = new Set(
      matched.map((m) => m.shopifyOrderName).filter(Boolean) as string[]
    );
    orderNames = orders
      .filter((o) => Number(o.netSalesChf ?? 0) > 0 && !fullyCovered.has(o.orderName))
      .map((o) => o.orderName)
      .slice(0, maxOrders);
  } else {
    orderNames = orderNames.slice(0, maxOrders);
  }

  const items: AutoBatchItemResult[] = [];
  const needsHuman: StockxNeedsHumanPayload[] = [];
  let bought = 0;
  let skipped = 0;

  for (const orderName of orderNames) {
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

      const lineItemId = String(line.lineItemId || "") || null;
      const result = await runStockxAutoCheckoutForOrder({
        orderName,
        lineItemId,
        dryRun,
      });
      items.push({ orderName, lineItemId, result });

      if (result.kind === "easy_buy") {
        bought += 1;
      } else if (result.kind === "skipped") {
        skipped += 1;
      } else if (result.needsHuman) {
        needsHuman.push(result.needsHuman);
      }
    }
  }

  // Skip email for pure skips that ops don't need (pickup / physical / already matched)
  const emailable = needsHuman.filter(
    (n) => !["pickup", "physical_stock", "already_matched"].includes(n.reason)
  );
  // Dry-run: never email (preview only). Live: Postmark via sendStockxEmail.
  const emailResult = dryRun
    ? { sent: false, count: emailable.length }
    : await emailStockxNeedsHuman(emailable);

  const summary: AutoBatchSummary = {
    scannedOrders: orderNames.length,
    attempted: items.length,
    bought,
    emailed: emailable.length,
    skipped,
    emailSent: emailResult.sent,
    dryRun,
    items,
    needsHuman: emailable,
  };

  await saveStockxLastAutoBatch({
    at: new Date().toISOString(),
    dryRun,
    scannedOrders: summary.scannedOrders,
    attempted: summary.attempted,
    bought: summary.bought,
    emailed: summary.emailed,
    skipped: summary.skipped,
    emailSent: summary.emailSent,
    boughtItems: items
      .filter((i) => i.result.kind === "easy_buy")
      .map((i) => ({
        orderName: i.orderName,
        lineItemId: i.lineItemId,
        stockxOrderNumber: i.result.stockxOrderNumber ?? null,
        totalChf: i.result.totalChf ?? null,
        detail: i.result.detail ?? null,
      })),
    emailedItems: emailable.map((n) => ({
      orderName: n.shopifyOrderName,
      lineItemId: n.shopifyLineItemId,
      reason: n.reason,
      reasonFr: STOCKX_NEEDS_HUMAN_REASON_FR[n.reason] || n.reason,
      title: n.title,
      saleChf: n.saleChf,
      desiredLane: n.desiredLane,
    })),
  });

  return summary;
}
