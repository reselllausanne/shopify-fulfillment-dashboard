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

export type OosReportReason =
  | "oos_no_ask"
  | "express_only"
  | "negative_margin"
  | "price_moved"
  | "other";

export type OosReportGroup = "true_oos" | "buyable_missed" | "other";

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
  buyable_missed: OosReportRow[];
  other: OosReportRow[];
};

/** Map a raw needs_human reason (or anything) to a report reason bucket. */
export function normalizeOosReason(raw: string | null | undefined): OosReportReason {
  switch (String(raw || "").trim()) {
    case "oos_no_ask":
      return "oos_no_ask";
    case "express_only":
      return "express_only";
    case "margin":
    case "negative_margin":
      return "negative_margin";
    case "price_moved":
      return "price_moved";
    default:
      return "other";
  }
}

/** Which action group a report reason belongs to. */
export function groupForOosReason(reason: OosReportReason): OosReportGroup {
  if (reason === "oos_no_ask") return "true_oos";
  if (reason === "express_only" || reason === "price_moved") return "buyable_missed";
  return "other";
}

export function groupOosRows(rows: OosReportRow[]): OosReportGroups {
  const groups: OosReportGroups = { true_oos: [], buyable_missed: [], other: [] };
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
  const subject = `[Resell] StockX OOS report — ${creditCandidates.length} true OOS, ${groups.buyable_missed.length} buyable-missed`;
  const lines: string[] = [
    subject,
    `À: ${new Date().toISOString()}`,
    "",
    "TRUE OOS (save customer — credit candidates):",
    formatOosReportTable(groups.true_oos),
    "",
    "Buyable-but-missed (express_only / price_moved — re-buy, do NOT tell customer OOS):",
    formatOosReportTable(groups.buyable_missed),
    "",
    "Other (negative margin / unknown):",
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
 * Recent Shopify orders with no linked StockX purchase yet.
 * Read-only. Excludes cancelled and ones already present in `knownOrderNames`
 * (those already have a richer stored reason).
 */
export async function rowsFromUnmatchedShopify(
  days: number,
  knownOrderNames: Set<string>,
  now: Date = new Date()
): Promise<OosReportRow[]> {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const orders = await prisma.shopifyOrder.findMany({
    where: { createdAt: { gte: since }, cancelledAt: null },
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
  days?: number;
  now?: Date;
}): Promise<{ rows: OosReportRow[]; groups: OosReportGroups }> {
  const days = opts?.days ?? 30;
  const stored = await rowsFromStoredNeedsHuman();
  const known = new Set(stored.map((r) => r.orderName));
  const unmatched = await rowsFromUnmatchedShopify(days, known, opts?.now);
  const rows = [...stored, ...unmatched];
  return { rows, groups: groupOosRows(rows) };
}

function parseDaysArg(argv: string[]): number {
  const raw = argv.find((a) => a.startsWith("--days="));
  const n = raw ? Number(raw.split("=")[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 30;
}

async function main(): Promise<void> {
  const days = parseDaysArg(process.argv.slice(2));
  const { rows, groups } = await buildOosReport({ days });

  console.info(`\nStockX OOS report — last ${days}d, ${rows.length} unmatched rows\n`);

  console.info("TRUE OOS (save customer — credit candidates):");
  console.info(formatOosReportTable(groups.true_oos));
  console.info("");
  console.info("Buyable-but-missed (express_only / price_moved — re-buy, NOT OOS):");
  console.info(formatOosReportTable(groups.buyable_missed));
  console.info("");
  console.info("Other (negative margin / unknown):");
  console.info(formatOosReportTable(groups.other));
  console.info("");
  console.info(
    `Summary: true_oos=${groups.true_oos.length} ` +
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
