import { prisma } from "@/app/lib/prisma";
import { getMailer } from "@/app/lib/mailer";
import { buildDelayRebuyCase } from "@/lib/stockxDelayRebuy/buildCase";
import {
  activeStepIndexFromLabel,
  buildClientPreviewText,
} from "@/lib/stockxDelayRebuy/emails";
import { customerDelayMailToOverride } from "@/lib/stockxDelayRebuy/flags";
import { buildCustomerNarrative } from "@/lib/stockxDelayRebuy/narratives";
import type { DelayNarrativeKind } from "@/lib/stockxDelayRebuy/types";

/** StockXStatusEvent.milestoneKey — separate from AWB milestone progression. */
export const CUSTOMER_DELAY_MILESTONE_KEYS: Record<
  Exclude<DelayNarrativeKind, "CANCEL_NO_REBUY">,
  string
> = {
  SUPPLIER_CHANGE_DELAY: "CUSTOMER_DELAY_SUPPLIER_CHANGE",
  CANCEL_REBUY_LEGIT: "CUSTOMER_CANCEL_REBUY",
};

export type SendCustomerDelayOptions = {
  orderMatchId: string;
  kind: Exclude<DelayNarrativeKind, "CANCEL_NO_REBUY">;
  /**
   * Force recipient (TEST). Prefer STOCKX_ALERT_EMAIL / STOCKX_CUSTOMER_DELAY_MAIL_TO.
   * When set, ignoreOverride=true so Postmark always hits this address.
   */
  toOverride?: string | null;
  /** Re-send even if StockXStatusEvent already emailed. */
  force?: boolean;
  /** Prefix subject with [TEST] when mailing ops instead of customer. */
  testMode?: boolean;
  /** Log only — no Postmark, no emailedAt stamp. */
  dryRun?: boolean;
};

export type SendCustomerDelayResult = {
  ok: boolean;
  sent?: boolean;
  skipped?: boolean;
  reason?: string;
  error?: string;
  matchId: string;
  shopifyOrderName?: string;
  kind: DelayNarrativeKind;
  milestoneKey: string;
  to?: string;
  providerMessageId?: string | null;
  etaLine?: string;
  imageUrl?: string | null;
};

/**
 * Shopify customer delay / cancel-rebuy mail (StockX never named).
 * Uses the same Postmark normal-ship / express-ship templates as ETA mails
 * (product picture + status tracker). Dedup via StockXStatusEvent.
 */
export async function sendCustomerDelayMail(
  opts: SendCustomerDelayOptions
): Promise<SendCustomerDelayResult> {
  const milestoneKey = CUSTOMER_DELAY_MILESTONE_KEYS[opts.kind];
  const c = await buildDelayRebuyCase(opts.orderMatchId);
  const narrative = buildCustomerNarrative(c, opts.kind);

  const event = await prisma.stockXStatusEvent.upsert({
    where: {
      orderMatchId_milestoneKey: {
        orderMatchId: c.orderMatchId,
        milestoneKey,
      },
    },
    create: {
      orderMatchId: c.orderMatchId,
      milestoneKey,
      milestoneTitle: narrative.headline,
      statesHash: `delay-rebuy:${opts.kind}`,
    },
    update: {
      milestoneTitle: narrative.headline,
      statesHash: `delay-rebuy:${opts.kind}`,
    },
    select: { id: true, emailedAt: true },
  });

  if (event.emailedAt && !opts.force) {
    return {
      ok: true,
      skipped: true,
      reason: "already_emailed",
      matchId: c.orderMatchId,
      shopifyOrderName: c.shopifyOrderName,
      kind: opts.kind,
      milestoneKey,
      etaLine: narrative.etaLine,
      imageUrl: c.imageUrl,
    };
  }

  const envOverride = customerDelayMailToOverride();
  const override = (opts.toOverride || envOverride || "").trim();
  const customer = (c.customerEmail || "").trim();
  const alert =
    (process.env.STOCKX_ALERT_EMAIL || "").trim() ||
    (process.env.POSTMARK_OVERRIDE_TO || "").trim();
  const testMode = Boolean(opts.testMode || override);
  const to = override || (testMode ? alert : customer);

  if (!to) {
    return {
      ok: true,
      skipped: true,
      reason: "missing_recipient",
      matchId: c.orderMatchId,
      shopifyOrderName: c.shopifyOrderName,
      kind: opts.kind,
      milestoneKey,
      etaLine: narrative.etaLine,
      imageUrl: c.imageUrl,
    };
  }

  if (opts.dryRun) {
    console.log(
      `[delay-rebuy][dry-run] would send ${opts.kind} ${c.shopifyOrderName} → ${to} eta=${narrative.etaLine} img=${c.imageUrl ? "yes" : "no"}`
    );
    return {
      ok: true,
      skipped: true,
      reason: "dry_run",
      matchId: c.orderMatchId,
      shopifyOrderName: c.shopifyOrderName,
      kind: opts.kind,
      milestoneKey,
      to,
      etaLine: narrative.etaLine,
      imageUrl: c.imageUrl,
    };
  }

  const subject = testMode
    ? `[TEST] ${narrative.subject}`
    : narrative.subject;
  const statusNote = narrative.bodyParagraphs.join(" ");
  const etaStart =
    opts.kind === "CANCEL_REBUY_LEGIT" ? c.rebuyEtaStart : c.announceEtaStart;
  const etaEnd =
    opts.kind === "CANCEL_REBUY_LEGIT" ? c.rebuyEtaEnd : c.announceEtaEnd;

  const mailer = getMailer();
  const sendRes = await mailer.sendStockXMilestoneEmail({
    to,
    language: "fr",
    ignoreOverride: Boolean(override) || testMode,
    stockxStates: null,
    templateOverrides: {
      emailSubject: subject,
      headline: narrative.headline,
      statusNote,
      preheaderText: narrative.headline,
      activeStepIndex: activeStepIndexFromLabel(narrative.activeStepLabel),
      estimatedArrivalStart: etaStart,
      estimatedArrivalEnd: etaEnd,
      nextStep1: "Tu recevras un e-mail automatique a chaque etape.",
      nextStep2:
        "Merci d'attendre la nouvelle date de livraison estimee indiquée ci-dessus.",
      nextStep3:
        "Si rien n'est livre 48h apres cette date, contacte-nous avec ton numero de commande.",
    },
    match: {
      id: c.orderMatchId,
      customerTrackingToken: c.trackingToken,
      shopifyOrderName: c.shopifyOrderName,
      shopifyProductTitle: c.productTitle,
      shopifySku: c.sku,
      shopifySizeEU: c.sizeEU,
      shopifyTotalPriceChf: c.saleChf,
      shopifyLineItemImageUrl: c.imageUrl,
      shopifyCustomerFirstName: c.customerFirstName,
      shopifyCustomerLastName: null,
      stockxCheckoutType: c.checkoutType,
      stockxOrderNumber: c.stockxOrderNumber,
      stockxSkuKey: c.sku,
      stockxSizeEU: c.sizeEU,
      stockxTrackingUrl: null,
      stockxAwb: null,
      stockxEstimatedDelivery: etaStart,
      stockxLatestEstimatedDelivery: etaEnd,
    },
    milestone: {
      key: milestoneKey,
      title: narrative.headline,
      description: statusNote,
    },
  });

  // Text audit trail for ops (template path has no TextBody).
  if (process.env.STOCKX_DELAY_MAIL_LOG_TEXT === "1") {
    console.log(
      buildClientPreviewText(c, narrative).replace(
        "— Resell Lausanne (preview client, pas envoyé au client)",
        testMode
          ? `— Resell Lausanne [TEST → ${to}; client serait ${customer || "n/a"}]`
          : "— Resell Lausanne"
      )
    );
  }

  if (!sendRes.ok) {
    await prisma.stockXStatusEvent.update({
      where: { id: event.id },
      data: {
        emailTo: sendRes.to,
        emailProvider: sendRes.provider,
        emailError: sendRes.error.slice(0, 1000),
      },
    });
    return {
      ok: false,
      sent: false,
      error: sendRes.error,
      matchId: c.orderMatchId,
      shopifyOrderName: c.shopifyOrderName,
      kind: opts.kind,
      milestoneKey,
      to: sendRes.to,
      etaLine: narrative.etaLine,
      imageUrl: c.imageUrl,
    };
  }

  await prisma.stockXStatusEvent.update({
    where: { id: event.id },
    data: {
      emailedAt: new Date(),
      emailTo: sendRes.to,
      emailProvider: sendRes.provider,
      emailProviderId: sendRes.providerMessageId || null,
      emailError: null,
    },
  });

  return {
    ok: true,
    sent: true,
    matchId: c.orderMatchId,
    shopifyOrderName: c.shopifyOrderName,
    kind: opts.kind,
    milestoneKey,
    to: sendRes.to,
    providerMessageId: sendRes.providerMessageId || null,
    etaLine: narrative.etaLine,
    imageUrl: c.imageUrl,
  };
}
