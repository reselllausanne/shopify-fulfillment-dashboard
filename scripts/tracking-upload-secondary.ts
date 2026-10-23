#!/usr/bin/env npx tsx
/**
 * G4 — upload Secondary click conversions from funnel_events → Google Ads.
 *
 * Default = dry-run (build + validate action, no upload).
 *   npx tsx scripts/tracking-upload-secondary.ts --days=7
 *   npx tsx scripts/tracking-upload-secondary.ts --days=1 --validate-only
 *   npx tsx scripts/tracking-upload-secondary.ts --days=1 --live
 *
 * Requires VPS env: TRACKING_GOOGLE_ADS_SECONDARY_ENABLED=1,
 * TRACKING_GOOGLE_ADS_SECONDARY_APPROVED_AT=YYYY-MM-DD,
 * TRACKING_GOOGLE_ADS_SECONDARY_ACTION_ID=<new Secondary UPLOAD_CLICKS id>,
 * plus GOOGLE_ADS_* credentials. Never reuse Simprosys action ids.
 */
import "dotenv/config";

import { resolveAdsConfig } from "../adsanalytics/config";
import { prisma } from "../app/lib/prisma";
import type { ShadowPurchase } from "../tracking/contract";
import {
  buildSecondaryClickConversion,
  loadSecondaryActionCheck,
  sendGoogleAdsSecondary,
  validateSecondaryAction,
} from "../tracking/adapters/googleAdsSecondary";
import { destinationGate, isProductionId } from "../tracking/guards";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : "true";
}

type CandidateRow = {
  order_id: string;
  occurred_at: Date;
  value: number | null;
  currency: string | null;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  consent_marketing: boolean | null;
};

function toPurchase(row: CandidateRow): ShadowPurchase {
  return {
    orderId: row.order_id,
    orderName: null,
    occurredAt: row.occurred_at,
    currency: row.currency || "CHF",
    revenue: Number(row.value ?? 0),
    tax: null,
    shipping: null,
    items: [],
    clientId: null,
    sessionId: null,
    clickIds: {
      ...(row.gclid ? { gclid: row.gclid } : {}),
      ...(row.gbraid ? { gbraid: row.gbraid } : {}),
      ...(row.wbraid ? { wbraid: row.wbraid } : {}),
    },
    consent: {
      analytics: null,
      marketing: row.consent_marketing,
      saleOfData: null,
    },
    email: null,
    phone: null,
    country: null,
    ip: null,
    userAgent: null,
    pageUrl: null,
  };
}

async function main() {
  const days = Math.max(1, Number(arg("days") ?? 7));
  const live = arg("live") === "true";
  const validateOnly = arg("validate-only") === "true";
  const since = new Date(Date.now() - days * 86_400_000);

  const actionId = String(process.env.TRACKING_GOOGLE_ADS_SECONDARY_ACTION_ID ?? "").trim();
  if (!actionId) throw new Error("TRACKING_GOOGLE_ADS_SECONDARY_ACTION_ID missing");
  if (isProductionId(actionId)) throw new Error("ACTION_ID is a production Simprosys id — refuse");

  const gate = destinationGate("google_ads_secondary");
  console.log(`gate open=${gate.open} reasons=${gate.reasons.join("; ") || "(none)"}`);
  if ((live || validateOnly) && !gate.open) {
    throw new Error(`destination gate closed: ${gate.reasons.join("; ")}`);
  }

  const ads = resolveAdsConfig();
  const check = await loadSecondaryActionCheck(ads, actionId);
  if (!check) throw new Error(`conversion action ${actionId} not found`);
  const problems = validateSecondaryAction(check);
  console.log("action:", check);
  if (problems.length) throw new Error(`Secondary action rejected: ${problems.join("; ")}`);

  // Prefer click ids from any funnel event on the same session; fall back to completion row.
  const rows = await prisma.$queryRaw<CandidateRow[]>`
    WITH completions AS (
      SELECT DISTINCT ON (COALESCE(order_id, props->>'orderId'))
             COALESCE(order_id, props->>'orderId') AS order_id,
             occurred_at,
             value,
             currency,
             session_id,
             client_id,
             consent_marketing,
             gclid,
             gbraid,
             wbraid
      FROM public.funnel_events
      WHERE event_name = 'checkout_completed'
        AND created_at >= ${since}
        AND COALESCE(order_id, props->>'orderId') IS NOT NULL
      ORDER BY COALESCE(order_id, props->>'orderId'), occurred_at
    ),
    click AS (
      SELECT c.order_id,
             (array_agg(e.gclid ORDER BY e.occurred_at DESC) FILTER (WHERE e.gclid IS NOT NULL))[1] AS gclid,
             (array_agg(e.gbraid ORDER BY e.occurred_at DESC) FILTER (WHERE e.gbraid IS NOT NULL))[1] AS gbraid,
             (array_agg(e.wbraid ORDER BY e.occurred_at DESC) FILTER (WHERE e.wbraid IS NOT NULL))[1] AS wbraid,
             (array_agg(e.consent_marketing ORDER BY e.occurred_at DESC) FILTER (WHERE e.consent_marketing IS NOT NULL))[1] AS consent_marketing
      FROM completions c
      LEFT JOIN public.funnel_events e
        ON COALESCE(e.session_id, e.client_id) = COALESCE(c.session_id, c.client_id)
       AND e.created_at >= ${since} - interval '2 days'
      GROUP BY c.order_id
    )
    SELECT c.order_id, c.occurred_at, c.value::float AS value, c.currency,
           COALESCE(k.gclid, c.gclid) AS gclid,
           COALESCE(k.gbraid, c.gbraid) AS gbraid,
           COALESCE(k.wbraid, c.wbraid) AS wbraid,
           COALESCE(k.consent_marketing, c.consent_marketing) AS consent_marketing
    FROM completions c
    LEFT JOIN click k ON k.order_id = c.order_id
    ORDER BY c.occurred_at
  `;

  let built = 0;
  let skipped = 0;
  let sent = 0;
  const sample: unknown[] = [];

  for (const row of rows) {
    const purchase = toPurchase(row);
    const body = buildSecondaryClickConversion(purchase, ads.customerId, actionId, purchase.revenue);
    if (!body) {
      skipped += 1;
      continue;
    }
    built += 1;
    if (sample.length < 5) sample.push(body);

    if (!live && !validateOnly) continue;

    const result = await sendGoogleAdsSecondary({
      purchase,
      customerId: ads.customerId,
      conversionActionId: actionId,
      actionCheck: check,
      adsConfig: ads,
      validateOnly: validateOnly && !live,
    });
    if (result.status === "uploaded" || result.status === "validate_only") sent += 1;
    else skipped += 1;
  }

  console.log(
    JSON.stringify(
      {
        days,
        mode: live ? "live" : validateOnly ? "validate_only" : "dry_run",
        candidates: rows.length,
        built,
        skipped,
        sent,
        sample,
      },
      null,
      2,
    ),
  );

  if (!live && !validateOnly) {
    console.log("Dry-run only. Pass --validate-only (API validate) or --live after APPROVED_AT.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
