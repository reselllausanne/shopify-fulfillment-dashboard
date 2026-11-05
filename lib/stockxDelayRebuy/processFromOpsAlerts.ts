import {
  attemptCancelRebuy,
  type AttemptCancelRebuyResult,
} from "@/lib/stockxDelayRebuy/attemptCancelRebuy";
import {
  customerDelayMailMaxPerRun,
  isCustomerDelayMailEnabled,
} from "@/lib/stockxDelayRebuy/flags";
import {
  sendCustomerDelayMail,
  type SendCustomerDelayResult,
} from "@/lib/stockxDelayRebuy/sendCustomer";

export type OpsCustomerAlertHint = {
  scope: string;
  alertType: string;
  /** OrderMatch.id for Shopify alerts. */
  refKey: string;
  orderRef?: string | null;
};

export type ProcessFromOpsAlertsResult = {
  enabled: boolean;
  dryRun: boolean;
  processed: number;
  delaySent: number;
  delaySkipped: number;
  cancelRebuyAttempted: number;
  cancelRebuyBought: number;
  errors: number;
  details: Array<{
    alertType: string;
    orderRef: string | null;
    action: string;
    ok: boolean;
    reason?: string;
    to?: string;
  }>;
};

/**
 * After opsAlerts finds FRESH Shopify DELAYED / CANCELLED rows:
 * - DELAYED / CANCELLED / REFUNDED → customer delay warning immediately (no new purchase claimed)
 * - CANCELLED → optional auto-rebuy; the "item replaced" mail fires only after a new buy is linked
 *
 * Only fresh alerts (not already in StockxOrderAlert) — no backlog flood.
 * Gated by STOCKX_CUSTOMER_DELAY_MAIL.
 */
export async function processShopifyCustomerMailsFromOpsAlerts(
  fresh: OpsCustomerAlertHint[],
  opts?: { dryRun?: boolean }
): Promise<ProcessFromOpsAlertsResult> {
  const dryRun = Boolean(opts?.dryRun);
  const out: ProcessFromOpsAlertsResult = {
    enabled: isCustomerDelayMailEnabled(),
    dryRun,
    processed: 0,
    delaySent: 0,
    delaySkipped: 0,
    cancelRebuyAttempted: 0,
    cancelRebuyBought: 0,
    errors: 0,
    details: [],
  };

  if (!out.enabled) {
    return out;
  }

  const max = customerDelayMailMaxPerRun();
  const shopifyFresh = fresh.filter(
    (a) =>
      a.scope === "shopify" &&
      (a.alertType === "DELAYED" ||
        a.alertType === "CANCELLED" ||
        a.alertType === "REFUNDED")
  );

  for (const a of shopifyFresh) {
    if (out.processed >= max) break;
    out.processed += 1;
    const orderRef = a.orderRef ?? null;

    if (
      a.alertType === "DELAYED" ||
      a.alertType === "CANCELLED" ||
      a.alertType === "REFUNDED"
    ) {
      let mail: SendCustomerDelayResult | undefined;
      try {
        mail = await sendCustomerDelayMail({
          orderMatchId: a.refKey,
          kind: "SUPPLIER_CHANGE_DELAY",
          dryRun,
        });
      } catch (err: any) {
        out.errors += 1;
        out.details.push({
          alertType: a.alertType,
          orderRef,
          action: "delay_mail",
          ok: false,
          reason: String(err?.message ?? err).slice(0, 200),
        });
        if (a.alertType !== "CANCELLED") continue;
      }
      if (mail) {
        if (mail.sent) out.delaySent += 1;
        else out.delaySkipped += 1;
        if (!mail.ok) out.errors += 1;
        out.details.push({
          alertType: a.alertType,
          orderRef,
          action: "delay_mail",
          ok: mail.ok,
          reason: mail.reason || (mail.sent ? "sent" : mail.error),
          to: mail.to,
        });
      }
      if (a.alertType !== "CANCELLED") continue;
    }

    // CANCELLED → optional auto-rebuy. Replacement mail only after the new buy is linked.
    out.cancelRebuyAttempted += 1;
    let rebuy: AttemptCancelRebuyResult;
    try {
      rebuy = await attemptCancelRebuy(a.refKey, { dryRun });
    } catch (err: any) {
      out.errors += 1;
      out.details.push({
        alertType: a.alertType,
        orderRef,
        action: "cancel_rebuy",
        ok: false,
        reason: String(err?.message ?? err).slice(0, 200),
      });
      continue;
    }
    if (rebuy.bought) out.cancelRebuyBought += 1;
    out.details.push({
      alertType: a.alertType,
      orderRef,
      action: "cancel_rebuy",
      ok: rebuy.ok,
      reason: rebuy.reason || (rebuy.bought ? "bought" : rebuy.detail),
    });
  }

  console.log(
    `[STOCKX][CUSTOMER_DELAY] enabled=${out.enabled} dryRun=${out.dryRun} processed=${out.processed} delaySent=${out.delaySent} cancelBought=${out.cancelRebuyBought} errors=${out.errors}`
  );
  return out;
}
