import { prisma } from "@/app/lib/prisma";
import { isAutoRebuyOnCancelEnabled } from "@/lib/stockxDelayRebuy/flags";
import { buildDelayRebuyCase } from "@/lib/stockxDelayRebuy/buildCase";
import { runStockxAutoCheckoutForOrder } from "@/lib/stockxCheckout";

export type AttemptCancelRebuyResult = {
  ok: boolean;
  bought?: boolean;
  skipped?: boolean;
  reason?: string;
  detail?: string;
  matchId: string;
  shopifyOrderName?: string;
  newStockxOrderNumber?: string | null;
  orderMatchIdAfter?: string | null;
};

/**
 * Cancel → optional auto Place Order for a cancelled Shopify OrderMatch.
 *
 * Default OFF (`STOCKX_AUTO_REBUY_ON_CANCEL`). When on: precheck must be buyable,
 * then `runStockxAutoCheckoutForOrder({ allowRebuyOfCancelled: true })`.
 * Customer cancel-rebuy mail is sent from linkAfterBuy on successful relink.
 */
export async function attemptCancelRebuy(
  orderMatchId: string,
  opts?: { dryRun?: boolean; force?: boolean }
): Promise<AttemptCancelRebuyResult> {
  const match = await prisma.orderMatch.findUnique({
    where: { id: orderMatchId },
    select: {
      id: true,
      shopifyOrderName: true,
      shopifyLineItemId: true,
      stockxOrderNumber: true,
      stockxStatus: true,
    },
  });
  if (!match) {
    return { ok: false, reason: "match_not_found", matchId: orderMatchId };
  }

  const status = String(match.stockxStatus ?? "").toUpperCase();
  const isCancel =
    status.includes("CANCEL") || status.includes("REFUND");
  if (!isCancel && !opts?.force) {
    return {
      ok: true,
      skipped: true,
      reason: "not_cancelled",
      matchId: match.id,
      shopifyOrderName: match.shopifyOrderName,
      detail: status || "null",
    };
  }

  if (!isAutoRebuyOnCancelEnabled() && !opts?.force) {
    return {
      ok: true,
      skipped: true,
      reason: "auto_rebuy_disabled",
      matchId: match.id,
      shopifyOrderName: match.shopifyOrderName,
    };
  }

  const c = await buildDelayRebuyCase(match.id);
  if (c.precheck.status !== "buyable") {
    return {
      ok: true,
      skipped: true,
      reason: "not_buyable",
      matchId: match.id,
      shopifyOrderName: match.shopifyOrderName,
      detail: `${c.precheck.status}: ${c.precheck.detail}`,
    };
  }

  if (opts?.dryRun) {
    console.log(
      `[delay-rebuy][dry-run] would auto-rebuy ${match.shopifyOrderName} lane=${c.rebuyLane} slug=${c.slug}`
    );
    return {
      ok: true,
      skipped: true,
      reason: "dry_run",
      matchId: match.id,
      shopifyOrderName: match.shopifyOrderName,
    };
  }

  const buy = await runStockxAutoCheckoutForOrder({
    orderName: match.shopifyOrderName,
    lineItemId: match.shopifyLineItemId,
    slug: c.slug,
    sizeEUOverride: c.sizeEU,
    desiredLane: c.rebuyLane,
    allowRebuyOfCancelled: true,
    dryRun: false,
  });

  if (buy.kind === "easy_buy") {
    return {
      ok: true,
      bought: true,
      matchId: match.id,
      shopifyOrderName: match.shopifyOrderName,
      newStockxOrderNumber: buy.stockxOrderNumber ?? null,
      orderMatchIdAfter: buy.link?.orderMatchId ?? null,
      reason: "easy_buy",
      detail: buy.detail ?? undefined,
    };
  }

  return {
    ok: false,
    bought: false,
    matchId: match.id,
    shopifyOrderName: match.shopifyOrderName,
    reason: buy.reason || buy.kind,
    detail: buy.detail ?? undefined,
  };
}
