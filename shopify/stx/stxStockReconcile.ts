/**
 * Catch-all for Website stock drift that `stx-refresh` cannot see (e.g. the
 * Python consumer zeroed a size from a stale rawJson while the DB kept it > 0).
 *
 * 1. Bulk-export every variant (title/barcode/price/metafields + "available" at
 *    the online location) — a few points total, no per-product reads.
 * 2. Candidate products: a variant whose Website stock disagrees with its STX
 *    `SupplierVariant.stock` (0 vs > 0).
 * 3. Per candidate: re-check live KicksDB and decide from the export
 *    (live asks decide, not the DB); changes are batched across products into
 *    `inventorySetQuantities` calls. A failed batch (e.g. quantity moved since
 *    the export → compare-and-set mismatch) falls back to the per-product path
 *    with a fresh read.
 */
import { prisma } from "@/app/lib/prisma";
import { fetchStockxProductByIdOrSlugRaw } from "@/galaxus/kickdb/client";
import { kickdbStockxFetchId } from "@/galaxus/jobs/stxSync";
import { exportVariantSnapshot, type VariantSnapshot } from "@/shopify/bulk/variantSnapshot";
import { ONLINE_LOCATION } from "@/shopify/inventory/locationConfig";
import {
  applyStxStockChanges,
  countStxStockApplied,
  emptyStxStockStats,
  liveVariantsFromPayload,
  MAX_QUANTITIES_PER_SET,
  planStxStockChanges,
  syncShopifyStxStockForProduct,
  toProductGid,
  type StxShopifyVariant,
  type StxStockChange,
  type StxStockStats,
} from "@/shopify/stx/stxStockShopify";

export function snapshotToStxVariant(v: VariantSnapshot): StxShopifyVariant {
  const mf = (key: string) => (v.metafields[key] === undefined ? null : { value: v.metafields[key] ?? null });
  return {
    id: v.id,
    title: v.title,
    price: v.price,
    barcode: v.barcode,
    usSize: mf("us_size"),
    priceLocked: mf("price_locked"),
    inventoryItem: v.inventoryItemId
      ? {
          id: v.inventoryItemId,
          inventoryLevel: v.available == null ? null : { quantities: [{ quantity: v.available }] },
        }
      : null,
  };
}

export type StxStockReconcileResult = StxStockStats & {
  variantsExported: number;
  candidateProducts: number;
  products: number;
  kicksFail: number;
  shopifyFail: number;
  setCalls: number;
  batchFallbacks: number;
};

export async function reconcileShopifyStxStock(options: {
  apply: boolean;
  limit?: number;
  shards?: number;
  shard?: number;
  progressEvery?: number;
  /** Quantities per `inventorySetQuantities` call (≤ 250). */
  batchSize?: number;
}): Promise<StxStockReconcileResult> {
  const shards = Math.max(1, options.shards ?? 1);
  const shard = Math.min(shards - 1, Math.max(0, options.shard ?? 0));
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  const progressEvery = options.progressEvery ?? 500;
  const batchSize = Math.min(MAX_QUANTITIES_PER_SET, Math.max(1, options.batchSize ?? 200));

  const snapshot = await exportVariantSnapshot({
    locationId: ONLINE_LOCATION.id,
    metafieldKeys: ["us_size", "price_locked"],
  });
  const nodesByProduct = new Map<string, StxShopifyVariant[]>();
  let websiteVariants = 0;
  for (const v of snapshot.values()) {
    if (v.available != null) websiteVariants += 1;
    let list = nodesByProduct.get(v.productId);
    if (!list) {
      list = [];
      nodesByProduct.set(v.productId, list);
    }
    list.push(snapshotToStxVariant(v));
  }
  console.info(`[stx-stock-reconcile] variants exported: ${snapshot.size} (website-stocked: ${websiteVariants})`);

  const candidateProducts = new Set<string>();
  const stocked = Array.from(snapshot.values()).filter((v) => v.available != null);
  for (let i = 0; i < stocked.length; i += 5000) {
    const chunk = stocked.slice(i, i + 5000);
    const rows = await prisma.$queryRaw<Array<{ externalVariantId: string; stock: number }>>`
      SELECT cls."externalVariantId", MAX(sv.stock)::int AS stock
      FROM "ChannelListingState" cls
      JOIN "SupplierVariant" sv ON sv."supplierVariantId" = cls."supplierVariantId"
      WHERE cls.channel = 'SHOPIFY'
        AND cls."externalVariantId" = ANY(${chunk.map((v) => v.id)}::text[])
        AND sv."supplierVariantId" LIKE 'stx_%'
      GROUP BY cls."externalVariantId"`;
    for (const r of rows) {
      const w = snapshot.get(r.externalVariantId);
      if (!w || w.available == null) continue;
      const dbInStock = Number(r.stock) > 0;
      if (dbInStock !== w.available > 0 && w.available >= 0) candidateProducts.add(w.productId);
    }
  }
  const variantsExported = snapshot.size;
  snapshot.clear();

  const candidates = Array.from(candidateProducts)
    .filter((id) => shards === 1 || Number(BigInt(id.replace(/\D/g, "") || "0") % BigInt(shards)) === shard)
    .sort();
  console.info(`[stx-stock-reconcile] candidate products: ${candidateProducts.size} (shard ${shard}/${shards}: ${candidates.length})`);

  const stats = emptyStxStockStats();
  let products = 0;
  let kicksFail = 0;
  let shopifyFail = 0;
  let setCalls = 0;
  let batchFallbacks = 0;

  let pending: StxStockChange[] = [];
  const pendingPayloads = new Map<string, unknown | null>();

  const flush = async () => {
    if (pending.length === 0) return;
    const batch = pending;
    const payloads = new Map(pendingPayloads);
    pending = [];
    pendingPayloads.clear();
    if (!options.apply) {
      countStxStockApplied(batch, stats);
      return;
    }
    try {
      setCalls += 1;
      await applyStxStockChanges(batch);
      countStxStockApplied(batch, stats);
    } catch (err) {
      batchFallbacks += 1;
      console.warn(
        `[stx-stock-reconcile] batch of ${batch.length} failed, per-product fallback:`,
        err instanceof Error ? err.message : err
      );
      // Fresh read per product; only its apply outcome is merged (skips were counted at plan time).
      for (const productGid of new Set(batch.map((c) => c.productGid))) {
        const scratch = emptyStxStockStats();
        try {
          await syncShopifyStxStockForProduct({
            shopifyProductId: productGid,
            payload: payloads.get(productGid) ?? null,
            apply: true,
            stats: scratch,
          });
        } catch (e) {
          shopifyFail += 1;
          console.error(`[stx-stock-reconcile] shopify ${productGid}:`, e instanceof Error ? e.message : e);
          continue;
        }
        stats.zeroed += scratch.zeroed;
        stats.restored += scratch.restored;
        stats.applyFail += scratch.applyFail;
      }
    }
  };

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
        console.info(`[stx-stock-reconcile] progress ${products}/${candidates.length}`, {
          ...counts,
          kicksFail,
          shopifyFail,
          setCalls,
          batchFallbacks,
        });
      }
      let payload: unknown = null;
      if (!row.product.notFound) {
        try {
          payload = (await fetchStockxProductByIdOrSlugRaw(kickdbStockxFetchId(row.product))).product;
        } catch {
          kicksFail += 1;
          continue;
        }
      }
      const live = payload === null ? null : liveVariantsFromPayload(payload);
      if (live && live.length === 0) continue;
      const productGid = toProductGid(row.shopifyProductId!);
      const changes = planStxStockChanges(nodesByProduct.get(productGid) ?? [], live, productGid, stats);
      if (changes.length === 0) continue;
      if (pending.length + changes.length > batchSize) await flush();
      pending.push(...changes);
      pendingPayloads.set(productGid, payload);
      if (pending.length >= batchSize) await flush();
    }
  }
  await flush();

  return {
    ...stats,
    variantsExported,
    candidateProducts: candidateProducts.size,
    products,
    kicksFail,
    shopifyFail,
    setCalls,
    batchFallbacks,
  };
}
