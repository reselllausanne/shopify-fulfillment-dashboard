import { createLimiter } from "@/galaxus/jobs/bulkSql";
import { prisma } from "@/app/lib/prisma";
import {
  buildStockxOrderClaimIndex,
  findStockxOrderClaim,
  registerStockxOrderClaim,
} from "@/app/lib/stockxCrossChannelClaims";
import { reconcileGalaxusOrderProcurement } from "@/galaxus/orders/galaxusProcurementReconcile";
import {
  extractStockxVariantId,
  fetchRecentStockxBuyingOrders,
  fetchStockxBuyOrderDetailsFull,
  synthesizeBuyOrderDetailsFromListNode,
  type StockxBuyingNode,
} from "@/galaxus/stx/stockxClient";
import { refreshLinkedStxUnitsByStoredRefs } from "@/galaxus/stx/linkedUnitRefresh";
import {
  getStxLinkStatusForOrder,
  linkOldestPendingStxUnit,
  reserveStxPurchaseUnitsForOrder,
  resolveGalaxusOrderByIdOrRef,
  type StxOrderLinkStatus,
} from "@/galaxus/stx/purchaseUnits";
import {
  GALAXUS_STOCKX_PERSISTED_HASHES_FILE,
  GALAXUS_STOCKX_SESSION_FILE,
  GALAXUS_STOCKX_SESSION_META_FILE,
  GALAXUS_STOCKX_TOKEN_FILE,
  readGalaxusStockxToken,
} from "@/lib/stockxGalaxusAuth";

const DETAIL_GAP_MS = Math.max(80, Number(process.env.STOCKX_GALAXUS_BULK_DETAIL_GAP_MS ?? "140"));
const DETAIL_CONCURRENCY = Math.max(
  1,
  Math.min(4, Number(process.env.STOCKX_GALAXUS_BULK_DETAIL_CONCURRENCY ?? "3"))
);
const RESERVE_CONCURRENCY = 6;
const REFRESH_CONCURRENCY = 3;
const MAX_ORDER_IDS = 200;
const PENDING_MAX_PAGES = Math.max(8, Number(process.env.STOCKX_GALAXUS_BULK_PENDING_PAGES ?? "20"));
const ALL_STATE_MAX_PAGES = Math.max(4, Number(process.env.STOCKX_GALAXUS_BULK_ALL_STATE_PAGES ?? "12"));

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buyKey(node: Pick<StockxBuyingNode, "chainId" | "orderId">): string {
  return `${String(node.chainId ?? "").trim()}::${String(node.orderId ?? "").trim()}`;
}

function parsePurchaseMs(node: StockxBuyingNode): number {
  const raw = node.purchaseDate ?? node.creationDate ?? null;
  if (!raw) return Number.POSITIVE_INFINITY;
  const ms = new Date(String(raw)).getTime();
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

function mergeBuyingLists(batches: StockxBuyingNode[][]): StockxBuyingNode[] {
  const seen = new Set<string>();
  const out: StockxBuyingNode[] = [];
  for (const batch of batches) {
    for (const node of batch) {
      const key = buyKey(node);
      if (!key || key === "::" || seen.has(key)) continue;
      seen.add(key);
      out.push(node);
    }
  }
  return out;
}

type OrderNeed = {
  dbId: string;
  galaxusOrderId: string;
  orderDateMs: number;
  /** Remaining unlinked slots per supplierVariantId */
  remainingByVariant: Map<string, number>;
  needsLinkedRefresh: boolean;
  status: StxOrderLinkStatus;
};

function remainingTotal(need: OrderNeed): number {
  let n = 0;
  for (const v of need.remainingByVariant.values()) n += v;
  return n;
}

function remainingFromStatus(status: StxOrderLinkStatus): Map<string, number> {
  const map = new Map<string, number>();
  for (const bucket of status.buckets) {
    const left = Math.max(0, bucket.needed - bucket.linked);
    if (left > 0) map.set(bucket.supplierVariantId, left);
  }
  return map;
}

export type GalaxusBulkStxSyncResult = {
  ok: boolean;
  error?: string;
  hint?: Record<string, string>;
  mode: "galaxus_direct_bulk_stockx_sync_shared";
  totalOrders: number;
  prepared: number;
  skippedNoWork: number;
  failedPrepare: number;
  linked: number;
  alreadyLinked: number;
  noPendingUnit: number;
  detailCalls: number;
  fetchedBuys: number;
  pendingListCount: number;
  allStateListCount: number;
  refreshedLinked: number;
  awbBackfilled: number;
  etaBackfilled: number;
  settledBackfilled: number;
  errors: number;
  failures: Array<{ orderId: string; error: string }>;
  perOrder: Array<{
    orderId: string;
    galaxusOrderId: string;
    linked: number;
    skipped: boolean;
    error?: string;
  }>;
};

/**
 * One StockX crawl for many Galaxus DD orders — reserve/refresh in parallel, then
 * match PENDING (+ recent all-state) buys onto any order still needing that variant.
 */
export async function runGalaxusBulkStxSync(orderIds: string[]): Promise<GalaxusBulkStxSyncResult> {
  const ids = Array.from(
    new Set(orderIds.map((id) => String(id ?? "").trim()).filter(Boolean))
  ).slice(0, MAX_ORDER_IDS);

  const base: GalaxusBulkStxSyncResult = {
    ok: true,
    mode: "galaxus_direct_bulk_stockx_sync_shared",
    totalOrders: ids.length,
    prepared: 0,
    skippedNoWork: 0,
    failedPrepare: 0,
    linked: 0,
    alreadyLinked: 0,
    noPendingUnit: 0,
    detailCalls: 0,
    fetchedBuys: 0,
    pendingListCount: 0,
    allStateListCount: 0,
    refreshedLinked: 0,
    awbBackfilled: 0,
    etaBackfilled: 0,
    settledBackfilled: 0,
    errors: 0,
    failures: [],
    perOrder: [],
  };

  if (ids.length === 0) {
    return { ...base, ok: false, error: "No order ids" };
  }

  const token = await readGalaxusStockxToken();
  if (!token) {
    return {
      ...base,
      ok: false,
      error: "Missing Galaxus StockX token file",
      hint: {
        sessionFile: GALAXUS_STOCKX_SESSION_FILE,
        sessionMetaFile: GALAXUS_STOCKX_SESSION_META_FILE,
        tokenFile: GALAXUS_STOCKX_TOKEN_FILE,
        persistedHashesFile: GALAXUS_STOCKX_PERSISTED_HASHES_FILE,
      },
    };
  }

  const needsByOrder = new Map<string, OrderNeed>();
  const prepareLimiter = createLimiter(RESERVE_CONCURRENCY);

  await Promise.all(
    ids.map((orderId) =>
      prepareLimiter(async () => {
        try {
          await reconcileGalaxusOrderProcurement(orderId, { skipAutoLink: true }).catch(() => null);
          const reservation = await reserveStxPurchaseUnitsForOrder(orderId);
          const status = reservation.status;
          const remainingByVariant = remainingFromStatus(status);
          const needsLinkedRefresh = status.buckets.some(
            (bucket) =>
              bucket.linkedWithEta < bucket.needed || bucket.linkedWithAwb < bucket.needed
          );

          const prismaAny = prisma as any;
          const unitsNeedingSettled = await prismaAny.stxPurchaseUnit
            .count({
              where: {
                galaxusOrderId: reservation.galaxusOrderId,
                supplierVariantId: { startsWith: "stx_" },
                stockxOrderId: { not: null },
                stockxSettledAmount: null,
                cancelledAt: null,
              },
            })
            .catch(() => 0);

          const hasWork =
            remainingByVariant.size > 0 || needsLinkedRefresh || Number(unitsNeedingSettled) > 0;

          if (!hasWork) {
            base.skippedNoWork += 1;
            base.perOrder.push({
              orderId,
              galaxusOrderId: reservation.galaxusOrderId,
              linked: 0,
              skipped: true,
            });
            return;
          }

          const orderRow = await resolveGalaxusOrderByIdOrRef(orderId);
          const orderDateMs = orderRow?.orderDate
            ? new Date(orderRow.orderDate).getTime()
            : Date.now();

          needsByOrder.set(orderId, {
            dbId: orderRow?.id ?? orderId,
            galaxusOrderId: reservation.galaxusOrderId,
            orderDateMs: Number.isFinite(orderDateMs) ? orderDateMs : Date.now(),
            remainingByVariant,
            needsLinkedRefresh: needsLinkedRefresh || Number(unitsNeedingSettled) > 0,
            status,
          });
          base.prepared += 1;
        } catch (err: any) {
          base.failedPrepare += 1;
          base.errors += 1;
          const message = String(err?.message ?? "prepare failed");
          if (base.failures.length < 40) {
            base.failures.push({ orderId, error: message });
          }
          base.perOrder.push({
            orderId,
            galaxusOrderId: orderId,
            linked: 0,
            skipped: false,
            error: message,
          });
        }
      })
    )
  );

  if (needsByOrder.size === 0) {
    return base;
  }

  const refreshLimiter = createLimiter(REFRESH_CONCURRENCY);
  await Promise.all(
    [...needsByOrder.values()]
      .filter((need) => need.needsLinkedRefresh)
      .map((need) =>
        refreshLimiter(async () => {
          const stats = await refreshLinkedStxUnitsByStoredRefs(token, need.galaxusOrderId);
          base.refreshedLinked += stats.refreshed;
          base.awbBackfilled += stats.awbBackfilled;
          base.etaBackfilled += stats.etaBackfilled;
          base.settledBackfilled += stats.settledBackfilled;
          base.errors += stats.failed;
        })
      )
  );

  const stillNeedingLink: OrderNeed[] = [];
  for (const need of needsByOrder.values()) {
    if (need.remainingByVariant.size === 0) continue;
    const status = await getStxLinkStatusForOrder(need.galaxusOrderId).catch(() => need.status);
    need.status = status;
    need.remainingByVariant = remainingFromStatus(status);
    if (need.remainingByVariant.size > 0) stillNeedingLink.push(need);
  }

  if (stillNeedingLink.length === 0) {
    for (const need of needsByOrder.values()) {
      if (base.perOrder.some((row) => row.galaxusOrderId === need.galaxusOrderId)) continue;
      base.perOrder.push({
        orderId: need.dbId,
        galaxusOrderId: need.galaxusOrderId,
        linked: 0,
        skipped: false,
      });
    }
    return base;
  }

  const pendingVariantIds = new Set<string>();
  for (const need of stillNeedingLink) {
    for (const vid of need.remainingByVariant.keys()) pendingVariantIds.add(vid);
  }

  let pendingList: StockxBuyingNode[] = [];
  let allStateList: StockxBuyingNode[] = [];
  try {
    [pendingList, allStateList] = await Promise.all([
      fetchRecentStockxBuyingOrders(token, {
        first: 100,
        maxPages: PENDING_MAX_PAGES,
        state: "PENDING",
      }),
      fetchRecentStockxBuyingOrders(token, {
        first: 100,
        maxPages: ALL_STATE_MAX_PAGES,
        state: null,
      }),
    ]);
  } catch (err: any) {
    return {
      ...base,
      ok: false,
      error: `StockX buying list failed: ${err?.message ?? err}`,
    };
  }

  base.pendingListCount = pendingList.length;
  base.allStateListCount = allStateList.length;
  const buys = mergeBuyingLists([pendingList, allStateList]);
  base.fetchedBuys = buys.length;

  type Details =
    | Awaited<ReturnType<typeof fetchStockxBuyOrderDetailsFull>>
    | ReturnType<typeof synthesizeBuyOrderDetailsFromListNode>;

  const detailsCache = new Map<string, Details>();
  let lastDetailCallAt = 0;
  const detailLimiter = createLimiter(DETAIL_CONCURRENCY);

  const fetchDetails = async (node: StockxBuyingNode): Promise<Details> => {
    const key = buyKey(node);
    const cached = detailsCache.get(key);
    if (cached) return cached;
    const chainId = String(node.chainId ?? "").trim();
    const orderId = String(node.orderId ?? "").trim();
    if (!chainId || !orderId) {
      const synth = synthesizeBuyOrderDetailsFromListNode(node);
      detailsCache.set(key, synth);
      return synth;
    }
    return detailLimiter(async () => {
      const again = detailsCache.get(key);
      if (again) return again;
      try {
        if (DETAIL_GAP_MS > 0) {
          const now = Date.now();
          const waitMs = DETAIL_GAP_MS - (now - lastDetailCallAt);
          if (waitMs > 0) await sleepMs(waitMs);
          lastDetailCallAt = Date.now();
        }
        base.detailCalls += 1;
        const details = await fetchStockxBuyOrderDetailsFull(token, { chainId, orderId });
        if (details?.order) {
          detailsCache.set(key, details);
          return details;
        }
      } catch {
        // list synthesize fallback
      }
      const synth = synthesizeBuyOrderDetailsFromListNode(node);
      detailsCache.set(key, synth);
      return synth;
    });
  };

  type ResolvedBuy = {
    node: StockxBuyingNode;
    supplierVariantId: string;
    details: Details;
  };
  const resolved: ResolvedBuy[] = [];
  const unresolved: StockxBuyingNode[] = [];

  for (const node of buys) {
    const fast = extractStockxVariantId(node, null);
    if (fast) {
      const supplierVariantId = `stx_${fast}`;
      if (!pendingVariantIds.has(supplierVariantId)) continue;
      const listSynth = synthesizeBuyOrderDetailsFromListNode(node);
      const hasEta = Boolean(listSynth.etaMin || listSynth.etaMax);
      const details = hasEta ? listSynth : await fetchDetails(node);
      resolved.push({ node, supplierVariantId, details });
    } else {
      unresolved.push(node);
    }
  }

  const unknownCap = Math.min(unresolved.length, Math.max(80, pendingVariantIds.size * 12));
  await Promise.all(
    unresolved.slice(0, unknownCap).map((node) =>
      detailLimiter(async () => {
        const details = await fetchDetails(node);
        const variantId = extractStockxVariantId(node, details.order);
        if (!variantId) return;
        const supplierVariantId = `stx_${variantId}`;
        if (!pendingVariantIds.has(supplierVariantId)) return;
        resolved.push({ node, supplierVariantId, details });
      })
    )
  );

  resolved.sort((a, b) => parsePurchaseMs(a.node) - parsePurchaseMs(b.node));

  const claimIndex = await buildStockxOrderClaimIndex({
    stockxOrderIds: resolved.map((r) => r.node.orderId),
    stockxOrderNumbers: resolved.map((r) => r.node.orderNumber),
  });

  const linkedCountByOrder = new Map<string, number>();
  for (const need of stillNeedingLink) linkedCountByOrder.set(need.galaxusOrderId, 0);

  const tryLinkBuy = async (buy: ResolvedBuy): Promise<void> => {
    const stockxOrderId = String(buy.node.orderId ?? "").trim();
    const stockxOrderNumber = String(buy.node.orderNumber ?? "").trim() || null;
    if (!stockxOrderId) return;
    if (findStockxOrderClaim(claimIndex, stockxOrderId, stockxOrderNumber)) return;

    const candidates = stillNeedingLink
      .filter((need) => (need.remainingByVariant.get(buy.supplierVariantId) ?? 0) > 0)
      .map((need) => ({
        need,
        diff: Math.abs(need.orderDateMs - parsePurchaseMs(buy.node)),
      }))
      .sort((a, b) => a.diff - b.diff || a.need.orderDateMs - b.need.orderDateMs);

    if (candidates.length === 0) return;

    const { need } = candidates[0]!;
    const etaMin = buy.details.etaMin ?? buy.details.etaMax ?? null;
    const etaMax = buy.details.etaMax ?? buy.details.etaMin ?? null;
    const settledRaw = (buy.details as any)?.order?.payment?.settledAmount;
    const stockxSettledAmount =
      settledRaw?.value != null && Number.isFinite(Number(settledRaw.value))
        ? Number(settledRaw.value)
        : null;
    const stockxSettledCurrency =
      typeof settledRaw?.currency === "string" ? String(settledRaw.currency).trim() : null;
    const checkoutType =
      typeof (buy.details as any)?.order?.checkoutType === "string"
        ? String((buy.details as any).order.checkoutType)
        : typeof buy.node.checkoutType === "string"
          ? buy.node.checkoutType
          : null;

    const linkResult = await linkOldestPendingStxUnit({
      galaxusOrderId: need.galaxusOrderId,
      supplierVariantId: buy.supplierVariantId,
      stockxOrderId,
      awb: buy.details.awb ?? null,
      etaMin,
      etaMax,
      checkoutType,
      stockxOrderNumber,
      stockxSettledAmount,
      stockxSettledCurrency,
      // Catch-up: list ETA often enough; don't block backlog on detail WAF.
      allowMissingEta: true,
    });

    if (linkResult.status === "linked") {
      base.linked += 1;
      linkedCountByOrder.set(
        need.galaxusOrderId,
        (linkedCountByOrder.get(need.galaxusOrderId) ?? 0) + 1
      );
      const left = (need.remainingByVariant.get(buy.supplierVariantId) ?? 1) - 1;
      if (left <= 0) need.remainingByVariant.delete(buy.supplierVariantId);
      else need.remainingByVariant.set(buy.supplierVariantId, left);
      registerStockxOrderClaim(claimIndex, {
        channel: "galaxus",
        matchId: `${need.galaxusOrderId}:${stockxOrderId}`,
        stockxOrderId,
        stockxOrderNumber,
      });
    } else if (linkResult.status === "already_linked") {
      base.alreadyLinked += 1;
      registerStockxOrderClaim(claimIndex, {
        channel: "galaxus",
        matchId: `${need.galaxusOrderId}:${stockxOrderId}`,
        stockxOrderId,
        stockxOrderNumber,
      });
    } else if (linkResult.status === "no_pending_unit") {
      base.noPendingUnit += 1;
      need.remainingByVariant.delete(buy.supplierVariantId);
    }
  };

  for (const buy of resolved) {
    if (stillNeedingLink.every((need) => remainingTotal(need) === 0)) break;
    await tryLinkBuy(buy);
  }

  const reconcileLimiter = createLimiter(4);
  await Promise.all(
    stillNeedingLink.map((need) =>
      reconcileLimiter(async () => {
        await reconcileGalaxusOrderProcurement(need.dbId, { skipAutoLink: true }).catch(() => null);
      })
    )
  );

  for (const need of needsByOrder.values()) {
    if (base.perOrder.some((row) => row.galaxusOrderId === need.galaxusOrderId)) continue;
    base.perOrder.push({
      orderId: need.dbId,
      galaxusOrderId: need.galaxusOrderId,
      linked: linkedCountByOrder.get(need.galaxusOrderId) ?? 0,
      skipped: false,
    });
  }

  return base;
}
