import { prisma } from "@/app/lib/prisma";
import { buildStockxOrderClaimIndex, findStockxOrderClaim } from "@/app/lib/stockxCrossChannelClaims";
import { getCachedStockxBuyingOrders } from "@/galaxus/stx/buyingOrdersCache";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { linkStockxBuyToShopify } from "@/lib/stockxAutoCheckout/linkAfterBuy";
import { normSizeEU, styleIdFromSku } from "@/lib/stockxAutoCheckout/prebuyDedupe";
import { ntfy } from "@/lib/stockxDelayRebuy/sweepStaleCancelled";
import { isShopifyOrderResolved, type LiveShopifyState } from "@/lib/stockxDelayRebuy/sweepStaleCancelled";
import { listStockxAccountTokens } from "@/lib/stockxToken";
import {
  isStockxBuyMatchableForAutoLink,
  normalizeStockxBuyingNodeForShopifyMatch,
} from "@/shopify/orders/autoLinkStockxBuys";

/**
 * Shopify lines whose StockX buy is CANCELLED/REFUNDED but that were rebought by hand or on
 * another StockX account. The regular auto-link only links never-matched lines on the
 * Shopify account, so such rebuys stayed invisible (#7440, #7681): no tracking, no mail.
 *
 * Rules (all required, else skip):
 *  - Shopify order still open (live check)
 *  - same style id AND same EU size
 *  - buy created AFTER the cancelled buy, status not cancelled/refunded
 *  - not claimed by any OrderMatch / Galaxus / Decathlon
 *  - exactly one candidate buy for the line, and the buy matches only this line
 * Customer mail only if the buy is < 48h old.
 */

const H = 3_600_000;
const FRESH_MAIL_H = 48;
const MAX_ORDER_AGE_DAYS = 60;
let running = false;

export type RelinkResult = {
  ran: boolean;
  candidates: number;
  linked: Array<{ order: string; stockx: string }>;
  ambiguous: string[];
  wouldLink: Array<{ order: string; stockx: string }>;
};

function gid(id: string): string {
  return id.startsWith("gid://") ? id : `gid://shopify/Order/${id}`;
}

export async function runRelinkCancelledStockxBuys(opts?: { dryRun?: boolean }): Promise<RelinkResult> {
  const out: RelinkResult = { ran: false, candidates: 0, linked: [], ambiguous: [], wouldLink: [] };
  if (process.env.STOCKX_RELINK_CANCELLED === "0" || running) return out;
  running = true;
  out.ran = true;
  try {
    const since = new Date(Date.now() - MAX_ORDER_AGE_DAYS * 24 * H);
    const cands = await prisma.orderMatch.findMany({
      where: {
        supplierSource: "STOCKX",
        stockxStatus: { in: ["CANCELLED", "REFUNDED"] },
        shopifyCreatedAt: { gte: since },
      },
    });
    out.candidates = cands.length;
    if (!cands.length) return out;

    // All active buys, all accounts.
    const accounts = await listStockxAccountTokens().catch(() => []);
    const buys = new Map<string, NonNullable<ReturnType<typeof normalizeStockxBuyingNodeForShopifyMatch>>>();
    for (const acc of accounts) {
      for (const [state, pages] of [["PENDING", 2], ["HISTORICAL", 2]] as const) {
        const res = await getCachedStockxBuyingOrders(acc.token, { first: 100, maxPages: pages, state }).catch(() => null);
        for (const node of res?.nodes ?? []) {
          const n = normalizeStockxBuyingNodeForShopifyMatch(node);
          if (!n || !isStockxBuyMatchableForAutoLink(n.statusKey)) continue;
          buys.set(n.supplierOrderNumber, n);
        }
      }
    }
    if (!buys.size) return out;

    // Claimed order numbers (Shopify matches + Galaxus/Decathlon claims).
    const nums = Array.from(buys.keys());
    const shopifyClaimed = new Set(
      (await prisma.orderMatch.findMany({ where: { stockxOrderNumber: { in: nums } }, select: { stockxOrderNumber: true } })).map(
        (r) => r.stockxOrderNumber
      )
    );
    const claimIdx = await buildStockxOrderClaimIndex({ stockxOrderNumbers: nums });

    // Candidate lines -> matching buys.
    const perLine = new Map<string, string[]>();
    const perBuy = new Map<string, string[]>();
    for (const c of cands) {
      const style = (styleIdFromSku(c.shopifySku) ?? "").toLowerCase();
      const size = normSizeEU(c.shopifySizeEU);
      if (!style || !size) continue;
      const oldBuyAt = c.stockxPurchaseDate?.getTime() ?? 0;
      for (const [num, b] of buys) {
        if (num === c.stockxOrderNumber) continue;
        if (shopifyClaimed.has(num) || findStockxOrderClaim(claimIdx, b.orderId, num)) continue;
        if (String(b.skuKey ?? "").toLowerCase() !== style) continue;
        if (normSizeEU(b.sizeEU) !== size) continue;
        const bAt = Date.parse(b.purchaseDate);
        if (!Number.isFinite(bAt) || bAt <= oldBuyAt) continue;
        perLine.set(c.id, [...(perLine.get(c.id) ?? []), num]);
        perBuy.set(num, [...(perBuy.get(num) ?? []), c.id]);
      }
    }

    for (const c of cands) {
      const opts1 = perLine.get(c.id) ?? [];
      if (!opts1.length) continue;
      const num = opts1[0];
      if (opts1.length > 1 || (perBuy.get(num) ?? []).length > 1) {
        out.ambiguous.push(c.shopifyOrderName);
        continue;
      }
      let live: LiveShopifyState | null = null;
      try {
        const r: any = await shopifyGraphQL(
          `query($id:ID!){order(id:$id){cancelledAt displayFinancialStatus displayFulfillmentStatus}}`,
          { id: gid(c.shopifyOrderId) },
          { estimatedQueryCost: 5 }
        );
        live = r.data?.order ?? null;
      } catch {
        continue;
      }
      if (isShopifyOrderResolved(live)) continue;

      const b = buys.get(num)!;
      const cost = typeof b.offerAmount === "number" && b.offerAmount > 0 ? b.offerAmount : 0;
      if (!cost) continue;
      const ageH = (Date.now() - Date.parse(b.purchaseDate)) / H;
      const lane = num.startsWith("01-") ? ("EXPRESS" as const) : ("STANDARD" as const);

      if (opts?.dryRun) {
        out.wouldLink.push({ order: c.shopifyOrderName, stockx: num });
        continue;
      }
      const r = await linkStockxBuyToShopify({
        shopifyOrderId: c.shopifyOrderId,
        shopifyOrderName: c.shopifyOrderName,
        shopifyLineItemId: c.shopifyLineItemId,
        shopifyCreatedAt: c.shopifyCreatedAt?.toISOString() ?? null,
        shopifyProductTitle: c.shopifyProductTitle,
        shopifySku: c.shopifySku,
        shopifySizeEU: c.shopifySizeEU,
        shopifyTotalPrice: Number(c.shopifyTotalPrice),
        shopifyCustomerEmail: c.shopifyCustomerEmail,
        shopifyCustomerFirstName: c.shopifyCustomerFirstName,
        shopifyCustomerLastName: c.shopifyCustomerLastName,
        shopifyLineItemImageUrl: c.shopifyLineItemImageUrl,
        stockxOrderNumber: num,
        stockxProductName: b.productTitle,
        stockxSkuKey: b.skuKey,
        supplierCost: cost,
        desiredLane: lane,
        skipPostLinkEmail: ageH >= FRESH_MAIL_H,
      });
      if (r.ok) {
        out.linked.push({ order: c.shopifyOrderName, stockx: num });
        await ntfy(
          `Rachat relié ${c.shopifyOrderName}`,
          `${c.shopifyProductTitle} (${c.shopifySizeEU ?? "?"}) relié à ${num}. ${ageH >= FRESH_MAIL_H ? "Pas de mail client (achat ancien)." : "Mail client envoyé."} Tracking relancé.`
        );
      }
    }
    if (out.ambiguous.length) {
      await ntfy("Rachat ambigu à relier à la main", `Plusieurs candidats pour : ${out.ambiguous.join(", ")}`, true);
    }
    return out;
  } finally {
    running = false;
  }
}
