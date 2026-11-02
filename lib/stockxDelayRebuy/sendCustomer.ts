import { prisma } from "@/app/lib/prisma";
import { getMailer } from "@/app/lib/mailer";
import { buildDelayRebuyCase } from "@/lib/stockxDelayRebuy/buildCase";
import {
  buildClientPreviewHtml,
  buildClientPreviewText,
} from "@/lib/stockxDelayRebuy/emails";
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
   * Force recipient (TEST). Prefer STOCKX_ALERT_EMAIL.
   * When set, ignoreOverride=true so Postmark always hits this address.
   */
  toOverride?: string | null;
  /** Re-send even if StockXStatusEvent already emailed. */
  force?: boolean;
  /** Prefix subject with [TEST] when mailing ops instead of customer. */
  testMode?: boolean;
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
};

/**
 * Shopify customer delay / cancel-rebuy mail (StockX never named).
 * Dedupe via StockXStatusEvent(orderMatchId, CUSTOMER_* milestoneKey).
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
    };
  }

  const override = (opts.toOverride || "").trim();
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
    };
  }

  const subject = testMode
    ? `[TEST] ${narrative.subject}`
    : narrative.subject;
  const text = buildClientPreviewText(c, narrative).replace(
    "— Resell Lausanne (preview client, pas envoyé au client)",
    testMode
      ? `— Resell Lausanne [TEST → ${to}; client serait ${customer || "n/a"}]`
      : "— Resell Lausanne"
  );
  const html = buildClientPreviewHtml(c, narrative);

  const mailer = getMailer();
  const sendRes = await mailer.sendRawEmail({
    to,
    subject,
    textBody: text,
    htmlBody: html,
    // Explicit test/override must not be redirected by POSTMARK_OVERRIDE_TO.
    ignoreOverride: Boolean(override) || testMode,
  });

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
  };
}
