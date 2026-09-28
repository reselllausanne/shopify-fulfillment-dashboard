/**
 * In-process snapshot store for Matching Review Lab batches.
 * Keeps StockX buys server-side so the browser never holds megabytes.
 */

import type { LabClientUnit, LabStockxBuy, StockxAccountKey } from "./types";

export type LabBatchSnapshot = {
  batchId: string;
  createdAt: string;
  units: LabClientUnit[];
  buys: LabStockxBuy[];
  freshness: {
    fetchedAt: string | null;
    fromCache: boolean;
    accounts: Array<{ accountKey: StockxAccountKey; buyCount: number; source?: string }>;
  };
  meta: {
    shopifyOrdersScanned: number;
    galaxusOrdersScanned: number;
    decathlonOrdersScanned?: number;
    limit: number;
    nonStxSkipped?: number;
  };
  lastProposals?: import("./types").LabMatchProposal[];
};

const globalKey = "__resell_matching_review_lab_batches_v1";

type Store = Map<string, LabBatchSnapshot>;

function store(): Store {
  const g = globalThis as typeof globalThis & { [globalKey]?: Store };
  if (!g[globalKey]) g[globalKey] = new Map();
  return g[globalKey]!;
}

const TTL_MS = 60 * 60 * 1000;

function prune(now = Date.now()) {
  const s = store();
  for (const [id, batch] of s) {
    if (now - Date.parse(batch.createdAt) > TTL_MS) s.delete(id);
  }
}

export function putBatch(
  batch: Omit<LabBatchSnapshot, "batchId" | "createdAt"> & { batchId?: string }
): LabBatchSnapshot {
  prune();
  const snapshot: LabBatchSnapshot = {
    ...batch,
    batchId: batch.batchId ?? `lab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  store().set(snapshot.batchId, snapshot);
  return snapshot;
}

export function getBatch(batchId: string): LabBatchSnapshot | null {
  prune();
  return store().get(String(batchId ?? "").trim()) ?? null;
}

/** Slim unit for UI list — no nested shopifyLine (stays server-side). */
export function slimUnitForClient(unit: LabClientUnit) {
  return {
    unitKey: unit.unitKey,
    channel: unit.channel,
    orderId: unit.orderId,
    orderNumber: unit.orderNumber,
    orderDate: unit.orderDate,
    lineId: unit.lineId,
    unitIndex: unit.unitIndex,
    remainingQty: unit.remainingQty,
    productTitle: unit.productTitle,
    gtin: unit.gtin,
    sku: unit.sku,
    styleId: unit.styleId,
    sizeRaw: unit.sizeRaw,
    sizeNormalized: unit.sizeNormalized,
    stockxVariantId: unit.stockxVariantId,
    stockxAccountKeyExpected: unit.stockxAccountKeyExpected,
  };
}

export function slimBuyForClient(buy: LabStockxBuy) {
  return {
    supplierOrderNumber: buy.supplierOrderNumber,
    orderId: buy.orderId,
    chainId: buy.chainId,
    purchaseDate: buy.purchaseDate,
    offerAmount: buy.offerAmount,
    currencyCode: buy.currencyCode,
    productTitle: buy.productTitle,
    skuKey: buy.skuKey,
    sizeEU: buy.sizeEU,
    awb: buy.awb ?? null,
    stockxAccountKey: buy.stockxAccountKey,
    gtin: buy.gtin,
    productVariantId: buy.productVariantId,
    statusKey: buy.statusKey,
  };
}
