/**
 * Read-only "would-move" preview from Merchant Price Competitiveness.
 * Never writes prices to Shopify / Merchant / Ads / feeds.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { Prisma } from "@prisma/client";

import { resolveMerchantId } from "@/adsanalytics/config";
import { stringifySafe } from "@/adsanalytics/json";
import {
  createMerchantPricingClient,
  mergePricingSignals,
} from "@/adsanalytics/merchant/pricingClient";
import type { MerchantPricingSignal } from "@/adsanalytics/merchant/pricingTypes";
import { log, withSyncRun } from "@/adsanalytics/run";
import { prisma } from "@/app/lib/prisma";

export type WouldMoveOptions = {
  account?: string;
  country?: string;
  limit?: number;
  /** Absolute gap % vs CH benchmark before we call it a move candidate. */
  thresholdPercent?: number;
  examples?: number;
};

export type MoveAction = "would_lower" | "would_raise" | "hold";

export type WouldMoveExample = {
  action: MoveAction;
  why: string;
  title: string | null;
  brand: string | null;
  offerId: string | null;
  currentPriceChf: number | null;
  benchmarkPriceChf: number | null;
  hypotheticalTargetChf: number | null;
  gapAmountChf: number | null;
  gapPercent: number | null;
  adsImpressions30d: number | null;
  adsClicks30d: number | null;
  adsCostChf30d: number | null;
};

function round2(n: number | null): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function classify(gapPercent: number | null, threshold: number): MoveAction {
  if (gapPercent == null) return "hold";
  if (gapPercent >= threshold) return "would_lower";
  if (gapPercent <= -threshold) return "would_raise";
  return "hold";
}

function whyText(
  action: MoveAction,
  gapPercent: number | null,
  gapAmount: number | null,
  threshold: number
): string {
  const pct = gapPercent == null ? "?" : `${gapPercent >= 0 ? "+" : ""}${gapPercent.toFixed(1)}%`;
  const amt = gapAmount == null ? "?" : `${gapAmount >= 0 ? "+" : ""}${gapAmount.toFixed(2)} CHF`;
  if (action === "would_lower") {
    return `Current list ${pct} / ${amt} above CH Google benchmark (≥${threshold}% band). Hypothetical move: closer to benchmark to regain Shopping competitiveness. No write performed.`;
  }
  if (action === "would_raise") {
    return `Current list ${pct} / ${amt} below CH Google benchmark (≤-${threshold}% band). Hypothetical move: raise toward benchmark (leave money on table). No write performed.`;
  }
  return `Within ±${threshold}% of CH benchmark (${pct}). Hypothetical: hold. No write performed.`;
}

async function loadAds30d(offerIds: string[]): Promise<
  Map<string, { impressions: number; clicks: number; costChf: number }>
> {
  const lowered = Array.from(new Set(offerIds.map((o) => o.trim().toLowerCase()).filter(Boolean)));
  const out = new Map<string, { impressions: number; clicks: number; costChf: number }>();
  if (lowered.length === 0) return out;

  const rows = await prisma.$queryRaw<
    Array<{ offer_id: string; impressions: number; clicks: number; cost_micros: number }>
  >(Prisma.sql`
    SELECT
      LOWER("offer_id") AS offer_id,
      COALESCE(SUM("impressions"), 0)::float AS impressions,
      COALESCE(SUM("clicks"), 0)::float AS clicks,
      COALESCE(SUM("cost_micros"), 0)::float AS cost_micros
    FROM "public"."ads_product_daily"
    WHERE "date" >= (CURRENT_DATE - INTERVAL '30 days')
      AND LOWER("offer_id") IN (${Prisma.join(lowered)})
    GROUP BY LOWER("offer_id")
  `);

  for (const row of rows) {
    out.set(row.offer_id, {
      impressions: row.impressions,
      clicks: row.clicks,
      costChf: row.cost_micros / 1_000_000,
    });
  }
  return out;
}

function toExample(
  signal: MerchantPricingSignal,
  threshold: number,
  ads: Map<string, { impressions: number; clicks: number; costChf: number }>
): WouldMoveExample {
  const action = classify(signal.benchmarkGapPercent, threshold);
  const adsRow = signal.offerId ? ads.get(signal.offerId.toLowerCase()) : undefined;
  return {
    action,
    why: whyText(action, signal.benchmarkGapPercent, signal.benchmarkGapAmount, threshold),
    title: signal.title,
    brand: signal.brand,
    offerId: signal.offerId,
    currentPriceChf: round2(signal.currentPrice),
    benchmarkPriceChf: round2(signal.benchmarkPrice),
    hypotheticalTargetChf: round2(signal.benchmarkPrice),
    gapAmountChf: round2(signal.benchmarkGapAmount),
    gapPercent: round2(signal.benchmarkGapPercent),
    adsImpressions30d: adsRow ? Math.round(adsRow.impressions) : null,
    adsClicks30d: adsRow ? Math.round(adsRow.clicks) : null,
    adsCostChf30d: adsRow ? round2(adsRow.costChf) : null,
  };
}

function pickExamples(all: WouldMoveExample[], n: number): {
  wouldLower: WouldMoveExample[];
  wouldRaise: WouldMoveExample[];
  hold: WouldMoveExample[];
} {
  const byImpact = (a: WouldMoveExample, b: WouldMoveExample) =>
    Math.abs(b.gapPercent ?? 0) - Math.abs(a.gapPercent ?? 0) ||
    (b.adsImpressions30d ?? 0) - (a.adsImpressions30d ?? 0);

  const lower = all.filter((e) => e.action === "would_lower").sort(byImpact).slice(0, n);
  const raise = all.filter((e) => e.action === "would_raise").sort(byImpact).slice(0, n);
  const hold = all.filter((e) => e.action === "hold").sort(byImpact).slice(0, Math.min(3, n));
  return { wouldLower: lower, wouldRaise: raise, hold };
}

function printExample(label: string, e: WouldMoveExample): void {
  console.info("");
  console.info(`[${label}] ${e.title ?? "(no title)"}`);
  console.info(`  brand=${e.brand ?? "?"} offer=${e.offerId ?? "?"}`);
  console.info(
    `  current=${e.currentPriceChf} CHF  benchmark=${e.benchmarkPriceChf} CHF  gap=${e.gapPercent}% (${e.gapAmountChf} CHF)`
  );
  console.info(
    `  hypothetical target (benchmark only)=${e.hypotheticalTargetChf} CHF  | ads30d: imp=${e.adsImpressions30d ?? "—"} clk=${e.adsClicks30d ?? "—"} cost=${e.adsCostChf30d ?? "—"} CHF`
  );
  console.info(`  why: ${e.why}`);
}

export async function merchantPricingWouldMoveCommand(
  options: WouldMoveOptions = {}
): Promise<number> {
  const account = resolveMerchantId(options.account);
  const country = (options.country ?? "CH").trim().toUpperCase() || "CH";
  const limit = Math.max(1, Math.min(options.limit ?? 200, 1000));
  const threshold = Math.max(1, options.thresholdPercent ?? 10);
  const exampleN = Math.max(1, Math.min(options.examples ?? 5, 20));

  return withSyncRun(
    "merchant:pricing-would-move",
    { account, country, limit, threshold, exampleN, readOnly: true, mutatePrices: false },
    async () => {
      const client = createMerchantPricingClient(account);
      const connection = await client.testConnection();
      if (!connection.ok) {
        throw new Error(`Merchant connection failed: ${connection.status} ${connection.detail ?? ""}`);
      }

      const competitiveness = await client.getPriceCompetitiveness({
        countryCode: country,
        limit,
      });
      const insights = await client.getPriceInsights({ countryCode: country, limit });
      const signals = mergePricingSignals(
        competitiveness.rows,
        insights.rows,
        country,
        new Date()
      ).filter((s) => s.benchmarkPrice != null && s.currentPrice != null);

      const ads = await loadAds30d(signals.map((s) => s.offerId ?? "").filter(Boolean));
      const classified = signals.map((s) => toExample(s, threshold, ads));
      const counts = {
        would_lower: classified.filter((c) => c.action === "would_lower").length,
        would_raise: classified.filter((c) => c.action === "would_raise").length,
        hold: classified.filter((c) => c.action === "hold").length,
      };
      const examples = pickExamples(classified, exampleN);

      const report = {
        timestamp: new Date().toISOString(),
        merchantCenterAccountId: account,
        country,
        sampledProducts: signals.length,
        thresholdPercent: threshold,
        mutatePrices: false,
        externalMutations: false,
        note: "Hypothetical only. Benchmark used as illustrative target — not a live pricing model, fees/margin not applied.",
        counts,
        examples,
      };

      const outDir = path.join(process.cwd(), "tmp");
      await mkdir(outDir, { recursive: true });
      const outPath = path.join(outDir, "merchant-pricing-would-move.json");
      await writeFile(outPath, stringifySafe(report), "utf8");

      console.info("");
      console.info("=== READ-ONLY would-move preview (no prices changed) ===");
      console.info(`Sample: ${signals.length} CH products with benchmark | threshold ±${threshold}%`);
      console.info(
        `Counts: would_lower=${counts.would_lower} would_raise=${counts.would_raise} hold=${counts.hold}`
      );

      for (const e of examples.wouldLower) printExample("WOULD LOWER", e);
      for (const e of examples.wouldRaise) printExample("WOULD RAISE", e);
      for (const e of examples.hold) printExample("HOLD", e);

      console.info("");
      console.info("No Shopify / Merchant / Ads / feed prices modified.");
      console.info(`Report: ${outPath}`);

      log("merchant_pricing_would_move.summary", {
        account,
        country,
        sampled: signals.length,
        ...counts,
        reportPath: outPath,
        mutatePrices: false,
      });

      return { ...counts, sampled: signals.length, reportPath: outPath, mutatePrices: false };
    }
  );
}
