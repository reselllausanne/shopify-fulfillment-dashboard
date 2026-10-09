/**
 * Scan-time fallback: the scanned AWB is unknown in DB, so ask StockX directly.
 *
 * Walks every account's buying list (cached), fetches buy details for buys whose
 * AWB we don't know yet, and persists every AWB it discovers onto existing link
 * rows. If the matching buy is not linked to any Galaxus order yet, runs the
 * regular auto-link against open Galaxus orders carrying the same StockX variant.
 */

import { prisma } from "@/app/lib/prisma";
import { autoLinkUnclaimedStockxBuysForGalaxusOrder } from "@/galaxus/orders/autoLinkStockxBuys";
import { getCachedStockxBuyingOrders } from "@/galaxus/stx/buyingOrdersCache";
import {
  extractStockxVariantId,
  fetchStockxBuyOrderDetailsFull,
  type StockxBuyingNode,
} from "@/galaxus/stx/stockxClient";
import { listStockxAccountTokens, type StockxAccountToken } from "@/lib/stockxToken";

const MAX_BUY_AGE_DAYS = 60;
const NO_AWB_RECHECK_MS = 10 * 60 * 1000;
const DEFAULT_BUDGET_MS = Math.max(
  3_000,
  Number(process.env.STOCKX_SCAN_LIVE_BUDGET_MS ?? "25000")
);

type DetailCacheEntry = { awb: string | null; checkedAt: number };
type HitEntry = { node: StockxBuyingNode; token: string; source: StockxAccountToken["source"] };

const globalKey = "__resell_stockx_scan_live_cache_v1";
type Store = { details: Map<string, DetailCacheEntry>; hitsByAwb: Map<string, HitEntry> };

function store(): Store {
  const g = globalThis as typeof globalThis & { [globalKey]?: Store };
  if (!g[globalKey]) g[globalKey] = { details: new Map(), hitsByAwb: new Map() };
  return g[globalKey]!;
}

function normAwb(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
}

function buyKey(node: StockxBuyingNode): string {
  return `${String(node.chainId ?? "").trim()}::${String(node.orderId ?? "").trim()}`;
}

function looksShippedOrDelivered(node: StockxBuyingNode): boolean {
  const key = `${node.state?.statusKey ?? ""} ${node.state?.statusTitle ?? ""}`;
  return /RECEIVED|DELIVER|SHIP|TRANSIT|OUT_FOR|COMPLETED/i.test(key);
}

export type ScanLiveAwbResult = {
  found: boolean;
  reason?: string;
  accounts: number;
  detailsFetched: number;
  awbsPersisted: number;
  durationMs: number;
  stockxOrderNumber?: string | null;
  galaxusLinked?: { galaxusOrderId: string } | null;
};

/** Write a discovered AWB onto every link row that references this StockX buy and has none yet. */
async function persistAwbForBuy(node: StockxBuyingNode, awb: string): Promise<number> {
  const orderNumber = String(node.orderNumber ?? "").trim();
  const orderId = String(node.orderId ?? "").trim();
  if (!orderNumber && !orderId) return 0;
  const emptyAwb = { OR: [{ awb: null }, { awb: "" }] };
  const emptyStockxAwb = { OR: [{ stockxAwb: null }, { stockxAwb: "" }] };
  const byNumber = orderNumber ? [{ stockxOrderNumber: orderNumber }] : [];
  const byId = orderId ? [{ stockxOrderId: orderId }] : [];
  const prismaAny = prisma as any;
  const results = await Promise.all([
    prismaAny.stxPurchaseUnit.updateMany({
      where: { AND: [{ OR: [...byNumber, ...byId] }, emptyAwb] },
      data: { awb },
    }),
    prismaAny.galaxusStockxMatch.updateMany({
      where: { AND: [{ OR: [...byNumber, ...byId] }, emptyStockxAwb] },
      data: { stockxAwb: awb },
    }),
    prismaAny.decathlonStockxMatch.updateMany({
      where: { AND: [{ OR: [...byNumber, ...byId] }, emptyStockxAwb] },
      data: { stockxAwb: awb },
    }),
    orderNumber
      ? prismaAny.orderMatch.updateMany({
          where: { AND: [{ stockxOrderNumber: orderNumber }, emptyStockxAwb] },
          data: { stockxAwb: awb },
        })
      : Promise.resolve({ count: 0 }),
  ]).catch((err: any) => {
    console.warn("[SCAN-LIVE] persist awb failed", { orderNumber, error: err?.message ?? err });
    return [] as Array<{ count: number }>;
  });
  return results.reduce((sum, r) => sum + Number(r?.count ?? 0), 0);
}

async function orderNumbersWithKnownAwb(orderNumbers: string[]): Promise<Set<string>> {
  const known = new Set<string>();
  if (orderNumbers.length === 0) return known;
  const prismaAny = prisma as any;
  const notEmpty = (field: string) => ({ AND: [{ [field]: { not: null } }, { NOT: { [field]: "" } }] });
  const [units, gx, dk, om, inbound] = await Promise.all([
    prismaAny.stxPurchaseUnit.findMany({
      where: { stockxOrderNumber: { in: orderNumbers }, ...notEmpty("awb") },
      select: { stockxOrderNumber: true },
    }),
    prismaAny.galaxusStockxMatch.findMany({
      where: { stockxOrderNumber: { in: orderNumbers }, ...notEmpty("stockxAwb") },
      select: { stockxOrderNumber: true },
    }),
    prismaAny.decathlonStockxMatch.findMany({
      where: { stockxOrderNumber: { in: orderNumbers }, ...notEmpty("stockxAwb") },
      select: { stockxOrderNumber: true },
    }),
    prismaAny.orderMatch.findMany({
      where: { stockxOrderNumber: { in: orderNumbers }, ...notEmpty("stockxAwb") },
      select: { stockxOrderNumber: true },
    }),
    prismaAny.stockxInboundPackage.findMany({
      where: { stockxOrderNumber: { in: orderNumbers } },
      select: { stockxOrderNumber: true },
    }),
  ]);
  for (const row of [...units, ...gx, ...dk, ...om, ...inbound]) {
    const n = String(row?.stockxOrderNumber ?? "").trim();
    if (n) known.add(n);
  }
  return known;
}

async function orderNumbersLinkedWithoutAwb(orderNumbers: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (orderNumbers.length === 0) return out;
  const prismaAny = prisma as any;
  const empty = (field: string) => ({ OR: [{ [field]: null }, { [field]: "" }] });
  const [units, gx, dk, om] = await Promise.all([
    prismaAny.stxPurchaseUnit.findMany({
      where: { stockxOrderNumber: { in: orderNumbers }, cancelledAt: null, ...empty("awb") },
      select: { stockxOrderNumber: true },
    }),
    prismaAny.galaxusStockxMatch.findMany({
      where: { stockxOrderNumber: { in: orderNumbers }, ...empty("stockxAwb") },
      select: { stockxOrderNumber: true },
    }),
    prismaAny.decathlonStockxMatch.findMany({
      where: { stockxOrderNumber: { in: orderNumbers }, ...empty("stockxAwb") },
      select: { stockxOrderNumber: true },
    }),
    prismaAny.orderMatch.findMany({
      where: { stockxOrderNumber: { in: orderNumbers }, ...empty("stockxAwb") },
      select: { stockxOrderNumber: true },
    }),
  ]);
  for (const row of [...units, ...gx, ...dk, ...om]) {
    const n = String(row?.stockxOrderNumber ?? "").trim();
    if (n) out.add(n);
  }
  return out;
}

/** Link an unclaimed buy to the oldest open Galaxus order needing that StockX variant. */
async function autoLinkBuyToOpenGalaxusOrder(hit: HitEntry): Promise<{ galaxusOrderId: string } | null> {
  const variantId = extractStockxVariantId(hit.node, null);
  if (!variantId) return null;
  const supplierVariantId = `stx_${variantId}`;
  const sv = await prisma.supplierVariant
    .findUnique({ where: { supplierVariantId }, select: { gtin: true } })
    .catch(() => null);
  const gtin = String(sv?.gtin ?? "").trim();
  const orders = await prisma.galaxusOrder.findMany({
    where: {
      archivedAt: null,
      cancelledAt: null,
      lines: {
        some: {
          OR: [
            { supplierVariantId: { equals: supplierVariantId, mode: "insensitive" } },
            ...(gtin ? [{ gtin }] : []),
          ],
        },
      },
    },
    select: { id: true, galaxusOrderId: true },
    orderBy: { orderDate: "asc" },
    take: 25,
  });
  for (const order of orders) {
    const res = await autoLinkUnclaimedStockxBuysForGalaxusOrder(order.id, {
      prefetchedBuys: [{ node: hit.node, token: hit.token }],
    }).catch((err: any) => {
      console.warn("[SCAN-LIVE] auto-link failed", {
        galaxusOrderId: order.galaxusOrderId,
        error: err?.message ?? err,
      });
      return { linked: 0 };
    });
    if (res.linked > 0) return { galaxusOrderId: order.galaxusOrderId };
  }
  return null;
}

/**
 * Resolve an unknown scanned AWB against live StockX data. On success the AWB is
 * persisted to DB, so the caller should simply re-run its DB lookup.
 */
export async function resolveScannedAwbViaStockxLive(
  awbCandidates: string[],
  options?: { budgetMs?: number }
): Promise<ScanLiveAwbResult> {
  const startedAt = Date.now();
  const budgetMs = Math.max(2_000, options?.budgetMs ?? DEFAULT_BUDGET_MS);
  const wanted = new Set(awbCandidates.map(normAwb).filter((a) => a.length >= 8));
  const base: ScanLiveAwbResult = {
    found: false,
    accounts: 0,
    detailsFetched: 0,
    awbsPersisted: 0,
    durationMs: 0,
  };
  const done = (patch: Partial<ScanLiveAwbResult>): ScanLiveAwbResult => ({
    ...base,
    ...patch,
    durationMs: Date.now() - startedAt,
  });
  if (wanted.size === 0) return done({ reason: "no_awb_candidates" });

  const cache = store();
  const finish = async (hit: HitEntry, awb: string): Promise<ScanLiveAwbResult> => {
    base.awbsPersisted += await persistAwbForBuy(hit.node, awb);
    const claimed = await (prisma as any).stxPurchaseUnit.findFirst({
      where: { awb, cancelledAt: null },
      select: { galaxusOrderId: true },
    });
    let galaxusLinked: { galaxusOrderId: string } | null = claimed
      ? { galaxusOrderId: String(claimed.galaxusOrderId) }
      : null;
    if (!galaxusLinked) {
      galaxusLinked = await autoLinkBuyToOpenGalaxusOrder(hit);
    }
    return done({
      found: true,
      stockxOrderNumber: hit.node.orderNumber ?? null,
      galaxusLinked,
    });
  };

  for (const awb of wanted) {
    const hit = cache.hitsByAwb.get(awb);
    if (hit) return finish(hit, awb);
  }

  const tokens = await listStockxAccountTokens();
  base.accounts = tokens.length;
  if (tokens.length === 0) return done({ reason: "no_stockx_token" });

  const minPurchase = Date.now() - MAX_BUY_AGE_DAYS * 86_400_000;
  const queue: HitEntry[] = [];
  for (const account of tokens) {
    for (const [state, maxPages] of [
      ["PENDING", 4],
      ["HISTORICAL", 2],
    ] as const) {
      const res = await getCachedStockxBuyingOrders(account.token, { first: 100, maxPages, state }).catch(
        (err: any) => {
          console.warn("[SCAN-LIVE] buying list failed", {
            source: account.source,
            state,
            error: err?.message ?? err,
          });
          return null;
        }
      );
      for (const node of res?.nodes ?? []) {
        const purchased = Date.parse(String(node.purchaseDate ?? node.creationDate ?? ""));
        if (Number.isFinite(purchased) && purchased < minPurchase) continue;
        queue.push({ node, token: account.token, source: account.source });
      }
    }
  }

  const orderNumbers = Array.from(
    new Set(queue.map((q) => String(q.node.orderNumber ?? "").trim()).filter(Boolean))
  );
  const [known, linkedWithoutAwb] = await Promise.all([
    orderNumbersWithKnownAwb(orderNumbers),
    orderNumbersLinkedWithoutAwb(orderNumbers),
  ]);
  const purchasedAt = (n: StockxBuyingNode) =>
    Date.parse(String(n.purchaseDate ?? n.creationDate ?? "")) || 0;
  const priority = (n: StockxBuyingNode) =>
    (linkedWithoutAwb.has(String(n.orderNumber ?? "").trim()) ? 0 : 2) +
    (looksShippedOrDelivered(n) ? 0 : 1);
  const seen = new Set<string>();
  const todo = queue
    .filter((q) => {
      const key = buyKey(q.node);
      if (key === "::" || seen.has(key)) return false;
      seen.add(key);
      if (known.has(String(q.node.orderNumber ?? "").trim())) return false;
      const cached = cache.details.get(key);
      if (cached?.awb) return false;
      if (cached && Date.now() - cached.checkedAt < NO_AWB_RECHECK_MS) return false;
      return true;
    })
    // Parcels at the warehouse are mostly buys already linked to an order but missing their AWB.
    .sort((a, b) => priority(a.node) - priority(b.node) || purchasedAt(b.node) - purchasedAt(a.node));

  for (const item of todo) {
    if (Date.now() - startedAt > budgetMs) {
      return done({ reason: "budget_exhausted" });
    }
    const key = buyKey(item.node);
    let awb: string | null = null;
    try {
      const details = await fetchStockxBuyOrderDetailsFull(item.token, {
        chainId: String(item.node.chainId ?? "").trim(),
        orderId: String(item.node.orderId ?? "").trim(),
      });
      awb = normAwb(details.awb) || null;
    } catch (err: any) {
      console.warn("[SCAN-LIVE] detail failed", { key, error: err?.message ?? err });
      continue;
    }
    base.detailsFetched += 1;
    cache.details.set(key, { awb, checkedAt: Date.now() });
    if (!awb) continue;
    cache.hitsByAwb.set(awb, item);
    if (wanted.has(awb)) return finish(item, awb);
    base.awbsPersisted += await persistAwbForBuy(item.node, awb);
  }

  return done({ reason: "not_in_stockx_buys" });
}
