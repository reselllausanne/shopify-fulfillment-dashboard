#!/usr/bin/env npx tsx
/**
 * Periodic reconcile — catch express_available / express_price desyncs the
 * webhooks missed (missed deliveries, out-of-band edits, price drift).
 *
 * express_available is also reconciled by the convergence cron (physical qty),
 * but this pass additionally enforces the express_price >= price floor per
 * variant across the whole catalog, using the exact same idempotent worker as
 * the products/update webhook.
 *
 * Usage:
 *   npx tsx scripts/reconcile-express-metafields.ts               # dry-run, whole catalog
 *   npx tsx scripts/reconcile-express-metafields.ts --write
 *   npx tsx scripts/reconcile-express-metafields.ts --write --query "tag:stockx"
 *   npx tsx scripts/reconcile-express-metafields.ts --write --variant gid://shopify/ProductVariant/123 [...]
 */
import "dotenv/config";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { prisma } from "@/app/lib/prisma";
import { syncExpressForVariants } from "@/shopify/inventory/expressRepriceSync";

const WRITE = process.argv.includes("--write");

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

function argValues(flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === flag && process.argv[i + 1]) out.push(process.argv[i + 1]);
  }
  return out;
}

const PRODUCTS_PAGE_QUERY = /* GraphQL */ `
query ExpressReconcileProducts($cursor: String, $query: String) {
  products(first: 50, after: $cursor, query: $query) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      variants(first: 100) { nodes { id } }
    }
  }
}
`;

async function* iterateVariantIds(query: string | null): AsyncGenerator<string[]> {
  let cursor: string | null = null;
  for (;;) {
    const { data, errors } = await shopifyGraphQL<{
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{ id: string; variants: { nodes: Array<{ id: string }> } }>;
      };
    }>(PRODUCTS_PAGE_QUERY, { cursor, query: query ?? undefined });
    if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
    const products = data?.products;
    if (!products) return;
    const ids = products.nodes.flatMap((p) => p.variants.nodes.map((v) => v.id));
    if (ids.length) yield ids;
    if (!products.pageInfo.hasNextPage) return;
    cursor = products.pageInfo.endCursor;
  }
}

async function main() {
  const explicitVariants = argValues("--variant");
  const query = argValue("--query");

  let scanned = 0;
  let changed = 0;
  const warnings: string[] = [];
  const sample: unknown[] = [];

  const runBatch = async (variantIds: string[]) => {
    // chunk to 100 variant nodes per Shopify read
    for (let i = 0; i < variantIds.length; i += 100) {
      const batch = variantIds.slice(i, i + 100);
      scanned += batch.length;
      const res = await syncExpressForVariants(batch, { dryRun: !WRITE });
      changed += res.changed.length;
      warnings.push(...res.warnings);
      for (const c of res.changed) if (sample.length < 50) sample.push(c);
      if (res.changed.length > 0 || res.warnings.length > 0) {
        console.log(
          `[reconcile]${WRITE ? "" : " DRY"} batch=${batch.length} changed=${res.changed.length} warnings=${res.warnings.length}`
        );
      }
    }
  };

  if (explicitVariants.length > 0) {
    await runBatch(explicitVariants);
  } else {
    for await (const ids of iterateVariantIds(query)) {
      await runBatch(ids);
    }
  }

  console.log(
    JSON.stringify({ write: WRITE, query: query ?? null, scanned, changed, warnings, sample }, null, 2)
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
