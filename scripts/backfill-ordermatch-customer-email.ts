#!/usr/bin/env npx tsx
/**
 * Patch OrderMatch.shopifyCustomerEmail (and first/last) when null for StockX-
 * linked rows (order number 01-/02-/03-*). Fetches email from Shopify Admin
 * GraphQL only — does NOT send customer email.
 *
 * Usage:
 *   npx tsx scripts/backfill-ordermatch-customer-email.ts           # dry-run
 *   npx tsx scripts/backfill-ordermatch-customer-email.ts --apply
 *   npx tsx scripts/backfill-ordermatch-customer-email.ts --apply --limit=50
 */
import "dotenv/config";
import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";

const APPLY = process.argv.includes("--apply");
const LIMIT = (() => {
  const hit = process.argv.find((a) => a.startsWith("--limit="));
  if (!hit) return 5_000;
  const n = Number(hit.slice("--limit=".length));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5_000;
})();

const BATCH = 50;

type OrderNode = {
  id: string;
  name: string;
  email?: string | null;
  customer?: {
    firstName?: string | null;
    lastName?: string | null;
    defaultEmailAddress?: { emailAddress?: string | null } | null;
  } | null;
};

async function fetchOrderCustomers(ids: string[]): Promise<Map<string, OrderNode>> {
  const out = new Map<string, OrderNode>();
  if (!ids.length) return out;

  const QUERY = /* GraphQL */ `
    query BackfillOrderEmails($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Order {
          id
          name
          email
          customer {
            firstName
            lastName
            defaultEmailAddress { emailAddress }
          }
        }
      }
    }
  `;

  const { data, errors } = await shopifyGraphQL<{ nodes: Array<OrderNode | null> }>(
    QUERY,
    { ids }
  );
  if (errors?.length) {
    throw new Error(errors.map((e) => e.message).join("; "));
  }
  for (const node of data?.nodes ?? []) {
    if (node?.id) out.set(node.id, node);
  }
  return out;
}

function pickEmail(node: OrderNode): string | null {
  const fromCustomer = node.customer?.defaultEmailAddress?.emailAddress?.trim();
  const fromOrder = node.email?.trim();
  return fromCustomer || fromOrder || null;
}

async function main() {
  const rows = await prisma.orderMatch.findMany({
    where: {
      shopifyCustomerEmail: null,
      stockxOrderNumber: { not: null },
    },
    select: {
      id: true,
      shopifyOrderId: true,
      shopifyOrderName: true,
      stockxOrderNumber: true,
    },
    take: LIMIT,
    orderBy: { createdAt: "desc" },
  });

  const targets = rows.filter((r) => /^0[1-3]-/.test(String(r.stockxOrderNumber || "")));
  console.log(
    `[backfill-email] candidates=${targets.length} (of ${rows.length} null-email rows scanned, limit=${LIMIT}) apply=${APPLY}`
  );

  const byOrder = new Map<string, typeof targets>();
  for (const r of targets) {
    const oid = String(r.shopifyOrderId || "").trim();
    if (!oid) continue;
    const list = byOrder.get(oid) ?? [];
    list.push(r);
    byOrder.set(oid, list);
  }

  const orderIds = [...byOrder.keys()];
  let patched = 0;
  let missingEmail = 0;
  let notFound = 0;
  let errors = 0;

  for (let i = 0; i < orderIds.length; i += BATCH) {
    const chunk = orderIds.slice(i, i + BATCH);
    let nodes: Map<string, OrderNode>;
    try {
      nodes = await fetchOrderCustomers(chunk);
    } catch (e: any) {
      console.error(`[backfill-email] GraphQL batch failed:`, e?.message || e);
      errors += chunk.length;
      continue;
    }

    for (const oid of chunk) {
      const matches = byOrder.get(oid) ?? [];
      const node = nodes.get(oid);
      if (!node) {
        notFound += matches.length;
        console.warn(`[backfill-email] order not found: ${oid} (${matches[0]?.shopifyOrderName})`);
        continue;
      }
      const email = pickEmail(node);
      if (!email) {
        missingEmail += matches.length;
        console.warn(`[backfill-email] no email on Shopify: ${node.name}`);
        continue;
      }
      const firstName = node.customer?.firstName?.trim() || null;
      const lastName = node.customer?.lastName?.trim() || null;

      if (!APPLY) {
        console.log(
          `[dry-run] ${node.name} → ${email} (${matches.length} OrderMatch row(s))`
        );
        patched += matches.length;
        continue;
      }

      const ids = matches.map((m) => m.id);
      const res = await prisma.orderMatch.updateMany({
        where: {
          id: { in: ids },
          shopifyCustomerEmail: null,
        },
        data: {
          shopifyCustomerEmail: email,
          ...(firstName ? { shopifyCustomerFirstName: firstName } : {}),
          ...(lastName ? { shopifyCustomerLastName: lastName } : {}),
        },
      });
      patched += res.count;
      console.log(`[apply] ${node.name} → ${email} patched=${res.count}`);
    }
  }

  console.log(
    JSON.stringify(
      {
        apply: APPLY,
        candidates: targets.length,
        patched,
        missingEmail,
        notFound,
        errors,
      },
      null,
      2
    )
  );
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error("[backfill-email] fatal", e);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(1);
  });
