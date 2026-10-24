#!/usr/bin/env npx tsx
/**
 * StockX daily buy plan (READ-ONLY, DB-only — NO browser, NO proxy, NO buys).
 *
 * Prints the ranked "what can I buy on StockX right now" view: oldest order first,
 * customer-Express first, within an optional --budget=CHF. Each row is the DB
 * pre-check verdict (SupplierVariant: stock + lane price + margin + freshness).
 *
 * This opens NOTHING on StockX — it only reads Shopify order lines + the
 * KickDB-SSE-fed SupplierVariant rows already in Postgres. Verdicts are persisted to
 * PrecheckResult so the next run skips known-unbuyable items (oos_no_ask /
 * too_expensive) without recompute.
 *
 * Run:
 *   npx tsx scripts/stockx-buy-plan.ts [--budget=1000] [--since=YYYY-MM-DD] [--max=100] [--force]
 */
import "dotenv/config";

import { prisma } from "@/app/lib/prisma";
import {
  defaultSinceDate,
  selectBuyCandidates,
  type BuyCandidate,
  type ShopifyLineLoader,
} from "@/lib/stockxAutoCheckout/buyCandidates";
import { loadShopifyLine } from "@/lib/stockxCheckout";

type Args = {
  budgetChf?: number;
  sinceDate: Date;
  maxCount: number;
  force: boolean;
};

function parseArgs(argv: string[], now: Date = new Date()): Args {
  const num = (prefix: string): number | undefined => {
    const raw = argv.find((a) => a.startsWith(prefix));
    if (!raw) return undefined;
    const n = Number(raw.split("=")[1]);
    return Number.isFinite(n) ? n : undefined;
  };
  const sinceRaw = argv.find((a) => a.startsWith("--since="))?.split("=")[1] ?? "";
  const sinceParsed = sinceRaw ? new Date(sinceRaw) : null;
  return {
    budgetChf: num("--budget="),
    sinceDate:
      sinceParsed && !Number.isNaN(sinceParsed.getTime()) ? sinceParsed : defaultSinceDate(now),
    maxCount: num("--max=") ?? 100,
    force: argv.includes("--force"),
  };
}

function chf(n: number | null | undefined): string {
  return n == null ? "—" : n.toFixed(2);
}

function pct(n: number | null | undefined): string {
  return n == null ? "—" : `${(n * 100).toFixed(1)}%`;
}

function pad(s: string, w: number): string {
  const v = String(s ?? "");
  return v.length >= w ? v.slice(0, w) : v + " ".repeat(w - v.length);
}

function padLeft(s: string, w: number): string {
  const v = String(s ?? "");
  return v.length >= w ? v.slice(0, w) : " ".repeat(w - v.length) + v;
}

export function formatBuyPlanTable(rows: BuyCandidate[]): string {
  const header =
    pad("order", 8) +
    pad("title", 34) +
    pad("size", 9) +
    pad("lane", 9) +
    padLeft("sell", 9) +
    " " +
    padLeft("buy", 9) +
    " " +
    padLeft("margin", 8) +
    "  " +
    "status";
  if (!rows.length) return header + "\n  (none)";
  const lines = rows.map((c) => {
    const p = c.precheck;
    return (
      pad(c.express ? `${c.orderName}*` : c.orderName, 8) +
      pad(c.title, 34) +
      pad(c.sizeEU, 9) +
      pad(p.lane, 9) +
      padLeft(chf(p.sellChf), 9) +
      " " +
      padLeft(chf(p.expectedBuyChf), 9) +
      " " +
      padLeft(pct(p.marginPct), 8) +
      "  " +
      p.status
    );
  });
  return [header, ...lines].join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

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

  const result = await selectBuyCandidates({
    sinceDate: args.sinceDate,
    maxCount: args.maxCount,
    budgetChf: args.budgetChf,
    loadLine,
    force: args.force,
    persist: true,
  });

  console.info(
    `\nStockX buy plan — since ${args.sinceDate.toISOString().slice(0, 10)}` +
      (args.budgetChf != null ? `, budget ${chf(args.budgetChf)} CHF` : "") +
      ` (* = customer Express)\n`
  );

  console.info("ALL CANDIDATES (ranked: Express first, then oldest):");
  console.info(formatBuyPlanTable(result.candidates));
  console.info("");

  console.info(
    args.budgetChf != null ? `SELECTED TO BUY (within budget):` : `SELECTED TO BUY (buyable):`
  );
  console.info(formatBuyPlanTable(result.selected));
  console.info("");

  const byStatus = result.candidates.reduce<Record<string, number>>((acc, c) => {
    acc[c.precheck.status] = (acc[c.precheck.status] ?? 0) + 1;
    return acc;
  }, {});
  console.info(
    `Summary: ${result.candidates.length} evaluated, ${result.selected.length} selected, ` +
      `total buy ${chf(result.totalBuyChf)} CHF, ` +
      `skipped-known-unbuyable ${result.skippedKnownUnbuyable} | ` +
      Object.entries(byStatus)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ")
  );
  console.info("\nNOTE: read-only plan. No StockX page was opened and no buy was placed.");
}

// Run only when invoked directly (so vitest can import the pure helpers).
const invokedDirectly =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  /stockx-buy-plan\.ts$/.test(process.argv[1] ?? "");

if (invokedDirectly) {
  main()
    .then(async () => {
      await prisma.$disconnect().catch(() => undefined);
      process.exit(0);
    })
    .catch(async (e) => {
      console.error("[stockx-buy-plan] failed:", e?.message || e);
      await prisma.$disconnect().catch(() => undefined);
      process.exit(1);
    });
}
