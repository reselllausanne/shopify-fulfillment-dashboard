import { prisma } from "@/app/lib/prisma";
import { pickMiraklLineGtin, pickMiraklLineSkuCandidates } from "@/decathlon/mirakl/orderLineFields";
import {
  buildBucketsFromNeeds,
  normalizeGtinKey,
  resolveStxNeedsFromGtinQuantities,
  type StxLinkBucket,
  type StxNeed,
} from "@/galaxus/stx/purchaseUnits";

export type DecathlonStxOrderLinkStatus = {
  miraklOrderId: string;
  hasStxItems: boolean;
  allLinked: boolean;
  allEtaPresent: boolean;
  allAwbPresent: boolean;
  buckets: StxLinkBucket[];
};

function isDecathlonLineExcludedFromStockx(line: any): boolean {
  const pk = String(line?.providerKey ?? "").trim().toUpperCase();
  return pk.startsWith("GLD_") || pk.startsWith("TRM_");
}

function effectiveLineGtin(line: any): string | null {
  const fromDb = pickMiraklLineGtin(line);
  if (fromDb) return fromDb;
  return pickMiraklLineGtin(line?.rawJson);
}

async function loadSkuToStxMaps(candidates: Set<string>): Promise<{
  keyToStxId: Map<string, string>;
  stxIdToCatalogGtin: Map<string, string>;
}> {
  const list = Array.from(candidates).filter((s) => s.length > 0);
  const keyToStxId = new Map<string, string>();
  const stxIdToCatalogGtin = new Map<string, string>();
  if (list.length === 0) return { keyToStxId, stxIdToCatalogGtin };

  const rows = await prisma.supplierVariant.findMany({
    where: {
      OR: [{ supplierVariantId: { in: list } }, { providerKey: { in: list } }, { supplierSku: { in: list } }],
    },
    select: { supplierVariantId: true, providerKey: true, supplierSku: true, gtin: true },
  });

  for (const r of rows) {
    const id = String(r.supplierVariantId ?? "").trim();
    if (!id.toLowerCase().startsWith("stx_")) continue;
    const g = normalizeGtinKey(r.gtin);
    if (g) stxIdToCatalogGtin.set(id, g);
    for (const k of [id, r.providerKey, r.supplierSku]) {
      const s = String(k ?? "").trim();
      if (s) keyToStxId.set(s, id);
    }
  }
  return { keyToStxId, stxIdToCatalogGtin };
}

function aggregateNeedsFromTargets(targets: DecathlonStxLineTarget[]): StxNeed[] {
  const m = new Map<string, StxNeed>();
  for (const t of targets) {
    const k = `${t.gtin}::${t.supplierVariantId}`;
    const cur = m.get(k) ?? { gtin: t.gtin, supplierVariantId: t.supplierVariantId, needed: 0 };
    cur.needed += t.qty;
    m.set(k, cur);
  }
  return Array.from(m.values());
}

async function resolveDecathlonOrderByIdOrRef(orderIdOrRef: string) {
  return (
    (await prisma.decathlonOrder.findUnique({
      where: { id: orderIdOrRef },
      include: { lines: true },
    })) ??
    (await prisma.decathlonOrder.findUnique({
      where: { orderId: orderIdOrRef },
      include: { lines: true },
    }))
  );
}

export type DecathlonStxLineTarget = {
  lineId: string;
  gtin: string;
  supplierVariantId: string;
  qty: number;
};

/**
 * Resolve Decathlon lines to StockX supplier variant ids — same data sources as Galaxus:
 * 1) Offer / shop / provider SKUs → SupplierVariant (when id is stx_*), like our catalog keys.
 * 2) GTIN → variantMapping → stx_* (Galaxus `resolveStxNeedsFromGtinQuantities`).
 * 3) Galaxus-style STX-tagged lines still drive GTIN aggregation; neutral lines join if GTIN maps to stx_* in DB.
 */
export async function buildDecathlonStxLineTargets(order: {
  id: string;
  lines: any[];
}): Promise<DecathlonStxLineTarget[]> {
  const candidates = new Set<string>();
  for (const line of order.lines ?? []) {
    if (isDecathlonLineExcludedFromStockx(line)) continue;
    for (const c of pickMiraklLineSkuCandidates(line)) candidates.add(c);
    for (const c of pickMiraklLineSkuCandidates(line?.rawJson)) candidates.add(c);
  }

  const { keyToStxId, stxIdToCatalogGtin } = await loadSkuToStxMaps(candidates);

  const fullGtinQty = new Map<string, number>();
  for (const line of order.lines ?? []) {
    if (isDecathlonLineExcludedFromStockx(line)) continue;
    const g = normalizeGtinKey(effectiveLineGtin(line));
    const qty = Number(line?.quantity ?? 0);
    if (!g || qty <= 0) continue;
    fullGtinQty.set(g, (fullGtinQty.get(g) ?? 0) + qty);
  }
  const stxNeedsFromGtin = await resolveStxNeedsFromGtinQuantities(fullGtinQty);
  const needByGtin = new Map(stxNeedsFromGtin.map((n) => [n.gtin, n] as const));

  const targets: DecathlonStxLineTarget[] = [];

  for (const line of order.lines ?? []) {
    if (isDecathlonLineExcludedFromStockx(line)) continue;
    const qty = Number(line?.quantity ?? 0);
    if (qty <= 0) continue;

    let supplierVariantId: string | null = null;
    let gtinKey: string | null = null;

    const skuKeys = [...pickMiraklLineSkuCandidates(line), ...pickMiraklLineSkuCandidates(line?.rawJson)];
    for (const c of skuKeys) {
      const sid = keyToStxId.get(c);
      if (sid) {
        supplierVariantId = sid;
        const lineG = normalizeGtinKey(effectiveLineGtin(line));
        const catG = stxIdToCatalogGtin.get(sid);
        gtinKey = lineG || catG || `stxvar:${sid}`;
        break;
      }
    }

    if (!supplierVariantId) {
      const g = normalizeGtinKey(effectiveLineGtin(line));
      if (!g) continue;
      const need = needByGtin.get(g);
      if (!need?.supplierVariantId.startsWith("stx_")) continue;
      supplierVariantId = need.supplierVariantId;
      gtinKey = g;
    }

    if (!supplierVariantId || !gtinKey) continue;

    targets.push({
      lineId: line.id,
      gtin: gtinKey,
      supplierVariantId,
      qty,
    });
  }

  return targets;
}

/** Same bucket semantics as Galaxus STX status, backed by DecathlonStockxMatch. */
export async function getDecathlonStxLinkStatusForOrder(
  orderIdOrRef: string
): Promise<DecathlonStxOrderLinkStatus & { decathlonOrderDbId: string }> {
  const order = await resolveDecathlonOrderByIdOrRef(orderIdOrRef);
  if (!order) {
    throw new Error("Order not found");
  }

  const targets = await buildDecathlonStxLineTargets(order);
  const needs = aggregateNeedsFromTargets(targets);

  const matches = await prisma.decathlonStockxMatch.findMany({
    where: { decathlonOrderId: order.id },
  });

  const units: Array<{
    gtin: string;
    supplierVariantId: string;
    stockxOrderId: string | null;
    etaMin: Date | null;
    etaMax: Date | null;
    awb: string | null;
  }> = [];
  for (const m of matches) {
    const vid = String(m.stockxVariantId ?? "").trim();
    if (!vid) continue;
    const supplierVariantId = `stx_${vid}`;
    const gtin = normalizeGtinKey(m.decathlonGtin);
    const oid = String(m.stockxOrderId ?? "").trim();
    const onum = String(m.stockxOrderNumber ?? "").trim();
    if (!oid && !onum) continue;
    units.push({
      gtin: gtin || `stxvar:${supplierVariantId}`,
      supplierVariantId,
      stockxOrderId: oid || "manual",
      etaMin: m.stockxEstimatedDelivery ?? null,
      etaMax: m.stockxLatestEstimatedDelivery ?? null,
      awb: m.stockxAwb ?? null,
    });
  }

  const buckets = buildBucketsFromNeeds(needs, units);
  const hasStxItems = buckets.length > 0;
  const allLinked = hasStxItems ? buckets.every((b) => b.linked >= b.needed) : true;
  const allEtaPresent = hasStxItems ? buckets.every((b) => b.linkedWithEta >= b.needed) : true;
  const allAwbPresent = hasStxItems ? buckets.every((b) => b.linkedWithAwb >= b.needed) : true;

  return {
    decathlonOrderDbId: order.id,
    miraklOrderId: order.orderId,
    hasStxItems,
    allLinked,
    allEtaPresent,
    allAwbPresent,
    buckets,
  };
}
