#!/usr/bin/env npx tsx
/**
 * One-shot: insert server.orders_paid checkout_completed for ShopifyOrder rows
 * missing a funnel completion (last N days). Does not call Shopify API.
 *
 *   npx tsx scripts/funnel-backfill-orders-paid.ts --days=14 [--dry-run]
 */
import "dotenv/config";

import { ensureServerCheckoutCompleted } from "../app/lib/funnel/serverPurchase";
import { prisma } from "../app/lib/prisma";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : "true";
}

async function main() {
  const days = Math.max(1, Number(arg("days") ?? 14));
  const dry = arg("dry-run") === "true";
  const since = new Date(Date.now() - days * 86_400_000);

  const missing = await prisma.$queryRaw<
    Array<{
      oid: string;
      name: string;
      created: Date;
      total: number;
      currency: string;
      gateways: string[];
    }>
  >`
    SELECT o."shopifyOrderId" AS oid,
           o."orderName" AS name,
           o."createdAt" AS created,
           o."totalSalesChf"::float AS total,
           o."currencyCode" AS currency,
           o."paymentGatewayNames" AS gateways
    FROM "ShopifyOrder" o
    WHERE o."createdAt" >= ${since}
      AND o."cancelledAt" IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.funnel_events fe
        WHERE fe.event_name = 'checkout_completed'
          AND fe.order_id = regexp_replace(o."shopifyOrderId", '.*/', '')
      )
    ORDER BY o."createdAt" DESC
  `;

  console.log(`Missing completions last ${days}d: ${missing.length}${dry ? " (dry-run)" : ""}`);

  let inserted = 0;
  for (const row of missing) {
    const numeric = row.oid.slice(row.oid.lastIndexOf("/") + 1);
    if (dry) {
      console.log(" would insert", row.name, numeric, row.total);
      continue;
    }
    const res = await ensureServerCheckoutCompleted({
      id: numeric,
      admin_graphql_api_id: row.oid.startsWith("gid://") ? row.oid : `gid://shopify/Order/${numeric}`,
      created_at: row.created.toISOString(),
      current_total_price: row.total,
      currency: row.currency,
      payment_gateway_names: row.gateways ?? [],
    });
    if (res.inserted) {
      inserted++;
      console.log(" inserted", row.name, numeric);
    } else {
      console.log(" skip", row.name, res.reason);
    }
  }

  console.log({ missing: missing.length, inserted, dry });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
