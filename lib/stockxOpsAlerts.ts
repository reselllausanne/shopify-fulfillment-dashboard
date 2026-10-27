/**
 * Operator-facing StockX order issue alerts.
 *
 * Sends the OPERATOR (STOCKX_ALERT_EMAIL) a digest BEFORE any customer-facing flow when a
 * linked StockX buy is cancelled / refunded, running late (ETA passed, not shipped), or a
 * paid Galaxus STX line has no StockX buy after N days ("not purchased").
 *
 * Customer milestone emails (app/lib/notifications/stockxEmail.ts) deliberately SKIP
 * cancelled/refunded + eta_passed, so these never leak to customers — the operator is the
 * only recipient here.
 *
 * Dedup: one StockxOrderAlert row per (scope, alertType, refKey). Re-running never re-mails
 * the same issue.
 */
import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "@/app/lib/prisma";
import { getMailer } from "@/app/lib/mailer";
import { filterGalaxusLinesNeedingStockxAutoLink } from "@/galaxus/orders/autoLinkStockxBuys";
import { buildLinkedCountByOrderId } from "@/galaxus/orders/lineProcurement";
import { shopifyGraphQL, type ShopifyGraphQLResult } from "@/lib/shopifyAdmin";
import {
  isInStockEssentialLine,
  isPackageProtectionShopifyLine,
  isShopifyFinancialRefunded,
} from "@/app/utils/matching";
import {
  lineFulfillableQuantity,
  shouldSkipOrderForFulfillmentMatching,
} from "@/app/lib/shopifyOrderFulfillmentFilters";
import { isStockxAutoBuyExcluded } from "@/lib/stockxAutoCheckout/precheckAvailability";

const SHOP_TIMEZONE = "Europe/Zurich";

const DAY_MS = 86_400_000;

const STX_LINE_FILTER = {
  OR: [
    { providerKey: { startsWith: "STX_", mode: "insensitive" as const } },
    { supplierVariantId: { startsWith: "stx_", mode: "insensitive" as const } },
    { supplierPid: { startsWith: "STX_", mode: "insensitive" as const } },
  ],
};

type AlertScope = "shopify" | "galaxus";
type AlertType = "CANCELLED" | "REFUNDED" | "DELAYED" | "NOT_PURCHASED" | "UNLINKED";

/**
 * Pure detection of dashboard "0/N linked" orders (red cards on the direct-delivery list).
 *
 * Mirrors EXACTLY the list red tone: an order whose STX/supplier lines still need a buy
 * (`needsBuy > 0` via the same `buildLinkedCountByOrderId` the orders API uses). Pure so it
 * is unit-testable without a DB.
 */
export type UnlinkedGalaxusOrderInput = {
  orders: Array<{
    id: string;
    galaxusOrderId: string;
    orderNumber?: string | null;
    orderDate?: Date | string | null;
  }>;
  lines: any[];
  stockxMatches: any[];
  stxUnits: any[];
  externalBuys?: any[];
};

export type UnlinkedGalaxusOrderAlert = {
  orderId: string;
  orderRef: string | null;
  productTitle: string | null;
  linkedCount: number;
  lineCount: number;
  needsBuyCount: number;
  orderDate: Date | string | null;
};

export function detectUnlinkedGalaxusOrders(
  input: UnlinkedGalaxusOrderInput
): UnlinkedGalaxusOrderAlert[] {
  const { linked, needsBuy } = buildLinkedCountByOrderId({
    orders: input.orders.map((o) => ({ id: o.id, galaxusOrderId: o.galaxusOrderId })),
    lines: input.lines ?? [],
    stockxMatches: input.stockxMatches ?? [],
    stxUnits: input.stxUnits ?? [],
    externalBuys: input.externalBuys ?? [],
  });

  const linesByOrder = new Map<string, any[]>();
  for (const line of input.lines ?? []) {
    const oid = String(line?.orderId ?? "").trim();
    if (!oid) continue;
    const arr = linesByOrder.get(oid) ?? [];
    arr.push(line);
    linesByOrder.set(oid, arr);
  }

  const out: UnlinkedGalaxusOrderAlert[] = [];
  for (const o of input.orders ?? []) {
    const id = String(o.id);
    const need = needsBuy.get(id) ?? 0;
    if (need <= 0) continue;
    const orderLines = linesByOrder.get(id) ?? [];
    const titles = orderLines
      .map((l: any) => String(l?.productName ?? l?.description ?? "").trim())
      .filter(Boolean)
      .slice(0, 3)
      .join(", ");
    out.push({
      orderId: id,
      orderRef: String(o.orderNumber ?? o.galaxusOrderId ?? id),
      productTitle: titles || null,
      linkedCount: linked.get(id) ?? 0,
      lineCount: orderLines.length,
      needsBuyCount: need,
      orderDate: o.orderDate ?? null,
    });
  }
  return out;
}

/**
 * Brands / lines that must NOT be sourced on StockX (not website-stock StockX pairs):
 * BAPE, Fear of God *Essentials*, Crocs (via the auto-buy exclude list) + the fixed-price
 * in-stock lane + explicit Fear of God / watches. Used to keep the hard-unlinked Shopify
 * alert to real StockX-eligible pairs only (never website-stock apparel / watches).
 */
export function isShopifyLineStockxIneligibleForAlert(line: {
  title?: string | null;
  sku?: string | null;
}): boolean {
  const title = String(line.title ?? "");
  const sku = line.sku ?? null;
  if (isInStockEssentialLine(sku, title)) return true;
  if (isPackageProtectionShopifyLine(title, sku)) return true;
  if (isStockxAutoBuyExcluded({ title, sku }).excluded) return true;
  if (/\bfear of god\b/i.test(title)) return true;
  if (/\bwatch(?:es)?\b/i.test(title)) return true;
  return false;
}

/**
 * Pure detection of HARD-unlinked Shopify orders — the red "unlinked" rows the dashboard
 * (`/api/notifications/unlinked-orders`) shows: a StockX-eligible, fulfillable line on a
 * paid / non-cancelled / non-refunded order with NO OrderMatch carrying a real StockX ref.
 *
 * Caller must only pass candidate lines already filtered for order financial state
 * (not cancelled / void / refunded) and `fulfillableQuantity > 0`, mirroring the dashboard.
 * This fn adds: StockX-eligibility (brand gate), the age window, the "linked" set, and the
 * "buyable-in-progress / medium-email" exclusion — so no overlap with the medium match email.
 */
export type ShopifyUnlinkedLineInput = {
  shopifyOrderId: string;
  shopifyOrderName: string;
  shopifyLineItemId: string;
  title: string;
  sku: string | null;
  createdAtIso: string;
};

export type UnlinkedShopifyOrderAlert = {
  shopifyOrderId: string;
  orderRef: string;
  productTitle: string | null;
  unlinkedLineCount: number;
  createdAtIso: string;
};

export function detectUnlinkedShopifyOrders(params: {
  candidateLines: ShopifyUnlinkedLineInput[];
  /** OrderMatch.shopifyLineItemId values that carry a real (non-empty) StockX ref. */
  linkedLineItemIds: Set<string> | string[];
  now: number;
  /** createdAt must be >= this (within window). */
  windowFloorMs: number;
  /** createdAt must be <= this (older than the transient / not-purchased window). */
  cutoffMs: number;
  /** Order names to skip (plausible buy candidate / buyable-in-progress / medium email). */
  excludeOrderNames?: Set<string> | string[];
}): UnlinkedShopifyOrderAlert[] {
  const linked =
    params.linkedLineItemIds instanceof Set
      ? params.linkedLineItemIds
      : new Set(params.linkedLineItemIds ?? []);
  const excluded =
    params.excludeOrderNames instanceof Set
      ? params.excludeOrderNames
      : new Set(params.excludeOrderNames ?? []);

  type Agg = { name: string; createdAtIso: string; titles: string[]; count: number };
  const byOrder = new Map<string, Agg>();

  for (const line of params.candidateLines ?? []) {
    if (!line?.shopifyLineItemId) continue;
    if (linked.has(line.shopifyLineItemId)) continue; // already linked to a real StockX buy
    if (excluded.has(line.shopifyOrderName)) continue; // buyable-in-progress / medium email
    if (isShopifyLineStockxIneligibleForAlert(line)) continue; // brand gate

    const createdMs = new Date(line.createdAtIso).getTime();
    if (!Number.isFinite(createdMs)) continue;
    if (createdMs < params.windowFloorMs || createdMs > params.cutoffMs) continue; // age window

    const key = String(line.shopifyOrderId);
    const agg = byOrder.get(key) ?? {
      name: line.shopifyOrderName,
      createdAtIso: line.createdAtIso,
      titles: [],
      count: 0,
    };
    agg.count += 1;
    if (agg.titles.length < 3 && line.title) agg.titles.push(line.title);
    byOrder.set(key, agg);
  }

  const out: UnlinkedShopifyOrderAlert[] = [];
  for (const [shopifyOrderId, agg] of byOrder) {
    out.push({
      shopifyOrderId,
      orderRef: agg.name,
      productTitle: agg.titles.join(", ") || null,
      unlinkedLineCount: agg.count,
      createdAtIso: agg.createdAtIso,
    });
  }
  out.sort((a, b) => new Date(b.createdAtIso).getTime() - new Date(a.createdAtIso).getTime());
  return out;
}

const SHOPIFY_UNLINKED_ORDERS_QUERY = /* GraphQL */ `
  query OpsAlertUnlinkedShopify($cursor: String, $query: String!) {
    orders(first: 50, after: $cursor, sortKey: CREATED_AT, reverse: true, query: $query) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          name
          createdAt
          cancelledAt
          displayFinancialStatus
          lineItems(first: 50) {
            edges {
              node { id title name sku quantity fulfillableQuantity }
            }
          }
        }
      }
    }
  }
`;

function shopifyGidToNumericId(gid: string): string {
  const m = String(gid || "").match(/\/(\d+)\s*$/);
  return m ? m[1]! : String(gid || "");
}

/**
 * Fetch candidate Shopify unlinked lines in [floor, cutoff] — mirrors the dashboard
 * `/api/notifications/unlinked-orders` filters (skip cancelled/void/refunded orders,
 * drop in-stock-fixed-price lines, require fulfillableQuantity > 0).
 */
async function fetchShopifyUnlinkedCandidateLines(
  floor: Date,
  cutoff: Date
): Promise<ShopifyUnlinkedLineInput[]> {
  const q = `created_at:>=${floor.toISOString().slice(0, 10)} created_at:<=${cutoff
    .toISOString()
    .slice(0, 10)}`;
  type OrdersPage = {
    orders: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      edges: Array<{ node: any }>;
    };
  };
  const out: ShopifyUnlinkedLineInput[] = [];
  let cursor: string | null = null;
  let pages = 0;
  for (;;) {
    const res: ShopifyGraphQLResult<OrdersPage> = await shopifyGraphQL<OrdersPage>(
      SHOPIFY_UNLINKED_ORDERS_QUERY,
      { cursor, query: q }
    );
    const errors = res.errors;
    if (errors?.length) {
      throw new Error(errors.map((e: any) => e.message).join("; "));
    }
    const page = res.data?.orders;
    if (!page) break;
    for (const edge of page.edges ?? []) {
      const order = edge?.node;
      if (!order) continue;
      if (shouldSkipOrderForFulfillmentMatching(order)) continue;
      if (isShopifyFinancialRefunded(order.displayFinancialStatus)) continue;
      const createdAtIso = formatInTimeZone(
        new Date(order.createdAt),
        SHOP_TIMEZONE,
        "yyyy-MM-dd'T'HH:mm:ssXXX"
      );
      for (const liEdge of order.lineItems?.edges ?? []) {
        const li = liEdge?.node;
        if (!li?.id) continue;
        const title = String(li.name ?? li.title ?? "—");
        const sku = li.sku ? String(li.sku) : null;
        if (isInStockEssentialLine(sku, title)) continue;
        if (lineFulfillableQuantity(li) <= 0) continue;
        out.push({
          shopifyOrderId: shopifyGidToNumericId(order.id),
          shopifyOrderName: String(order.name),
          shopifyLineItemId: String(li.id),
          title,
          sku,
          createdAtIso,
        });
      }
    }
    if (!page.pageInfo.hasNextPage) break;
    cursor = page.pageInfo.endCursor;
    if (++pages > 40) break;
  }
  return out;
}

type PendingAlert = {
  scope: AlertScope;
  alertType: AlertType;
  refKey: string;
  orderRef: string | null;
  stockxOrderNumber: string | null;
  productTitle: string | null;
  detail: string | null;
};

export type StockxOpsAlertResult = {
  ok: boolean;
  error?: string;
  candidates: number;
  newAlerts: number;
  emailed: boolean;
  emailTo: string | null;
  byType: Record<AlertType, number>;
  skippedExisting: number;
  /** First-ever run: backlog recorded without a full per-item email (summary only). */
  baselineSeeded: boolean;
};

function statusKey(s: string | null | undefined): string {
  return String(s ?? "").trim().toUpperCase();
}

function isCancelledStatus(s: string | null | undefined): boolean {
  return statusKey(s).includes("CANCEL");
}
function isRefundedStatus(s: string | null | undefined): boolean {
  return statusKey(s).includes("REFUND");
}

// Statuses that are terminal (already delivered/received/complete) or not a real tracked
// StockX buy (local physical stock / manual) — never "delayed".
const NON_DELAYABLE_STATUS = /CANCEL|REFUND|DELIVER|COMPLET|RECEIV|LOCAL|MANUAL/;

/** True only for a genuinely-late tracked buy: real status, ETA just passed (recent window). */
function isRecentlyLate(
  status: string | null | undefined,
  eta: Date | null | undefined,
  now: number,
  lateWindowMs: number
): boolean {
  const sk = statusKey(status);
  if (!sk || NON_DELAYABLE_STATUS.test(sk)) return false;
  if (!eta) return false;
  const t = new Date(eta).getTime();
  return t < now && t > now - lateWindowMs;
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  try {
    return new Date(d).toISOString().slice(0, 10);
  } catch {
    return "—";
  }
}

export async function runStockxOrderOpsAlerts(options?: {
  days?: number;
  notPurchasedAgeDays?: number;
  lateWindowDays?: number;
  /** How far back to scan for dashboard "0/N linked" orders (> not-purchased floor). */
  unlinkedWindowDays?: number;
  /** Shopify order names to skip in UNLINKED (plausible buy candidate / medium email). */
  excludeShopifyOrderNames?: string[];
  dryRun?: boolean;
}): Promise<StockxOpsAlertResult> {
  const days = Math.max(1, Math.min(120, Number(options?.days ?? 30)));
  const notPurchasedAgeDays = Math.max(1, Math.min(60, Number(options?.notPurchasedAgeDays ?? 2)));
  // A buy only counts as "delayed" when its ETA passed within this recent window — stops
  // months-old past-ETA backlog (often already delivered) from flooding the digest.
  const lateWindowDays = Math.max(1, Math.min(30, Number(options?.lateWindowDays ?? 7)));
  const lateWindowMs = lateWindowDays * DAY_MS;
  // Only flag recently-unbought orders (older are known lost causes, not actionable now).
  const notPurchasedMaxDays = 14;
  const dryRun = Boolean(options?.dryRun);
  const now = Date.now();
  const since = new Date(now - days * DAY_MS);
  const notPurchasedCutoff = new Date(now - notPurchasedAgeDays * DAY_MS);
  const notPurchasedFloor = new Date(now - notPurchasedMaxDays * DAY_MS);

  const result: StockxOpsAlertResult = {
    ok: true,
    candidates: 0,
    newAlerts: 0,
    emailed: false,
    emailTo: null,
    byType: { CANCELLED: 0, REFUNDED: 0, DELAYED: 0, NOT_PURCHASED: 0, UNLINKED: 0 },
    skippedExisting: 0,
    baselineSeeded: false,
  };

  const prismaAny = prisma as any;
  const pending: PendingAlert[] = [];

  // ---- Shopify: cancelled / refunded / delayed (linked OrderMatch) ----
  try {
    const shopifyMatches = await prisma.orderMatch.findMany({
      where: {
        shopifyCreatedAt: { gte: since },
        stockxOrderNumber: { not: "" },
      },
      select: {
        id: true,
        shopifyOrderId: true,
        shopifyOrderName: true,
        shopifyProductTitle: true,
        stockxOrderNumber: true,
        stockxStatus: true,
        stockxEstimatedDelivery: true,
        stockxLatestEstimatedDelivery: true,
      },
    });

    // Delayed rows need a fulfillment check — batch fetch fulfilled order ids.
    const orderIds = Array.from(
      new Set(shopifyMatches.map((m) => m.shopifyOrderId).filter((v): v is string => Boolean(v)))
    );
    const fulfilled = orderIds.length
      ? await prisma.shopifyFulfillmentRecord.findMany({
          where: { shopifyOrderId: { in: orderIds } },
          select: { shopifyOrderId: true },
        })
      : [];
    const fulfilledSet = new Set(fulfilled.map((f) => f.shopifyOrderId));

    for (const m of shopifyMatches) {
      if (isCancelledStatus(m.stockxStatus)) {
        pending.push({
          scope: "shopify",
          alertType: "CANCELLED",
          refKey: m.id,
          orderRef: m.shopifyOrderName ?? null,
          stockxOrderNumber: m.stockxOrderNumber ?? null,
          productTitle: m.shopifyProductTitle ?? null,
          detail: `StockX status ${statusKey(m.stockxStatus)}`,
        });
        continue;
      }
      if (isRefundedStatus(m.stockxStatus)) {
        pending.push({
          scope: "shopify",
          alertType: "REFUNDED",
          refKey: m.id,
          orderRef: m.shopifyOrderName ?? null,
          stockxOrderNumber: m.stockxOrderNumber ?? null,
          productTitle: m.shopifyProductTitle ?? null,
          detail: `StockX status ${statusKey(m.stockxStatus)}`,
        });
        continue;
      }
      // Delayed: real buy, ETA recently passed, not fulfilled on Shopify.
      const eta = m.stockxLatestEstimatedDelivery || m.stockxEstimatedDelivery;
      if (
        isRecentlyLate(m.stockxStatus, eta, now, lateWindowMs) &&
        !fulfilledSet.has(m.shopifyOrderId ?? "")
      ) {
        pending.push({
          scope: "shopify",
          alertType: "DELAYED",
          refKey: m.id,
          orderRef: m.shopifyOrderName ?? null,
          stockxOrderNumber: m.stockxOrderNumber ?? null,
          productTitle: m.shopifyProductTitle ?? null,
          detail: `ETA ${fmtDate(eta)} passed, not shipped`,
        });
      }
    }
  } catch (err: any) {
    console.warn("[STOCKX][OPS_ALERT] shopify scan failed:", err?.message ?? err);
  }

  // ---- Galaxus: cancelled / refunded / delayed (linked GalaxusStockxMatch) ----
  try {
    const gxMatches = await prismaAny.galaxusStockxMatch.findMany({
      where: {
        createdAt: { gte: since },
        stockxOrderNumber: { not: "" },
      },
      select: {
        id: true,
        galaxusOrderRef: true,
        galaxusProductName: true,
        stockxOrderNumber: true,
        stockxStatus: true,
        stockxEstimatedDelivery: true,
        stockxLatestEstimatedDelivery: true,
      },
    });
    for (const m of gxMatches) {
      if (isCancelledStatus(m.stockxStatus)) {
        pending.push({
          scope: "galaxus",
          alertType: "CANCELLED",
          refKey: String(m.id),
          orderRef: m.galaxusOrderRef ?? null,
          stockxOrderNumber: m.stockxOrderNumber ?? null,
          productTitle: m.galaxusProductName ?? null,
          detail: `StockX status ${statusKey(m.stockxStatus)}`,
        });
        continue;
      }
      if (isRefundedStatus(m.stockxStatus)) {
        pending.push({
          scope: "galaxus",
          alertType: "REFUNDED",
          refKey: String(m.id),
          orderRef: m.galaxusOrderRef ?? null,
          stockxOrderNumber: m.stockxOrderNumber ?? null,
          productTitle: m.galaxusProductName ?? null,
          detail: `StockX status ${statusKey(m.stockxStatus)}`,
        });
        continue;
      }
      const eta = m.stockxLatestEstimatedDelivery || m.stockxEstimatedDelivery;
      if (isRecentlyLate(m.stockxStatus, eta, now, lateWindowMs)) {
        pending.push({
          scope: "galaxus",
          alertType: "DELAYED",
          refKey: String(m.id),
          orderRef: m.galaxusOrderRef ?? null,
          stockxOrderNumber: m.stockxOrderNumber ?? null,
          productTitle: m.galaxusProductName ?? null,
          detail: `ETA ${fmtDate(eta)} passed, not delivered`,
        });
      }
    }
  } catch (err: any) {
    console.warn("[STOCKX][OPS_ALERT] galaxus scan failed:", err?.message ?? err);
  }

  // ---- Galaxus: not-purchased (paid STX line, no buy linked after N days) ----
  try {
    const orders = await prismaAny.galaxusOrder.findMany({
      where: {
        archivedAt: null,
        cancelledAt: null,
        orderDate: { gte: notPurchasedFloor, lte: notPurchasedCutoff },
        lines: { some: STX_LINE_FILTER },
      },
      include: { lines: true },
    });
    if (orders.length > 0) {
      const matches = await prismaAny.galaxusStockxMatch.findMany({
        where: { galaxusOrderId: { in: orders.map((o: any) => o.id) } },
        select: { galaxusOrderId: true, galaxusOrderLineId: true, stockxOrderNumber: true },
      });
      const byOrder = new Map<string, any[]>();
      for (const m of matches) {
        const k = String(m.galaxusOrderId);
        const arr = byOrder.get(k) ?? [];
        arr.push(m);
        byOrder.set(k, arr);
      }
      for (const order of orders) {
        const needing = filterGalaxusLinesNeedingStockxAutoLink(
          order.lines ?? [],
          byOrder.get(order.id) ?? []
        );
        if (needing.length === 0) continue;
        const titles = needing
          .map((l: any) => String(l.productName ?? l.description ?? "").trim())
          .filter(Boolean)
          .slice(0, 3)
          .join(", ");
        pending.push({
          scope: "galaxus",
          alertType: "NOT_PURCHASED",
          refKey: String(order.id),
          orderRef: String(order.galaxusOrderId ?? order.id),
          stockxOrderNumber: null,
          productTitle: titles || null,
          detail: `${needing.length} STX unit(s) unbought since ${fmtDate(order.orderDate)}`,
        });
      }
    }
  } catch (err: any) {
    console.warn("[STOCKX][OPS_ALERT] galaxus not-purchased scan failed:", err?.message ?? err);
  }

  // ---- Galaxus: unlinked "0/N linked" orders (dashboard red cards) ----
  // Catches orders older than the not-purchased window that are still not fully linked to a
  // StockX buy (the red rows on /galaxus/direct-delivery). Uses the SAME needs-buy rule the
  // orders API uses for the list tone, so this matches exactly what the operator sees.
  try {
    const unlinkedWindowDays = Math.max(7, Math.min(180, Number(options?.unlinkedWindowDays ?? 60)));
    const unlinkedFloor = new Date(now - unlinkedWindowDays * DAY_MS);
    // Older than the not-purchased floor so the two scans never double-alert the same order.
    const unlinkedCutoff = notPurchasedFloor;

    const orders = await prismaAny.galaxusOrder.findMany({
      where: {
        archivedAt: null,
        cancelledAt: null,
        orderDate: { gte: unlinkedFloor, lt: unlinkedCutoff },
        lines: { some: STX_LINE_FILTER },
      },
      select: {
        id: true,
        galaxusOrderId: true,
        orderNumber: true,
        orderDate: true,
        lines: {
          select: {
            id: true,
            orderId: true,
            gtin: true,
            quantity: true,
            supplierPid: true,
            supplierSku: true,
            supplierVariantId: true,
            providerKey: true,
            productName: true,
            description: true,
          },
        },
      },
    });

    if (orders.length > 0) {
      const orderIds = orders.map((o: any) => o.id);
      const orderRefs = orders.map((o: any) => o.galaxusOrderId).filter(Boolean);
      const [stockxMatches, stxUnits, externalBuys] = await Promise.all([
        prismaAny.galaxusStockxMatch
          .findMany({
            where: { galaxusOrderId: { in: orderIds } },
            select: {
              galaxusOrderId: true,
              galaxusOrderLineId: true,
              galaxusGtin: true,
              unitIndex: true,
              stockxOrderId: true,
              stockxOrderNumber: true,
              stockxAmount: true,
              stockxCurrencyCode: true,
              stockxAwb: true,
              stockxStatus: true,
              stockxSkuKey: true,
              matchType: true,
            },
          })
          .catch(() => []),
        orderRefs.length > 0
          ? prismaAny.stxPurchaseUnit
              .findMany({
                where: {
                  galaxusOrderId: { in: orderRefs },
                  stockxOrderId: { not: null },
                  cancelledAt: null,
                },
                select: {
                  galaxusOrderId: true,
                  gtin: true,
                  supplierVariantId: true,
                  stockxOrderId: true,
                  stockxOrderNumber: true,
                  stockxSettledAmount: true,
                  stockxSettledCurrency: true,
                  awb: true,
                  etaMin: true,
                  etaMax: true,
                  cancelledAt: true,
                },
              })
              .catch(() => [])
          : Promise.resolve([]),
        prismaAny.galaxusExternalBuy
          .findMany({
            where: { galaxusOrderId: { in: orderIds }, cancelledAt: null },
            select: {
              id: true,
              galaxusOrderId: true,
              galaxusOrderLineId: true,
              unitIndex: true,
              supplierKey: true,
              supplierOrderNumber: true,
              costAmount: true,
              currencyCode: true,
              trackingNumber: true,
              trackingUrl: true,
              cancelledAt: true,
            },
          })
          .catch(() => []),
      ]);

      const allLines = orders.flatMap((o: any) =>
        (o.lines ?? []).map((l: any) => ({ ...l, orderId: l.orderId ?? o.id }))
      );

      const detected = detectUnlinkedGalaxusOrders({
        orders,
        lines: allLines,
        stockxMatches: Array.isArray(stockxMatches) ? stockxMatches : [],
        stxUnits: Array.isArray(stxUnits) ? stxUnits : [],
        externalBuys: Array.isArray(externalBuys) ? externalBuys : [],
      });

      for (const d of detected) {
        pending.push({
          scope: "galaxus",
          alertType: "UNLINKED",
          refKey: d.orderId,
          orderRef: d.orderRef,
          stockxOrderNumber: null,
          productTitle: d.productTitle,
          detail: `${d.linkedCount}/${d.lineCount} linked · ${d.needsBuyCount} ligne(s) sans achat StockX (depuis ${fmtDate(
            d.orderDate as any
          )})`,
        });
      }
    }
  } catch (err: any) {
    console.warn("[STOCKX][OPS_ALERT] galaxus unlinked scan failed:", err?.message ?? err);
  }

  // ---- Shopify: hard-unlinked orders (dashboard red "unlinked" rows) ----
  // StockX-eligible paid Shopify orders older than the transient window with NO OrderMatch
  // carrying a real StockX ref, and NO plausible buy candidate (buyable-in-progress / medium
  // email) — i.e. a pair we sold but never bought/linked on StockX.
  try {
    const unlinkedWindowDays = Math.max(7, Math.min(180, Number(options?.unlinkedWindowDays ?? 60)));
    const unlinkedFloor = new Date(now - unlinkedWindowDays * DAY_MS);
    const unlinkedCutoff = notPurchasedFloor; // older than not-purchased window (>14d)

    const candidateLines = await fetchShopifyUnlinkedCandidateLines(unlinkedFloor, unlinkedCutoff);
    if (candidateLines.length > 0) {
      const lineItemIds = candidateLines.map((l) => l.shopifyLineItemId);
      const matches = await prisma.orderMatch.findMany({
        where: { shopifyLineItemId: { in: lineItemIds }, stockxOrderNumber: { not: "" } },
        select: { shopifyLineItemId: true, stockxOrderNumber: true },
      });
      const linkedLineItemIds = new Set(
        matches
          .filter((m) => String(m.stockxOrderNumber ?? "").trim().length > 0)
          .map((m) => m.shopifyLineItemId)
      );

      const detected = detectUnlinkedShopifyOrders({
        candidateLines,
        linkedLineItemIds,
        now,
        windowFloorMs: unlinkedFloor.getTime(),
        cutoffMs: unlinkedCutoff.getTime(),
        excludeOrderNames: options?.excludeShopifyOrderNames ?? [],
      });

      for (const d of detected) {
        pending.push({
          scope: "shopify",
          alertType: "UNLINKED",
          refKey: d.shopifyOrderId,
          orderRef: d.orderRef,
          stockxOrderNumber: null,
          productTitle: d.productTitle,
          detail: `${d.unlinkedLineCount} ligne(s) sans achat StockX (depuis ${fmtDate(
            new Date(d.createdAtIso)
          )})`,
        });
      }
    }
  } catch (err: any) {
    console.warn("[STOCKX][OPS_ALERT] shopify unlinked scan failed:", err?.message ?? err);
  }

  result.candidates = pending.length;
  if (pending.length === 0) return result;

  // Dedup against already-alerted rows.
  const existing = await prismaAny.stockxOrderAlert.findMany({
    where: {
      OR: pending.map((p) => ({
        scope: p.scope,
        alertType: p.alertType,
        refKey: p.refKey,
      })),
    },
    select: { scope: true, alertType: true, refKey: true },
  });
  const existingKeys = new Set(
    existing.map((e: any) => `${e.scope}|${e.alertType}|${e.refKey}`)
  );
  const fresh = pending.filter(
    (p) => !existingKeys.has(`${p.scope}|${p.alertType}|${p.refKey}`)
  );
  result.skippedExisting = pending.length - fresh.length;
  if (fresh.length === 0) return result;

  for (const p of fresh) result.byType[p.alertType] += 1;
  result.newAlerts = fresh.length;

  // First-ever run: table empty ⇒ everything is pre-existing backlog. Record it as a
  // baseline (so future runs only alert on genuinely new issues) and send a short counts
  // summary instead of a flood of hundreds of historical lines.
  const totalExisting = await prismaAny.stockxOrderAlert.count().catch(() => 1);
  const baseline = totalExisting === 0;
  result.baselineSeeded = baseline;

  const operator =
    (process.env.STOCKX_ALERT_EMAIL || "").trim() ||
    (process.env.POSTMARK_FROM_EMAIL || "").trim();
  result.emailTo = operator || null;

  if (dryRun) return result;

  // Send ONE operator digest (full list normally; counts-only on baseline seed).
  if (operator) {
    const { text, html, subject } = baseline
      ? buildBaselineSummary(result.byType, fresh.length)
      : buildDigest(fresh, result.byType);
    try {
      const sendRes = await getMailer().sendRawEmail({
        to: operator,
        subject,
        textBody: text,
        htmlBody: html,
        ignoreOverride: true,
      });
      result.emailed = Boolean(sendRes.ok);
      if (!sendRes.ok) {
        result.error = sendRes.error;
        console.warn("[STOCKX][OPS_ALERT] email failed:", sendRes.error);
      }
    } catch (err: any) {
      result.error = String(err?.message ?? err);
      console.warn("[STOCKX][OPS_ALERT] email threw:", result.error);
    }
  } else {
    result.error = "no_operator_email";
  }

  // Persist dedup rows only after a successful send (so a failed email retries next run).
  if (result.emailed || !operator) {
    try {
      await prismaAny.stockxOrderAlert.createMany({
        data: fresh.map((p) => ({
          scope: p.scope,
          alertType: p.alertType,
          refKey: p.refKey,
          orderRef: p.orderRef,
          stockxOrderNumber: p.stockxOrderNumber,
          productTitle: p.productTitle,
          detail: p.detail,
          emailTo: operator || null,
        })),
        skipDuplicates: true,
      });
    } catch (err: any) {
      console.warn("[STOCKX][OPS_ALERT] persist failed:", err?.message ?? err);
    }
  }

  return result;
}

const TYPE_LABEL: Record<AlertType, string> = {
  CANCELLED: "Annulations StockX",
  REFUNDED: "Remboursements StockX",
  DELAYED: "Retards (ETA depassee)",
  NOT_PURCHASED: "Non achetes (buy manquant)",
  UNLINKED: "Non lies StockX (0/N linked)",
};

function buildBaselineSummary(
  byType: Record<AlertType, number>,
  total: number
): { subject: string; text: string; html: string } {
  const rows = (["CANCELLED", "REFUNDED", "DELAYED", "NOT_PURCHASED", "UNLINKED"] as AlertType[])
    .filter((t) => byType[t] > 0)
    .map((t) => `${TYPE_LABEL[t]}: ${byType[t]}`);
  const subject = `[Resell OPS] StockX alertes activees — baseline ${total} enregistree(s)`;
  const text = [
    "Systeme d'alertes StockX active.",
    "",
    `Backlog actuel enregistre comme baseline (${total}) — PAS de details ici pour eviter le flood.`,
    "Seuls les NOUVEAUX problemes seront envoyes en detail aux prochains passages.",
    "",
    ...rows.map((r) => `- ${r}`),
  ].join("\n");
  const html = `<h2 style="font-family:Arial,sans-serif;">Alertes StockX activees</h2>
<p style="font-family:Arial,sans-serif;">Backlog enregistre comme baseline (<b>${total}</b>). Seuls les nouveaux problemes alerteront en detail.</p>
<ul style="font-family:Arial,sans-serif;">${rows.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>`;
  return { subject, text, html };
}

function buildDigest(
  alerts: PendingAlert[],
  byType: Record<AlertType, number>
): { subject: string; text: string; html: string } {
  const order: AlertType[] = ["CANCELLED", "REFUNDED", "DELAYED", "NOT_PURCHASED", "UNLINKED"];
  const parts: string[] = [];
  const subjParts: string[] = [];
  if (byType.CANCELLED) subjParts.push(`${byType.CANCELLED} annul`);
  if (byType.REFUNDED) subjParts.push(`${byType.REFUNDED} remb`);
  if (byType.DELAYED) subjParts.push(`${byType.DELAYED} retard`);
  if (byType.NOT_PURCHASED) subjParts.push(`${byType.NOT_PURCHASED} non-achat`);
  if (byType.UNLINKED) subjParts.push(`${byType.UNLINKED} non-lie`);
  const subject = `[Resell OPS] StockX: ${alerts.length} alerte(s) — ${subjParts.join(", ")}`;

  const lines: string[] = ["Alertes StockX (operateur d'abord):", ""];
  const htmlBlocks: string[] = [
    `<h2 style="font-family:Arial,sans-serif;">Alertes StockX</h2>`,
  ];

  for (const t of order) {
    const group = alerts.filter((a) => a.alertType === t);
    if (group.length === 0) continue;
    lines.push(`== ${TYPE_LABEL[t]} (${group.length}) ==`);
    htmlBlocks.push(
      `<h3 style="font-family:Arial,sans-serif;margin:16px 0 4px;">${TYPE_LABEL[t]} (${group.length})</h3><ul style="font-family:Arial,sans-serif;">`
    );
    for (const a of group) {
      const ref = a.orderRef ?? a.refKey;
      const chan = a.scope === "shopify" ? "Shopify" : "Galaxus";
      const stx = a.stockxOrderNumber ? ` · StockX ${a.stockxOrderNumber}` : "";
      const prod = a.productTitle ? ` · ${a.productTitle}` : "";
      const det = a.detail ? ` — ${a.detail}` : "";
      lines.push(`- [${chan}] ${ref}${stx}${prod}${det}`);
      htmlBlocks.push(
        `<li>[${chan}] <b>${escapeHtml(ref)}</b>${escapeHtml(stx)}${escapeHtml(prod)}${escapeHtml(det)}</li>`
      );
    }
    lines.push("");
    htmlBlocks.push("</ul>");
  }

  return {
    subject,
    text: lines.join("\n"),
    html: htmlBlocks.join("\n"),
  };
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
