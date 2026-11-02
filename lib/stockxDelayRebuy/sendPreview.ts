import { sendStockxEmail } from "@/lib/stockxAuthAlert";
import { buildDelayRebuyCase } from "@/lib/stockxDelayRebuy/buildCase";
import {
  buildOpsBuyText,
  buildOpsDelayText,
  clientMailBundle,
} from "@/lib/stockxDelayRebuy/emails";
import type { DelayRebuyCase } from "@/lib/stockxDelayRebuy/types";

export type PreviewSendResult = {
  orderMatchId: string;
  shopifyOrderName: string;
  case: DelayRebuyCase;
  sent: Array<{ step: string; ok: boolean; subject: string }>;
};

/**
 * Preview pipeline for one match — ALL mails go to STOCKX_ALERT_EMAIL (ops).
 * Steps: OPS delay → CLIENT delay → CLIENT cancel-rebuy → OPS buy (+ KickDB + /buy/ link).
 */
export async function sendDelayRebuyPreviewForMatch(
  orderMatchId: string
): Promise<PreviewSendResult> {
  const c = await buildDelayRebuyCase(orderMatchId);
  const sent: PreviewSendResult["sent"] = [];

  const steps: Array<{
    step: string;
    subject: string;
    text: string;
    html?: string;
  }> = [
    {
      step: "ops_delay",
      subject: `[OPS] Retard ${c.shopifyOrderName} · ${c.stockxOrderNumber || "no-stx"}`,
      text: buildOpsDelayText(c),
    },
    (() => {
      const b = clientMailBundle(c, "SUPPLIER_CHANGE_DELAY");
      return { step: "client_delay", subject: b.subject, text: b.text, html: b.html };
    })(),
    (() => {
      const kind = c.precheck.status === "buyable" ? "CANCEL_REBUY_LEGIT" : "CANCEL_NO_REBUY";
      const b = clientMailBundle(c, kind);
      return { step: "client_cancel_rebuy", subject: b.subject, text: b.text, html: b.html };
    })(),
    {
      step: "ops_buy",
      subject: `[OPS] Buy/rebuy ${c.shopifyOrderName} · precheck=${c.precheck.status} · ${c.rebuyLane}`,
      text: buildOpsBuyText(c),
    },
  ];

  for (const s of steps) {
    const ok = await sendStockxEmail(s.subject, s.text, s.html ?? null);
    sent.push({ step: s.step, ok, subject: s.subject });
    console.log(`[delay-rebuy] ${c.shopifyOrderName} ${s.step} ok=${ok}`);
  }

  return {
    orderMatchId: c.orderMatchId,
    shopifyOrderName: c.shopifyOrderName,
    case: c,
    sent,
  };
}
