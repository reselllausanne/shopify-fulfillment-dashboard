#!/usr/bin/env npx tsx
/**
 * StockX cancelled / OOS report (READ-ONLY).
 *
 * Scans recent Shopify orders that still have NO linked StockX purchase
 * (OrderMatch missing / no stockxOrderNumber) plus any stored needs_human
 * results from the last auto-batch, classifies WHY each was not bought, and
 * prints a grouped table so ops can tell:
 *
 *   TRUE OOS (save customer)       → reason `oos_no_ask` (page: "aucune demande")
 *   Buyable-but-missed             → `express_only` / `price_moved` (parser miss, still buyable)
 *   other                          → `negative_margin` / unknown
 *
 * Only `oos_no_ask` is safe to tell a customer "unavailable".
 *
 * Read-only: DB (Prisma) + the persisted needs_human payloads only.
 * No browser, no proxy, no StockX page loads, no buys.
 *
 * Run:  npx tsx scripts/stockx-oos-report.ts [--days=30]
 *
 * TODO(credit-email): wire the customer credit email for `oos_no_ask` rows —
 * refund + goodwill credit of max(10% of saleChf, 20 CHF). The emailable payload
 * is already produced by buildOosReportEmailable(); only the send step is pending.
 */
import "dotenv/config";

import { prisma } from "@/app/lib/prisma";
import { getStockxCheckoutState } from "@/lib/stockxCheckout";
import {
  defaultSinceDate,
  selectBuyCandidates,
  type ShopifyLineLoader,
} from "@/lib/stockxAutoCheckout/buyCandidates";

export type OosReportReason =
  | "oos_no_ask"
  | "too_expensive"
  | "buyable"
  | "express_only"
  | "negative_margin"
  | "price_moved"
  | "stale_data"
  | "no_variant_match"
  | "other";

export type OosReportGroup =
  | "true_oos"
  | "too_expensive"
  | "buyable"
  | "buyable_missed"
  | "other";

export type OosReportRow = {
  orderName: string;
  title: string;
  sizeEU: string;
  saleChf: number | null;
  reason: OosReportReason;
  lastSeen: string | null;
};

export type OosReportGroups = {
  true_oos: OosReportRow[];
  too_expensive: OosReportRow[];
  buyable: OosReportRow[];
  buyable_missed: OosReportRow[];
  other: OosReportRow[];
};

/** Map a raw needs_human / precheck reason (or anything) to a report reason bucket. */
export function normalizeOosReason(raw: string | null | undefined): OosReportReason {
  switch (String(raw || "").trim()) {
    case "oos_no_ask":
      return "oos_no_ask";
    case "too_expensive":
      return "too_expensive";
    case "buyable":
      return "buyable";
    case "express_only":
      return "express_only";
    case "margin":
    case "negative_margin":
      return "negative_margin";
    case "price_moved":
      return "price_moved";
    case "stale_data":
      return "stale_data";
    case "no_variant_match":
      return "no_variant_match";
    default:
      return "other";
  }
}

/** Which action group a report reason belongs to. */
export function groupForOosReason(reason: OosReportReason): OosReportGroup {
  if (reason === "oos_no_ask") return "true_oos";
  if (reason === "too_expensive") return "too_expensive";
  if (reason === "buyable") return "buyable";
  if (reason === "express_only" || reason === "price_moved") return "buyable_missed";
  return "other"; // negative_margin / stale_data / no_variant_match / other
}

export function groupOosRows(rows: OosReportRow[]): OosReportGroups {
  const groups: OosReportGroups = {
    true_oos: [],
    too_expensive: [],
    buyable: [],
    buyable_missed: [],
    other: [],
  };
  for (const row of rows) groups[groupForOosReason(row.reason)].push(row);
  return groups;
}

function chf(n: number | null): string {
  return n == null ? "—" : `${n.toFixed(2)}`;
}

function pad(s: string, w: number): string {
  const v = String(s ?? "");
  return v.length >= w ? v.slice(0, w) : v + " ".repeat(w - v.length);
}

/** Aligned fixed-width table for one set of rows. */
export function formatOosReportTable(rows: OosReportRow[]): string {
  if (!rows.length) return "  (none)";
  const header =
    "  " +
    pad("order", 8) +
    pad("title", 38) +
    pad("sizeEU", 10) +
    pad("saleChf", 10) +
    pad("reason", 16) +
    "lastSeen";
  const lines = rows.map(
    (r) =>
      "  " +
      pad(r.orderName, 8) +
      pad(r.title, 38) +
      pad(r.sizeEU, 10) +
      pad(chf(r.saleChf), 10) +
      pad(r.reason, 16) +
      (r.lastSeen || "—")
  );
  return [header, ...lines].join("\n");
}

/**
 * Emailable payload (used later for the customer credit email on TRUE OOS).
 * Pure + read-only — does NOT send anything. See TODO(credit-email) at top.
 */
export function buildOosReportEmailable(groups: OosReportGroups): {
  subject: string;
  text: string;
  creditCandidates: OosReportRow[];
} {
  const creditCandidates = groups.true_oos; // oos_no_ask only
  const subject = `[Resell] StockX OOS report — ${creditCandidates.length} true OOS, ${groups.buyable.length} buyable, ${groups.too_expensive.length} too-expensive`;
  const lines: string[] = [
    subject,
    `À: ${new Date().toISOString()}`,
    "",
    "TRUE OOS (save customer — credit candidates):",
    formatOosReportTable(groups.true_oos),
    "",
    "BUYABLE (DB says in stock + margin OK — buy these):",
    formatOosReportTable(groups.buyable),
    "",
    "TOO EXPENSIVE (margin below floor — skip, do NOT tell customer OOS):",
    formatOosReportTable(groups.too_expensive),
    "",
    "Buyable-but-missed (express_only / price_moved — re-buy, do NOT tell customer OOS):",
    formatOosReportTable(groups.buyable_missed),
    "",
    "Other (stale / no-variant-match / negative margin / unknown):",
    formatOosReportTable(groups.other),
    "",
    "TODO(credit-email): send +max(10%, 20 CHF) credit to the TRUE OOS customers above.",
  ];
  return { subject, text: lines.join("\n"), creditCandidates };
}

/** Rows from the last auto-batch's persisted needs_human payloads. */
export async function rowsFromStoredNeedsHuman(): Promise<OosReportRow[]> {
  const state = await getStockxCheckoutState();
  const batch = state.lastAutoBatch;
  if (!batch?.emailedItems?.length) return [];
  const lastSeen = batch.at ?? null;
  return batch.emailedItems.map((it) => ({
    orderName: it.orderName,
    title: it.title || it.orderName,
    sizeEU: it.sizeEU || "?",
    saleChf: it.saleChf ?? null,
    reason: normalizeOosReason(it.reason),
    lastSeen,
  }));
}

/**
 * Shopify orders with no linked StockX purchase, enriched with the DB pre-check
 * (title + sizeEU + reason). Read-only; `loadLine` is injected so the pure helpers
 * stay importable without Playwright. Excludes orders already in `knownOrderNames`.
 */
export async function rowsFromPrecheck(
  loadLine: ShopifyLineLoader,
  sinceDate: Date,
  knownOrderNames: Set<string>,
  now: Date = new Date(),
  maxCount = 500
): Promise<OosReportRow[]> {
  const { candidates } = await selectBuyCandidates({
    sinceDate,
    maxCount,
    loadLine,
    now,
    persist: true,
    force: true, // report must see oos_no_ask / too_expensive too
  });
  const rows: OosReportRow[] = [];
  for (const c of candidates) {
    if (knownOrderNames.has(c.orderName)) continue; // stored reason wins
    rows.push({
      orderName: c.orderName,
      title: c.title,
      sizeEU: c.sizeEU,
      saleChf: c.precheck.sellChf || null,
      reason: normalizeOosReason(c.precheck.status),
      lastSeen: c.orderDate ? c.orderDate.toISOString().slice(0, 10) : null,
    });
  }
  return rows;
}

/**
 * Fallback (no line loader): recent unmatched Shopify orders with unknown classify.
 * Used only when `buildOosReport` is called without a `loadLine` (e.g. pure tests).
 */
export async function rowsFromUnmatchedShopify(
  sinceDate: Date,
  knownOrderNames: Set<string>
): Promise<OosReportRow[]> {
  const orders = await prisma.shopifyOrder.findMany({
    where: { createdAt: { gte: sinceDate }, cancelledAt: null },
    select: {
      shopifyOrderId: true,
      orderName: true,
      createdAt: true,
      totalSalesChf: true,
      netSalesChf: true,
      refundedAmountChf: true,
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  if (!orders.length) return [];

  const names = orders.map((o) => o.orderName);
  const ids = orders.map((o) => o.shopifyOrderId);
  const matched = await prisma.orderMatch.findMany({
    where: {
      OR: [{ shopifyOrderName: { in: names } }, { shopifyOrderId: { in: ids } }],
      stockxOrderNumber: { not: "" },
    },
    select: { shopifyOrderName: true, shopifyOrderId: true },
  });
  const matchedNames = new Set(
    matched.map((m) => m.shopifyOrderName).filter(Boolean) as string[]
  );
  const matchedIds = new Set(
    matched.map((m) => m.shopifyOrderId).filter(Boolean) as string[]
  );

  const rows: OosReportRow[] = [];
  for (const o of orders) {
    if (matchedNames.has(o.orderName) || matchedIds.has(o.shopifyOrderId)) continue;
    if (knownOrderNames.has(o.orderName)) continue; // stored reason wins
    const gross = Number(o.totalSalesChf ?? 0);
    const refunded = Number(o.refundedAmountChf ?? 0);
    const net = o.netSalesChf != null ? Number(o.netSalesChf) : gross - refunded;
    if (!(net > 0)) continue;
    rows.push({
      orderName: o.orderName,
      title: o.orderName, // ShopifyOrder has no per-line title; unknown classify
      sizeEU: "?",
      saleChf: Number(net.toFixed(2)),
      reason: "other",
      lastSeen: o.createdAt ? o.createdAt.toISOString().slice(0, 10) : null,
    });
  }
  return rows;
}

export async function buildOosReport(opts?: {
  sinceDate?: Date;
  now?: Date;
  loadLine?: ShopifyLineLoader;
  maxCount?: number;
}): Promise<{ rows: OosReportRow[]; groups: OosReportGroups }> {
  const now = opts?.now ?? new Date();
  const sinceDate = opts?.sinceDate ?? defaultSinceDate(now);
  const stored = await rowsFromStoredNeedsHuman();
  const known = new Set(stored.map((r) => r.orderName));
  const scanned = opts?.loadLine
    ? await rowsFromPrecheck(opts.loadLine, sinceDate, known, now, opts?.maxCount)
    : await rowsFromUnmatchedShopify(sinceDate, known);
  const rows = [...stored, ...scanned];
  return { rows, groups: groupOosRows(rows) };
}

/** Optional `--since=YYYY-MM-DD` override; default = Oct 1 of the current year. */
function parseSinceArg(argv: string[], now: Date = new Date()): Date {
  const raw = argv.find((a) => a.startsWith("--since="));
  const val = raw ? raw.split("=")[1] : "";
  const d = val ? new Date(val) : null;
  return d && !Number.isNaN(d.getTime()) ? d : defaultSinceDate(now);
}

async function main(): Promise<void> {
  const now = new Date();
  const sinceDate = parseSinceArg(process.argv.slice(2), now);
  // Script run → enrich with precheck via the real Shopify line loader.
  const { loadShopifyLine } = await import("@/lib/stockxCheckout");
  const loadLine: ShopifyLineLoader = async (orderName) => {
    try {
      const l = await loadShopifyLine(orderName);
      return {
        sku: l.sku,
        gtin: l.gtin,
        sizeEU: l.sizeEU,
        title: l.title,
        saleChf: l.saleChf,
        shopifyLineItemId: l.shopifyLineItemId,
        deliveryMode: l.deliveryMode,
        deliveryModeLabel: l.deliveryModeLabel,
        shippingLineTitles: l.shippingLineTitles,
      };
    } catch {
      return null;
    }
  };

  const { rows, groups } = await buildOosReport({ sinceDate, now, loadLine });

  console.info(
    `\nStockX OOS report — since ${sinceDate.toISOString().slice(0, 10)}, ${rows.length} rows\n`
  );

  console.info("TRUE OOS (save customer — credit candidates):");
  console.info(formatOosReportTable(groups.true_oos));
  console.info("");
  console.info("BUYABLE (buy these):");
  console.info(formatOosReportTable(groups.buyable));
  console.info("");
  console.info("TOO EXPENSIVE (margin below floor — skip, NOT OOS):");
  console.info(formatOosReportTable(groups.too_expensive));
  console.info("");
  console.info("Buyable-but-missed (express_only / price_moved — re-buy, NOT OOS):");
  console.info(formatOosReportTable(groups.buyable_missed));
  console.info("");
  console.info("Other (stale / no-variant-match / negative margin / unknown):");
  console.info(formatOosReportTable(groups.other));
  console.info("");
  console.info(
    `Summary: true_oos=${groups.true_oos.length} ` +
      `buyable=${groups.buyable.length} ` +
      `too_expensive=${groups.too_expensive.length} ` +
      `buyable_missed=${groups.buyable_missed.length} ` +
      `other=${groups.other.length} total=${rows.length}`
  );

  // Emailable payload is built (not sent). See TODO(credit-email) at top.
  const emailable = buildOosReportEmailable(groups);
  console.info(
    `\n(emailable ready: "${emailable.subject}" — ${emailable.creditCandidates.length} credit candidates; send pending)`
  );
}

// Run only when invoked directly (so vitest can import the pure helpers).
const invokedDirectly =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  /stockx-oos-report\.ts$/.test(process.argv[1] ?? "");

if (invokedDirectly) {
  main()
    .then(async () => {
      await prisma.$disconnect().catch(() => undefined);
      process.exit(0);
    })
    .catch(async (e) => {
      console.error("[stockx-oos-report] failed:", e?.message || e);
      await prisma.$disconnect().catch(() => undefined);
      process.exit(1);
    });
}
