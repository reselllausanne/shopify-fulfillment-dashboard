/**
 * Persist / refresh the last N StockX packages arrived for AWB fallback.
 * Multi-account ready via stockxAccountKey (Shopify today; Galaxus later).
 *
 * Retention ranking uses stockxEventAt, else firstSeenAt — never last cron tick.
 * firstSeenAt is immutable after create; lastSeenAt refreshes on every sync hit.
 *
 * NOTE: the legacy `syncStockxInboundPackagesFromDb` rebuilt this table from
 * OrderMatch + StxPurchaseUnit rows — that is the exact fake-signal pathway
 * we're eliminating. The real inbound sync lives in
 * `app/lib/stockxInboundSyncFromApi.ts` and calls the StockX buying API
 * directly. The DB-side helper is kept only as a deprecated no-op so
 * existing imports don't break at build time.
 */

import { prisma } from "@/app/lib/prisma";

export const STOCKX_INBOUND_PACKAGE_RETENTION = 100;

export type UpsertStockxInboundPackageInput = {
  awb: string;
  stockxOrderNumber?: string | null;
  stockxOrderId?: string | null;
  stockxAccountKey?: string | null;
  sku?: string | null;
  sizeEU?: string | null;
  productName?: string | null;
  purchaseDate?: Date | string | null;
  status?: string | null;
  /** @deprecated Prefer stockxEventAt; kept for callers that still pass it. */
  arrivedAt?: Date | string | null;
  /** Best StockX event time (purchase/creation). Drives retention ranking. */
  stockxEventAt?: Date | string | null;
  channelHint?: string | null;
};

export type UpsertStockxInboundPackageResult = {
  awb: string;
  created: boolean;
  firstSeenAt: Date;
  lastSeenAt: Date;
  stockxEventAt: Date | null;
};

function normalizeAwb(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Retention rank: stockxEventAt preferred, else firstSeenAt. Never lastSeenAt. */
export function inboundRetentionRankAt(row: {
  stockxEventAt?: Date | string | null;
  firstSeenAt?: Date | string | null;
  arrivedAt?: Date | string | null;
}): Date {
  return (
    asDate(row.stockxEventAt) ??
    asDate(row.firstSeenAt) ??
    asDate(row.arrivedAt) ??
    new Date(0)
  );
}

/**
 * Observed logistics source used for stockxEventAt (or first_seen fallback).
 */
export type LogisticsDateSource =
  | "delivered"
  | "shipped"
  | "tracking"
  | "state"
  | "first_seen";

export type ResolveStockxInboundLogisticsResult = {
  stockxEventAt: Date | null;
  source: LogisticsDateSource;
};

export type LogisticsDateSourceCounts = Record<LogisticsDateSource, number>;

export function emptyLogisticsDateSourceCounts(): LogisticsDateSourceCounts {
  return {
    delivered: 0,
    shipped: 0,
    tracking: 0,
    state: 0,
    first_seen: 0,
  };
}

/** Reject missing / NaN / future timestamps (ETA & deadlines sneak in as future). */
export function isObservedLogisticsDate(
  value: Date | string | null | undefined,
  now: Date = new Date()
): Date | null {
  const d = asDate(value);
  if (!d) return null;
  // 5 min clock skew only — anything further in the future is estimate/deadline.
  if (d.getTime() > now.getTime() + 5 * 60 * 1000) return null;
  return d;
}

const SHIP_OR_DELIVER_STATUS_RE =
  /\b(delivered|delivery|shipped|ship|in[_\s-]?transit|out[_\s-]?for[_\s-]?delivery|authenticated|completed?)\b/i;

function firstObservedDate(
  now: Date,
  ...candidates: unknown[]
): Date | null {
  for (const c of candidates) {
    const d = isObservedLogisticsDate(c as any, now);
    if (d) return d;
  }
  return null;
}

function latestObservedDateFromArray(items: unknown[], now: Date): Date | null {
  let best: Date | null = null;
  for (const item of items) {
    if (!item || typeof item !== "object") {
      const d = isObservedLogisticsDate(item as any, now);
      if (d && (!best || d.getTime() > best.getTime())) best = d;
      continue;
    }
    const row = item as Record<string, unknown>;
    const d = firstObservedDate(
      now,
      row.occurredAt,
      row.at,
      row.date,
      row.timestamp,
      row.time,
      row.changedAt,
      row.updatedAt,
      row.createdAt,
      row.completedAt,
      row.statusDate,
      row.eventDate,
      (row.meta as any)?.date,
      (row.meta as any)?.timestamp,
      (row.meta as any)?.occurredAt
    );
    if (d && (!best || d.getTime() > best.getTime())) best = d;
  }
  return best;
}

/**
 * stockxEventAt = real observed transport event only.
 *
 * Allowed (priority):
 * 1. deliveredAt / receivedAt / deliveredDate
 * 2. shippedAt
 * 3. last carrier tracking event timestamp
 * 4. state.changedAt / state.updatedAt
 *
 * Forbidden: ETA, sellerShipBy, purchaseDate, creationDate, any future proxy.
 * No real event → stockxEventAt=null, source=first_seen (rank by firstSeenAt).
 */
export function resolveStockxInboundLogisticsAt(params: {
  deliveredAt?: Date | string | null;
  deliveredDate?: Date | string | null;
  receivedAt?: Date | string | null;
  shippedAt?: Date | string | null;
  trackingEventAt?: Date | string | null;
  /** @deprecated alias of trackingEventAt */
  lastTrackingStatusAt?: Date | string | null;
  /** Timestamp tied to a StockX status that confirms ship/delivery. */
  stateConfirmedAt?: Date | string | null;
  /** Status key/title used only to validate stateConfirmedAt. */
  stateStatusKey?: string | null;
  /** @deprecated ignored unless paired via extract with confirming status */
  stateChangedAt?: Date | string | null;
  stateUpdatedAt?: Date | string | null;
  now?: Date;
  // Explicitly ignored — must never drive retention.
  estimatedDeliveryDate?: Date | string | null;
  latestEstimatedDeliveryDate?: Date | string | null;
  sellerShipByActual?: Date | string | null;
  sellerShipByEnd?: Date | string | null;
  sellerShipByStart?: Date | string | null;
  purchaseDate?: Date | string | null;
  creationDate?: Date | string | null;
}): ResolveStockxInboundLogisticsResult {
  void params.estimatedDeliveryDate;
  void params.latestEstimatedDeliveryDate;
  void params.sellerShipByActual;
  void params.sellerShipByEnd;
  void params.sellerShipByStart;
  void params.purchaseDate;
  void params.creationDate;

  const now = params.now ?? new Date();

  const delivered = firstObservedDate(
    now,
    params.deliveredAt,
    params.deliveredDate,
    params.receivedAt
  );
  if (delivered) return { stockxEventAt: delivered, source: "delivered" };

  const shipped = isObservedLogisticsDate(params.shippedAt, now);
  if (shipped) return { stockxEventAt: shipped, source: "shipped" };

  const tracking = firstObservedDate(
    now,
    params.trackingEventAt,
    params.lastTrackingStatusAt
  );
  if (tracking) return { stockxEventAt: tracking, source: "tracking" };

  const statusKey = String(params.stateStatusKey ?? "").trim();
  const stateConfirmed = isObservedLogisticsDate(params.stateConfirmedAt, now);
  if (stateConfirmed && statusKey && SHIP_OR_DELIVER_STATUS_RE.test(statusKey)) {
    return { stockxEventAt: stateConfirmed, source: "state" };
  }

  // Priority 4: bare state.changedAt / state.updatedAt (list or detail).
  const stateChanged = firstObservedDate(
    now,
    params.stateChangedAt,
    params.stateUpdatedAt
  );
  if (stateChanged) return { stockxEventAt: stateChanged, source: "state" };

  return { stockxEventAt: null, source: "first_seen" };
}

/**
 * Pull real observed logistics fields from a StockX buy-order detail / list node.
 * Never reads ETA or sellerShipBy into stockxEventAt candidates.
 */
export function extractStockxInboundLogisticsAt(params: {
  detailOrder?: any | null;
  listNode?: any | null;
  now?: Date;
}): ResolveStockxInboundLogisticsResult {
  const order = params.detailOrder ?? null;
  const node = params.listNode ?? null;
  const now = params.now ?? new Date();
  const shipment = order?.shipping?.shipment ?? null;
  const returnInfo = order?.returnInfo ?? null;

  const deliveredDate = firstObservedDate(
    now,
    order?.deliveredAt,
    order?.receivedAt,
    order?.deliveredDate,
    shipment?.deliveredAt,
    shipment?.receivedAt,
    // shipment.deliveryDate is carrier-observed delivery when present (not ETA).
    shipment?.deliveryDate,
    returnInfo?.orderDeliveredDate,
    returnInfo?.receivedAt
  );

  const shippedAt = firstObservedDate(
    now,
    order?.shippedAt,
    order?.shippedDate,
    shipment?.shippedAt,
    shipment?.shippedDate,
    shipment?.shipDate
  );

  const trackingBuckets: unknown[] = [];
  for (const bucket of [
    shipment?.trackingEvents,
    shipment?.trackingHistory,
    shipment?.events,
    shipment?.statuses,
    shipment?.trackingStatuses,
    order?.trackingEvents,
    order?.trackingHistory,
    order?.tracking?.events,
    order?.tracking?.history,
  ]) {
    if (Array.isArray(bucket)) trackingBuckets.push(...bucket);
  }
  const trackingEventAt = latestObservedDateFromArray(trackingBuckets, now);

  const stateStatusKey =
    (typeof order?.currentStatus?.key === "string" && order.currentStatus.key) ||
    (typeof order?.status === "string" && order.status) ||
    (typeof node?.state?.statusKey === "string" && node.state.statusKey) ||
    (typeof node?.state?.statusTitle === "string" && node.state.statusTitle) ||
    null;

  // Timestamp only from a confirming ship/delivery state entry.
  let stateConfirmedAt: Date | null = null;
  const states = Array.isArray(order?.states) ? order.states : [];
  for (const st of states) {
    const key = String(st?.status ?? st?.title ?? st?.key ?? "").trim();
    if (!SHIP_OR_DELIVER_STATUS_RE.test(key)) continue;
    const d = firstObservedDate(
      now,
      st?.meta?.date,
      st?.meta?.timestamp,
      st?.meta?.occurredAt,
      st?.date,
      st?.timestamp,
      st?.completedAt,
      st?.changedAt,
      st?.updatedAt
    );
    if (d) {
      stateConfirmedAt = d;
      break;
    }
  }
  // Also accept list/detail status timestamp when the key itself confirms ship/delivery.
  if (!stateConfirmedAt && stateStatusKey && SHIP_OR_DELIVER_STATUS_RE.test(stateStatusKey)) {
    stateConfirmedAt = firstObservedDate(
      now,
      node?.state?.changedAt,
      node?.state?.updatedAt,
      order?.state?.changedAt,
      order?.currentStatus?.changedAt,
      order?.currentStatus?.updatedAt,
      order?.statusChangedAt,
      order?.statusUpdatedAt
    );
  }

  return resolveStockxInboundLogisticsAt({
    deliveredDate,
    shippedAt,
    trackingEventAt,
    stateConfirmedAt,
    stateStatusKey,
    stateChangedAt: firstObservedDate(
      now,
      node?.state?.changedAt,
      order?.state?.changedAt,
      order?.currentStatus?.changedAt,
      order?.statusChangedAt
    ),
    stateUpdatedAt: firstObservedDate(
      now,
      node?.state?.updatedAt,
      order?.state?.updatedAt,
      order?.currentStatus?.updatedAt,
      order?.statusUpdatedAt
    ),
    now,
    // Forbidden inputs — pass only to prove they are ignored.
    purchaseDate: node?.purchaseDate ?? order?.created ?? null,
    creationDate: node?.creationDate ?? null,
    estimatedDeliveryDate:
      node?.estimatedDeliveryDateRange?.estimatedDeliveryDate ?? null,
    latestEstimatedDeliveryDate:
      node?.estimatedDeliveryDateRange?.latestEstimatedDeliveryDate ?? null,
    sellerShipByActual: order?.sellerShipByDateRange?.actual ?? null,
    sellerShipByEnd: order?.sellerShipByDateRange?.end ?? null,
    sellerShipByStart: order?.sellerShipByDateRange?.start ?? null,
  });
}

export async function upsertStockxInboundPackage(
  input: UpsertStockxInboundPackageInput
): Promise<UpsertStockxInboundPackageResult | null> {
  const awb = normalizeAwb(input.awb);
  if (!awb) return null;
  const prismaAny = prisma as any;
  if (!prismaAny.stockxInboundPackage) {
    // Migration not applied yet — no-op so callers stay safe.
    return null;
  }

  const now = new Date();
  const purchaseDate = asDate(input.purchaseDate);
  // stockxEventAt = logistics only. Never fall back to purchaseDate.
  const stockxEventAt = asDate(input.stockxEventAt);
  // arrivedAt: set once on create from logistics event; do NOT bump on every cron.
  const arrivedAtCreate = stockxEventAt ?? now;

  const existing = await prismaAny.stockxInboundPackage.findUnique({
    where: { awb },
    select: { id: true, firstSeenAt: true },
  });

  if (!existing) {
    const created = await prismaAny.stockxInboundPackage.create({
      data: {
        awb,
        stockxOrderNumber: input.stockxOrderNumber ?? null,
        stockxOrderId: input.stockxOrderId ?? null,
        stockxAccountKey: input.stockxAccountKey ?? "default",
        sku: input.sku ?? null,
        sizeEU: input.sizeEU ?? null,
        productName: input.productName ?? null,
        purchaseDate,
        status: input.status ?? null,
        arrivedAt: arrivedAtCreate,
        firstSeenAt: now,
        lastSeenAt: now,
        stockxEventAt,
        channelHint: input.channelHint ?? "shopify",
      },
      select: {
        awb: true,
        firstSeenAt: true,
        lastSeenAt: true,
        stockxEventAt: true,
      },
    });
    return {
      awb: created.awb,
      created: true,
      firstSeenAt: created.firstSeenAt,
      lastSeenAt: created.lastSeenAt,
      stockxEventAt: created.stockxEventAt ?? null,
    };
  }

  const updated = await prismaAny.stockxInboundPackage.update({
    where: { awb },
    data: {
      stockxOrderNumber: input.stockxOrderNumber ?? undefined,
      stockxOrderId: input.stockxOrderId ?? undefined,
      stockxAccountKey: input.stockxAccountKey ?? undefined,
      sku: input.sku ?? undefined,
      sizeEU: input.sizeEU ?? undefined,
      productName: input.productName ?? undefined,
      purchaseDate: purchaseDate ?? undefined,
      status: input.status ?? undefined,
      // firstSeenAt: never touch
      lastSeenAt: now,
      // Prefer newer StockX event when available; do not clear.
      stockxEventAt: stockxEventAt ?? undefined,
      channelHint: input.channelHint ?? undefined,
      // arrivedAt: do not bump on resync
    },
    select: {
      awb: true,
      firstSeenAt: true,
      lastSeenAt: true,
      stockxEventAt: true,
    },
  });

  return {
    awb: updated.awb,
    created: false,
    firstSeenAt: updated.firstSeenAt,
    lastSeenAt: updated.lastSeenAt,
    stockxEventAt: updated.stockxEventAt ?? null,
  };
}

export async function findStockxInboundPackageByAwb(awbRaw: string) {
  const awb = normalizeAwb(awbRaw);
  if (!awb) return null;
  const prismaAny = prisma as any;
  if (!prismaAny.stockxInboundPackage) return null;
  return prismaAny.stockxInboundPackage.findUnique({ where: { awb } });
}

/**
 * Keep the top `limit` rows for an account by retention rank
 * (stockxEventAt desc, else firstSeenAt). Returns pruned count.
 */
export async function pruneStockxInboundPackagesForAccount(params: {
  accountKey: string;
  limit: number;
}): Promise<number> {
  const prismaAny = prisma as any;
  if (!prismaAny.stockxInboundPackage) return 0;
  const accountKey = String(params.accountKey ?? "").trim() || "default";
  const limit = Math.max(1, Math.min(500, params.limit));

  const rows = await prismaAny.stockxInboundPackage.findMany({
    where: { stockxAccountKey: accountKey },
    select: {
      id: true,
      stockxEventAt: true,
      firstSeenAt: true,
      arrivedAt: true,
    },
  });

  if (rows.length <= limit) return 0;

  const ranked = [...rows].sort(
    (a, b) =>
      inboundRetentionRankAt(b).getTime() - inboundRetentionRankAt(a).getTime()
  );
  const keepIds = new Set(ranked.slice(0, limit).map((r: { id: string }) => r.id));
  const prunedResult = await prismaAny.stockxInboundPackage.deleteMany({
    where: {
      stockxAccountKey: accountKey,
      id: { notIn: Array.from(keepIds) },
    },
  });
  return Number(prunedResult?.count ?? 0);
}

/**
 * @deprecated Rebuilding StockxInboundPackage from OrderMatch / StxPurchaseUnit
 * copied whatever AWB we happened to have already saved and marketed it as an
 * "arrived StockX parcel", which is exactly the wrong signal for the AWB
 * fallback. Real inbound sync now lives in
 * {@link ./stockxInboundSyncFromApi.ts#syncStockxInboundPackagesFromStockxApi}
 * and hits the StockX buying API. This function is kept as a no-op so old
 * imports keep compiling; callers should migrate.
 */
export async function syncStockxInboundPackagesFromDb(_options?: {
  limit?: number;
}): Promise<{ upserted: number; pruned: number; deprecated: true }> {
  console.warn(
    "[STOCKX-INBOUND-PACKAGES] syncStockxInboundPackagesFromDb is deprecated no-op; " +
      "use syncStockxInboundPackagesFromStockxApi instead."
  );
  return { upserted: 0, pruned: 0, deprecated: true };
}

/**
 * Candidates for Shopify AWB fallback: OrderMatch rows still missing AWB
 * (or matching SKU) within freshness window — open-ish matches.
 *
 * NOTE: these rows are only *discovery hints*. Callers MUST re-verify against
 * live Shopify fulfillment orders before treating them as open lines. Cf.
 * `app/lib/shopifyOpenLineCandidates.ts` for the verified loader.
 */
export async function loadShopifyOpenMatchCandidatesForSku(params: {
  sku: string;
  sizeEU?: string | null;
  minCreatedAt: Date;
}) {
  const sku = String(params.sku ?? "").trim();
  if (!sku) return [];

  return prisma.orderMatch.findMany({
    where: {
      shopifySku: { equals: sku, mode: "insensitive" },
      shopifyCreatedAt: { gte: params.minCreatedAt },
      OR: [{ stockxAwb: null }, { stockxAwb: "" }],
      ...(params.sizeEU
        ? { shopifySizeEU: { equals: String(params.sizeEU), mode: "insensitive" } }
        : {}),
    },
    orderBy: { shopifyCreatedAt: "asc" },
    take: 40,
    select: {
      shopifyOrderId: true,
      shopifyOrderName: true,
      shopifyLineItemId: true,
      shopifySku: true,
      shopifySizeEU: true,
      shopifyProductTitle: true,
      shopifyCreatedAt: true,
      stockxAwb: true,
      stockxOrderNumber: true,
    },
  });
}
