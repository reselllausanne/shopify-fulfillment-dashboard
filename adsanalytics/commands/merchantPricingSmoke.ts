/**
 * Read-only Merchant Center pricing smoke test.
 *
 * Verifies Price Competitiveness + Price Insights exposure and joins offer IDs
 * against ads_product_daily. Never mutates Merchant, Ads, Shopify, or feed data.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { Prisma } from "@prisma/client";

import { AdsConfigError, resolveMerchantId } from "@/adsanalytics/config";
import {
  createMerchantPricingClient,
  mergePricingSignals,
} from "@/adsanalytics/merchant/pricingClient";
import { coverageRate } from "@/adsanalytics/merchant/pricingNormalize";
import type { MerchantPricingSignal, MerchantQueryStatus } from "@/adsanalytics/merchant/pricingTypes";
import { stringifySafe } from "@/adsanalytics/json";
import { EXIT_CONFIG_MISSING, EXIT_FAILED, EXIT_OK, log, withSyncRun } from "@/adsanalytics/run";
import { prisma } from "@/app/lib/prisma";

export type MerchantPricingSmokeOptions = {
  account?: string;
  country?: string;
  limit?: number;
};

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function statusLabel(status: MerchantQueryStatus, count: number, limit: number): string {
  if (status === "ok") return `${count}/${limit} products`;
  if (status === "empty") return `0/${limit} products (empty — not an auth failure)`;
  return status;
}

async function joinAdsProductDaily(offerIds: string[]): Promise<Set<string>> {
  const unique = Array.from(new Set(offerIds.map((o) => o.trim()).filter(Boolean)));
  if (unique.length === 0) return new Set();

  // Ads stores product_item_id / offer_id lowercased (shopify_ch_...); Merchant often returns shopify_CH_...
  const lowered = unique.map((o) => o.toLowerCase());
  const rows = await prisma.$queryRaw<Array<{ offer_id: string }>>(Prisma.sql`
    SELECT DISTINCT "offer_id"
    FROM "public"."ads_product_daily"
    WHERE LOWER("offer_id") IN (${Prisma.join(lowered)})
  `);
  return new Set(rows.map((r) => r.offer_id.toLowerCase()));
}

function sanitizeExample(signal: MerchantPricingSignal): Record<string, unknown> {
  return {
    merchantProductId: signal.merchantProductId,
    offerId: signal.offerId,
    title: signal.title ? signal.title.slice(0, 80) : null,
    brand: signal.brand,
    countryCode: signal.countryCode,
    currentPrice: signal.currentPrice,
    currency: signal.currency,
    benchmarkPrice: signal.benchmarkPrice,
    benchmarkGapAmount:
      signal.benchmarkGapAmount == null ? null : Number(signal.benchmarkGapAmount.toFixed(4)),
    benchmarkGapPercent:
      signal.benchmarkGapPercent == null ? null : Number(signal.benchmarkGapPercent.toFixed(2)),
    suggestedPrice: signal.suggestedPrice,
    predictedImpressionsChange: signal.predictedImpressionsChange,
    predictedClicksChange: signal.predictedClicksChange,
    predictedConversionsChange: signal.predictedConversionsChange,
    capturedAt: signal.capturedAt.toISOString(),
  };
}

function nextAction(args: {
  connectionOk: boolean;
  connectionStatus: MerchantQueryStatus;
  contentScopePresent: boolean | null;
  competitivenessStatus: MerchantQueryStatus;
  insightsStatus: MerchantQueryStatus;
  joined: number;
  signals: number;
}): string {
  if (!args.connectionOk) {
    if (args.connectionStatus === "scope_insufficient" || args.contentScopePresent === false) {
      return (
        "Missing Merchant content scope. Run: npm run ads -- merchant:auth:url " +
        "then npm run ads -- merchant:auth:exchange --code=<code> --write-env " +
        "(or npm run ads -- auth:oauth for combined Ads+Merchant grant). " +
        "Populate GOOGLE_MERCHANT_REFRESH_TOKEN. Do not commit the token."
      );
    }
    if (args.connectionStatus === "auth_failed") {
      return (
        "Merchant refresh token rejected. Re-consent: npm run ads -- merchant:auth:url " +
        "→ npm run ads -- merchant:auth:exchange --code=<code> --write-env"
      );
    }
    if (args.connectionStatus === "api_not_enabled") {
      return "Enable Merchant API for the GCP project linked to GOOGLE_ADS_CLIENT_ID, then retry.";
    }
    if (args.connectionStatus === "permission_denied") {
      return "Grant the OAuth user Admin/Standard access to Merchant Center account 669442699, then retry.";
    }
    return "Fix Merchant OAuth / account access, then re-run npm run merchant:pricing-smoke";
  }
  if (
    args.competitivenessStatus === "market_insights_unavailable" ||
    args.insightsStatus === "market_insights_unavailable"
  ) {
    return (
      "Market Insights not eligible for this account/country yet. " +
      "Confirm Price competitiveness / Price insights in Merchant Center UI for CH. Empty or unavailable is expected until eligibility."
    );
  }
  if (args.signals === 0) {
    return (
      "API reachable but both pricing reports empty. Check GTIN coverage and Market Insights eligibility in Merchant Center (CH). No code change required for empty data."
    );
  }
  if (args.joined === 0) {
    return (
      "Pricing rows returned but none joined to ads_product_daily.offer_id. " +
      "Verify offer_id format alignment with Google Ads product_item_id / inventory sync."
    );
  }
  return "Smoke test passed. Safe to design the next read-only pricing signal ingest step (still no writes).";
}

export async function merchantPricingSmokeCommand(
  options: MerchantPricingSmokeOptions = {}
): Promise<number> {
  const account = resolveMerchantId(options.account);
  const country = (options.country ?? "CH").trim().toUpperCase() || "CH";
  const limit = Math.max(1, Math.min(options.limit ?? 50, 500));

  return withSyncRun(
    "merchant:pricing-smoke",
    { account, country, limit, readOnly: true },
    async () => {
      const warnings: string[] = [];
      const client = createMerchantPricingClient(account);

      const connection = await client.testConnection();
      if (connection.contentScopePresent === false) {
        warnings.push("OAuth token missing https://www.googleapis.com/auth/content");
      }
      if (!connection.ok) {
        warnings.push(`Connection failed: ${connection.status}${connection.detail ? ` (${connection.detail})` : ""}`);
      }

      const competitiveness = connection.ok
        ? await client.getPriceCompetitiveness({ countryCode: country, limit })
        : {
            status: connection.status,
            rows: [],
            detail: "skipped — connection failed",
            httpStatus: null,
          };

      const insights = connection.ok
        ? await client.getPriceInsights({ countryCode: country, limit })
        : {
            status: connection.status,
            rows: [],
            detail: "skipped — connection failed",
            httpStatus: null,
          };

      if (competitiveness.status === "empty") {
        warnings.push(
          "Price Competitiveness empty: often means no CH benchmark rows yet, insufficient GTIN matches, or Market Insights not populated — not automatically an auth failure."
        );
      }
      if (insights.status === "empty") {
        warnings.push(
          "Price Insights empty: Google may have no suggested-price predictions for this catalog slice; eligibility/GTIN coverage still required."
        );
      }
      if (competitiveness.status === "market_insights_unavailable") {
        warnings.push("Price Competitiveness: Market Insights unavailable for this account/query.");
      }
      if (insights.status === "market_insights_unavailable") {
        warnings.push("Price Insights: Market Insights unavailable for this account/query.");
      }

      const capturedAt = new Date();
      const signals = mergePricingSignals(
        competitiveness.rows,
        insights.rows,
        country,
        capturedAt
      );

      const offerIds = signals
        .map((s) => s.offerId)
        .filter((o): o is string => Boolean(o && o.trim()));

      let joinedOfferIds = new Set<string>();
      let adsJoinError: string | null = null;
      try {
        joinedOfferIds = await joinAdsProductDaily(offerIds);
      } catch (err) {
        adsJoinError = (err instanceof Error ? err.message : String(err)).slice(0, 300);
        warnings.push(`ads_product_daily join failed: ${adsJoinError}`);
      }

      const joinedCount = signals.filter(
        (s) => s.offerId && joinedOfferIds.has(s.offerId.toLowerCase())
      ).length;
      const withBenchmark = signals.filter((s) => s.benchmarkPrice != null).length;
      const withSuggested = signals.filter((s) => s.suggestedPrice != null).length;
      const benchmarkCoverage = coverageRate(withBenchmark, signals.length);
      const suggestedCoverage = coverageRate(withSuggested, signals.length);
      const adsJoinRate = coverageRate(joinedCount, signals.length);

      const action = nextAction({
        connectionOk: connection.ok,
        connectionStatus: connection.status,
        contentScopePresent: connection.contentScopePresent,
        competitivenessStatus: competitiveness.status,
        insightsStatus: insights.status,
        joined: joinedCount,
        signals: signals.length,
      });

      const report = {
        timestamp: capturedAt.toISOString(),
        merchantCenterAccountId: account,
        country,
        limit,
        readOnly: true,
        externalMutations: false,
        connection: {
          status: connection.status,
          ok: connection.ok,
          accountAccessible: connection.accountAccessible,
          accessTokenObtained: connection.accessTokenObtained,
          contentScopePresent: connection.contentScopePresent,
          tokenScopes: connection.tokenScopes,
          detail: connection.detail,
        },
        oauthScopeStatus:
          connection.contentScopePresent === true
            ? "content_scope_present"
            : connection.contentScopePresent === false
              ? "content_scope_missing"
              : "scope_check_unavailable",
        priceCompetitiveness: {
          status: competitiveness.status,
          rowCount: competitiveness.rows.length,
          detail: competitiveness.detail,
          httpStatus: competitiveness.httpStatus,
        },
        priceInsights: {
          status: insights.status,
          rowCount: insights.rows.length,
          detail: insights.detail,
          httpStatus: insights.httpStatus,
        },
        returnedRows: signals.length,
        benchmarkCoverageRate: benchmarkCoverage,
        suggestedPriceCoverageRate: suggestedCoverage,
        adsProductDailyJoin: {
          attempted: offerIds.length,
          matched: joinedCount,
          matchRate: adsJoinRate,
          error: adsJoinError,
        },
        examples: signals.slice(0, 10).map(sanitizeExample),
        warnings,
        nextAction: action,
        note: "No Shopify / Merchant Center / Ads / Galaxus / Decathlon / StockX mutations performed.",
      };

      const outDir = path.join(process.cwd(), "tmp");
      await mkdir(outDir, { recursive: true });
      const outPath = path.join(outDir, "merchant-pricing-smoke.json");
      await writeFile(outPath, stringifySafe(report), "utf8");

      console.info("");
      console.info(`Merchant Center connection: ${connection.ok ? "OK" : "FAIL"}`);
      console.info(`Account access: ${connection.accountAccessible ? "OK" : "FAIL"}`);
      console.info(
        `Price Competitiveness: ${statusLabel(competitiveness.status, competitiveness.rows.length, limit)}`
      );
      console.info(`Price Insights: ${statusLabel(insights.status, insights.rows.length, limit)}`);
      console.info(`Ads product join: ${joinedCount}/${signals.length || 0}`);
      console.info(`Benchmark coverage: ${pct(benchmarkCoverage)}`);
      console.info("No external mutations performed.");
      console.info(`Report: ${outPath}`);
      console.info(`Next: ${action}`);

      log("merchant_pricing_smoke.summary", {
        account,
        country,
        connectionOk: connection.ok,
        contentScopePresent: connection.contentScopePresent,
        competitivenessStatus: competitiveness.status,
        competitivenessRows: competitiveness.rows.length,
        insightsStatus: insights.status,
        insightsRows: insights.rows.length,
        signals: signals.length,
        adsJoined: joinedCount,
        benchmarkCoverage: Number(benchmarkCoverage.toFixed(4)),
        suggestedCoverage: Number(suggestedCoverage.toFixed(4)),
        reportPath: outPath,
        nextAction: action,
      });

      if (!connection.ok) {
        // Config/auth issues should stop cleanly with non-zero exit.
        if (connection.status === "auth_failed" || connection.status === "scope_insufficient") {
          throw new AdsConfigError(
            connection.status === "scope_insufficient"
              ? ["GOOGLE_MERCHANT_REFRESH_TOKEN (content scope)"]
              : ["GOOGLE_MERCHANT_REFRESH_TOKEN"]
          );
        }
        throw new Error(`Merchant pricing smoke connection failed: ${connection.status}`);
      }

      return {
        reportPath: outPath,
        connectionOk: connection.ok,
        competitivenessRows: competitiveness.rows.length,
        insightsRows: insights.rows.length,
        adsJoined: joinedCount,
        benchmarkCoverage,
        suggestedCoverage,
        externalMutations: false,
      };
    },
    { persist: true }
  );
}

/** Direct entry for `npm run merchant:pricing-smoke` without ads-analytics router. */
export async function runMerchantPricingSmokeCli(argv: string[]): Promise<number> {
  const get = (name: string): string | undefined => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : undefined;
  };
  const limitRaw = get("limit");
  const limit = limitRaw ? Number(limitRaw) : 50;
  try {
    return await merchantPricingSmokeCommand({
      account: get("account"),
      country: get("country") ?? "CH",
      limit: Number.isFinite(limit) ? limit : 50,
    });
  } catch (err) {
    if (err instanceof AdsConfigError) {
      console.error(
        `Missing config: ${err.missing.join(", ")}. ` +
          `Run: npm run ads -- merchant:auth:url then npm run ads -- merchant:auth:exchange --code=<code> --write-env`
      );
      return EXIT_CONFIG_MISSING;
    }
    console.error(err instanceof Error ? err.message : String(err));
    return EXIT_FAILED;
  }
}

export { EXIT_OK };
