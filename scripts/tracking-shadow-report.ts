#!/usr/bin/env npx tsx
/**
 * Read-only shadow reconciliation: first-party funnel_events vs Shopify orders (+ internal CM2).
 * Sends nothing anywhere. docs/tracking/TRACKING-PLAN.md §7 / §10.
 *
 *   npx tsx scripts/tracking-shadow-report.ts               # last 14 days
 *   npx tsx scripts/tracking-shadow-report.ts --days=28 --json
 *   npx tsx scripts/tracking-shadow-report.ts --alert       # exit 2 when coverage < threshold
 *
 * Join keys: funnel_events.order_id (numeric) ↔ ShopifyOrder.shopifyOrderId (gid) ↔
 * OrderMatch.shopifyOrderId (gid). Legacy rows: props->>'orderId'.
 */
import "dotenv/config";

import { parseAbAssignments } from "../app/lib/funnel/payload";
import { prisma } from "../app/lib/prisma";
import { computeOrderProfit, profitAssumptionsFromEnv } from "../tracking/profit";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : "true";
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((1000 * n) / d) / 10 : null);

type DayRow = { day: string; orders: bigint; tracked: bigint };
type OrderRow = {
  oid: string;
  name: string;
  created: Date;
  total: number;
  tracked: boolean;
  completions: bigint;
  consent_marketing: boolean | null;
  has_gclid: boolean;
  has_gbraid_wbraid: boolean;
  has_fbclid: boolean;
  has_ttclid: boolean;
  utm_source: string | null;
  ab: string | null;
};
type LineRow = { oid: string; revenue: number; cost: number | null };

async function main() {
  const days = Math.max(1, Number(arg("days") ?? 14));
  const asJson = arg("json") === "true";
  const alert = arg("alert") === "true";
  const minCoverage = Number(process.env.TRACKING_SHADOW_MIN_COVERAGE_PCT ?? 80);
  const since = new Date(Date.now() - days * 86_400_000);

  const orders = await prisma.$queryRaw<OrderRow[]>`
    WITH fe AS (
      SELECT COALESCE(order_id, props->>'orderId') AS oid, *
      FROM public.funnel_events
      WHERE event_name = 'checkout_completed' AND created_at >= ${since} - interval '2 days'
    ),
    sess AS (
      SELECT DISTINCT ON (fe.oid) fe.oid, fe.session_id, fe.client_id
      FROM fe WHERE fe.oid IS NOT NULL ORDER BY fe.oid, fe.occurred_at
    ),
    sess_events AS (
      SELECT s.oid,
             bool_or(e.gclid IS NOT NULL) AS has_gclid,
             bool_or(e.gbraid IS NOT NULL OR e.wbraid IS NOT NULL) AS has_gbraid_wbraid,
             bool_or(e.fbclid IS NOT NULL) AS has_fbclid,
             bool_or(e.ttclid IS NOT NULL) AS has_ttclid,
             (array_agg(e.consent_marketing ORDER BY e.occurred_at DESC) FILTER (WHERE e.consent_marketing IS NOT NULL))[1] AS consent_marketing,
             (array_agg(e.utm_source ORDER BY e.occurred_at) FILTER (WHERE e.utm_source IS NOT NULL))[1] AS utm_source,
             (array_agg(e.ab_variant ORDER BY e.occurred_at DESC) FILTER (WHERE e.ab_variant IS NOT NULL))[1] AS ab
      FROM sess s
      JOIN public.funnel_events e
        ON COALESCE(e.session_id, e.client_id) = COALESCE(s.session_id, s.client_id)
       AND e.created_at >= ${since} - interval '2 days'
      GROUP BY s.oid
    ),
    completions AS (SELECT oid, COUNT(*) AS n FROM fe WHERE oid IS NOT NULL GROUP BY oid)
    SELECT o."shopifyOrderId" AS oid, o."orderName" AS name, o."createdAt" AS created,
           o."totalSalesChf"::float AS total,
           (c.oid IS NOT NULL) AS tracked, COALESCE(c.n, 0) AS completions,
           se.consent_marketing, COALESCE(se.has_gclid, false) AS has_gclid,
           COALESCE(se.has_gbraid_wbraid, false) AS has_gbraid_wbraid,
           COALESCE(se.has_fbclid, false) AS has_fbclid, COALESCE(se.has_ttclid, false) AS has_ttclid,
           se.utm_source, se.ab
    FROM "ShopifyOrder" o
    LEFT JOIN completions c ON 'gid://shopify/Order/' || c.oid = o."shopifyOrderId"
    LEFT JOIN sess_events se ON 'gid://shopify/Order/' || se.oid = o."shopifyOrderId"
    WHERE o."createdAt" >= ${since} AND o."cancelledAt" IS NULL
    ORDER BY o."createdAt"
  `;

  const byDay = await prisma.$queryRaw<DayRow[]>`
    WITH fe AS (
      SELECT DISTINCT COALESCE(order_id, props->>'orderId') AS oid
      FROM public.funnel_events
      WHERE event_name = 'checkout_completed' AND created_at >= ${since} - interval '2 days'
    )
    SELECT to_char(o."createdAt" AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD') AS day,
           COUNT(*) AS orders,
           COUNT(fe.oid) AS tracked
    FROM "ShopifyOrder" o
    LEFT JOIN fe ON 'gid://shopify/Order/' || fe.oid = o."shopifyOrderId"
    WHERE o."createdAt" >= ${since} AND o."cancelledAt" IS NULL
    GROUP BY 1 ORDER BY 1
  `;

  const lines = await prisma.$queryRaw<LineRow[]>`
    SELECT "shopifyOrderId" AS oid, "shopifyTotalPrice"::float AS revenue,
           COALESCE("manualCostOverride", "supplierCost")::float AS cost
    FROM "OrderMatch"
    WHERE "shopifyCreatedAt" >= ${since}
  `;
  const assumptions = profitAssumptionsFromEnv();
  const linesByOrder = new Map<string, LineRow[]>();
  for (const l of lines) linesByOrder.set(l.oid, [...(linesByOrder.get(l.oid) ?? []), l]);
  const profitByOrder = new Map(
    [...linesByOrder].map(([oid, ls]) => [
      oid,
      computeOrderProfit(
        ls.map((l) => ({ revenueGross: l.revenue, supplierCost: l.cost })),
        assumptions,
      ),
    ]),
  );

  const total = orders.length;
  const tracked = orders.filter((o) => o.tracked);
  const dupes = orders.filter((o) => Number(o.completions) > 1);
  const withConsent = tracked.filter((o) => o.consent_marketing === true);
  const profits = orders.map((o) => profitByOrder.get(o.oid)).filter((p) => p && p.costComplete);

  const abGroups = new Map<string, { orders: number; revenue: number; cm2: number; cm2Orders: number }>();
  for (const o of tracked) {
    for (const [exp, variant] of Object.entries(parseAbAssignments(o.ab))) {
      const k = `${exp}:${variant}`;
      const g = abGroups.get(k) ?? { orders: 0, revenue: 0, cm2: 0, cm2Orders: 0 };
      g.orders++;
      g.revenue += o.total;
      const p = profitByOrder.get(o.oid);
      if (p?.costComplete) {
        g.cm2 += p.cm2;
        g.cm2Orders++;
      }
      abGroups.set(k, g);
    }
  }

  const summary = {
    days,
    since: since.toISOString(),
    shopifyOrders: total,
    trackedOrders: tracked.length,
    coveragePct: pct(tracked.length, total),
    duplicateCompletions: dupes.length,
    trackedWithMarketingConsentPct: pct(withConsent.length, tracked.length),
    clickIdShareAmongConsented: {
      gclid: pct(withConsent.filter((o) => o.has_gclid).length, withConsent.length),
      gbraidWbraid: pct(withConsent.filter((o) => o.has_gbraid_wbraid).length, withConsent.length),
      fbclid: pct(withConsent.filter((o) => o.has_fbclid).length, withConsent.length),
      ttclid: pct(withConsent.filter((o) => o.has_ttclid).length, withConsent.length),
    },
    sourceOfTrackedOrders: Object.fromEntries(
      [...tracked.reduce((m, o) => m.set(o.utm_source ?? "(direct/none)", (m.get(o.utm_source ?? "(direct/none)") ?? 0) + 1), new Map<string, number>())].sort(
        (a, b) => b[1] - a[1],
      ),
    ),
    internalProfit: {
      note: "internal CM2 estimate — reporting only, never sent",
      assumptions,
      ordersWithCompleteCost: profits.length,
      ordersWithCompleteCostPct: pct(profits.length, total),
      avgCm2: profits.length ? Math.round((profits.reduce((s, p) => s + p!.cm2, 0) / profits.length) * 100) / 100 : null,
      cm2PctOfRevenue: profits.length
        ? Math.round((profits.reduce((s, p) => s + p!.cm2, 0) / profits.reduce((s, p) => s + p!.revenueGross, 0)) * 1000) / 1000
        : null,
    },
    abTrackedOrders: Object.fromEntries(
      [...abGroups].map(([k, g]) => [
        k,
        { orders: g.orders, revenue: Math.round(g.revenue), avgCm2: g.cm2Orders ? Math.round(g.cm2 / g.cm2Orders) : null },
      ]),
    ),
    byDay: byDay.map((d) => ({
      day: d.day,
      orders: Number(d.orders),
      tracked: Number(d.tracked),
      coveragePct: pct(Number(d.tracked), Number(d.orders)),
    })),
    untrackedSample: orders
      .filter((o) => !o.tracked)
      .slice(-15)
      .map((o) => ({ name: o.name, created: o.created, total: o.total })),
  };

  if (asJson) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`Shadow reconciliation last ${days}d — Shopify orders=${total}, tracked=${tracked.length} (${summary.coveragePct ?? "-"}%), duplicate completions=${dupes.length}`);
    console.log(`marketing consent among tracked: ${summary.trackedWithMarketingConsentPct ?? "-"}%  click ids among consented:`, summary.clickIdShareAmongConsented);
    console.log("sources:", summary.sourceOfTrackedOrders);
    console.log("internal CM2 (not sent):", summary.internalProfit);
    console.log("A/B tracked orders:", summary.abTrackedOrders);
    console.log("\nday         orders tracked coverage");
    for (const d of summary.byDay) console.log(`${d.day}  ${String(d.orders).padStart(6)} ${String(d.tracked).padStart(7)} ${String(d.coveragePct ?? "-").padStart(7)}%`);
    if (summary.untrackedSample.length) console.log("\nuntracked (latest):", summary.untrackedSample);
  }

  if (alert && total >= 10 && (summary.coveragePct ?? 0) < minCoverage) {
    console.error(`ALERT coverage ${summary.coveragePct}% < ${minCoverage}%`);
    process.exitCode = 2;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
