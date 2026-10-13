/**
 * Catch-all for Website stock drift that `stx-refresh` cannot see (e.g. the
 * Python consumer zeroed a size from a stale rawJson while the DB kept it > 0).
 *
 * 1. Bulk-export every variant's "available" at the online location.
 * 2. Candidate products: a variant whose Website stock disagrees with its STX
 *    `SupplierVariant.stock` (0 vs > 0).
 * 3. Per candidate: re-check live KicksDB and apply `syncShopifyStxStockForProduct`
 *    (live asks decide, not the DB).
 */
import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { fetchStockxProductByIdOrSlugRaw } from "@/galaxus/kickdb/client";
import { kickdbStockxFetchId } from "@/galaxus/jobs/stxSync";
import { ONLINE_LOCATION } from "@/shopify/inventory/locationConfig";
import {
  emptyStxStockStats,
  syncShopifyStxStockForProduct,
  type StxStockStats,
} from "@/shopify/stx/stxStockShopify";

const BULK_QUERY = `{
  productVariants {
    edges {
      node {
        id
        product { id }
        inventoryItem {
          inventoryLevel(locationId: "${ONLINE_LOCATION.id}") {
            quantities(names: ["available"]) { quantity }
          }
        }
      }
    }
  }
}`;

const BULK_RUN = /* GraphQL */ `
mutation StxStockBulk($query: String!) {
  bulkOperationRunQuery(query: $query) {
    bulkOperation { id }
    userErrors { message }
  }
}`;

const BULK_NODE = /* GraphQL */ `
query StxStockBulkPoll($id: ID!) {
  node(id: $id) { ... on BulkOperation { status errorCode url objectCount } }
}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One bulk query per shop at a time (the location mirror uses it too): wait for the slot. */
async function startBulk(timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await shopifyGraphQL<{
      bulkOperationRunQuery: { bulkOperation: { id: string } | null; userErrors: Array<{ message: string }> };
    }>(BULK_RUN, { query: BULK_QUERY });
    if (res.errors?.length) throw new Error(`bulk start: ${res.errors.map((e) => e.message).join("; ")}`);
    const ue = res.data?.bulkOperationRunQuery?.userErrors ?? [];
    const id = res.data?.bulkOperationRunQuery?.bulkOperation?.id;
    if (id && ue.length === 0) return id;
    const busy = ue.some((e) => /already in progress/i.test(e.message));
    if (!busy || Date.now() > deadline) throw new Error(`bulk start: ${ue.map((e) => e.message).join("; ")}`);
    await sleep(30_000);
  }
}

async function waitBulk(id: string, timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await shopifyGraphQL<{
      node: { status: string; errorCode: string | null; url: string | null } | null;
    }>(BULK_NODE, { id });
    const op = res.data?.node;
    if (op?.status === "COMPLETED") return op.url;
    if (op && ["FAILED", "CANCELED", "EXPIRED"].includes(op.status)) {
      throw new Error(`bulk ${op.status}: ${op.errorCode ?? "unknown"}`);
    }
    await sleep(5_000);
  }
  throw new Error("bulk timed out");
}

/** variantId → { productId, available } for variants stocked at the online location. */
async function exportWebsiteStock(): Promise<Map<string, { productId: string; available: number }>> {
  const id = await startBulk(20 * 60_000);
  const url = await waitBulk(id, 60 * 60_000);
  const out = new Map<string, { productId: string; available: number }>();
  if (!url) return out;
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`bulk download HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const handle = (line: string) => {
    if (!line.trim()) return;
    const obj = JSON.parse(line);
    const level = obj?.inventoryItem?.inventoryLevel;
    if (!obj?.id || !obj?.product?.id || !level) return;
    out.set(obj.id, { productId: obj.product.id, available: Number(level.quantities?.[0]?.quantity ?? 0) });
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      handle(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 1);
    }
  }
  handle(buffer);
  return out;
}

export type StxStockReconcileResult = StxStockStats & {
  variantsExported: number;
  candidateProducts: number;
  products: number;
  kicksFail: number;
  shopifyFail: number;
};

export async function reconcileShopifyStxStock(options: {
  apply: boolean;
  limit?: number;
  shards?: number;
  shard?: number;
  progressEvery?: number;
}): Promise<StxStockReconcileResult> {
  const shards = Math.max(1, options.shards ?? 1);
  const shard = Math.min(shards - 1, Math.max(0, options.shard ?? 0));
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  const progressEvery = options.progressEvery ?? 500;

  const website = await exportWebsiteStock();
  console.info(`[stx-stock-reconcile] website variants exported: ${website.size}`);

  const candidateProducts = new Set<string>();
  const variantIds = Array.from(website.keys());
  for (let i = 0; i < variantIds.length; i += 5000) {
    const chunk = variantIds.slice(i, i + 5000);
    const rows = await prisma.$queryRaw<Array<{ externalVariantId: string; stock: number }>>`
      SELECT cls."externalVariantId", MAX(sv.stock)::int AS stock
      FROM "ChannelListingState" cls
      JOIN "SupplierVariant" sv ON sv."supplierVariantId" = cls."supplierVariantId"
      WHERE cls.channel = 'SHOPIFY'
        AND cls."externalVariantId" = ANY(${chunk}::text[])
        AND sv."supplierVariantId" LIKE 'stx_%'
      GROUP BY cls."externalVariantId"`;
    for (const r of rows) {
      const w = website.get(r.externalVariantId);
      if (!w) continue;
      const dbInStock = Number(r.stock) > 0;
      if (dbInStock !== w.available > 0 && w.available >= 0) candidateProducts.add(w.productId);
    }
  }

  const candidates = Array.from(candidateProducts)
    .filter((id) => shards === 1 || Number(BigInt(id.replace(/\D/g, "") || "0") % BigInt(shards)) === shard)
    .sort();
  console.info(`[stx-stock-reconcile] candidate products: ${candidateProducts.size} (shard ${shard}/${shards}: ${candidates.length})`);

  const stats = emptyStxStockStats();
  let products = 0;
  let kicksFail = 0;
  let shopifyFail = 0;
  for (let i = 0; i < candidates.length && products < limit; i += 200) {
    const batch = candidates.slice(i, i + 200);
    const syncRows = await prisma.shopifySyncState.findMany({
      where: { shopifyProductId: { in: batch }, syncStatus: "synced" },
      select: { shopifyProductId: true, product: { select: { kickdbProductId: true, urlKey: true, notFound: true } } },
    });
    for (const row of syncRows) {
      if (products >= limit) break;
      products += 1;
      if (products % progressEvery === 0) {
        const { examples: _e, ...counts } = stats;
        console.info(`[stx-stock-reconcile] progress ${products}/${candidates.length}`, { ...counts, kicksFail, shopifyFail });
      }
      let payload: unknown = null;
      if (!row.product.notFound) {
        try {
          payload = (await fetchStockxProductByIdOrSlugRaw(kickdbStockxFetchId(row.product))).product;
        } catch (err) {
          kicksFail += 1;
          continue;
        }
      }
      try {
        await syncShopifyStxStockForProduct({
          shopifyProductId: row.shopifyProductId!,
          payload,
          apply: options.apply,
          stats,
        });
      } catch (err) {
        shopifyFail += 1;
        console.error(`[stx-stock-reconcile] shopify ${row.shopifyProductId}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  return {
    ...stats,
    variantsExported: website.size,
    candidateProducts: candidateProducts.size,
    products,
    kicksFail,
    shopifyFail,
  };
}
