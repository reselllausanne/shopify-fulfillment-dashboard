import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveAdsConfig } from "@/adsanalytics/config";
import { rangeForDays } from "@/adsanalytics/dates";
import { searchRows } from "@/adsanalytics/google/adsClient";
import { productDailyQuery } from "@/adsanalytics/google/queries";
import { stringifySafe, toJsonSafe } from "@/adsanalytics/json";
import { log, withSyncRun } from "@/adsanalytics/run";
import {
  CUSTOM_ATTR_KEYS,
  ProductAggregator,
  describeOfferIdShape,
  mapProductRow,
  parseOfferId,
} from "@/adsanalytics/transform";

/** Probe-only row cap. Backfill follows nextPageToken with no row limit. */
const SAMPLE_SIZE = 100;
const DEFAULT_MAX_ROWS = 100_000;

type MetricBucket = {
  rows: number;
  impressions: number;
  clicks: number;
  costMicros: number;
  conversions: number;
  conversionValue: number;
};

function emptyMetrics(): MetricBucket {
  return {
    rows: 0,
    impressions: 0,
    clicks: 0,
    costMicros: 0,
    conversions: 0,
    conversionValue: 0,
  };
}

function addMetrics(bucket: MetricBucket, row: {
  impressions: bigint;
  clicks: bigint;
  costMicros: bigint;
  conversions: number;
  conversionValue: number;
}): void {
  bucket.rows += 1;
  bucket.impressions += Number(row.impressions);
  bucket.clicks += Number(row.clicks);
  bucket.costMicros += Number(row.costMicros);
  bucket.conversions += row.conversions;
  bucket.conversionValue += row.conversionValue;
}

function shapeMetrics(bucket: MetricBucket) {
  return {
    rows: bucket.rows,
    impressions: bucket.impressions,
    clicks: bucket.clicks,
    costChf: Number((bucket.costMicros / 1e6).toFixed(2)),
    conversions: Number(bucket.conversions.toFixed(2)),
    conversionValue: Number(bucket.conversionValue.toFixed(2)),
  };
}

function topEntries(counter: Map<string, number>, limit: number): Array<[string, number]> {
  return Array.from(counter.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
}

function bump(counter: Map<string, number>, key: string): void {
  counter.set(key, (counter.get(key) ?? 0) + 1);
}

export type ProbeOptions = {
  days: number;
  maxRows?: number;
  outDir?: string;
};

/**
 * The phase 1 checkpoint: pull real product rows and show exactly which
 * identifiers the feed produces. Writes nothing to the database.
 * Hard-capped at 100k rows — backfill has no such cap.
 */
export async function probeCommand(options: ProbeOptions): Promise<number> {
  return withSyncRun(
    "probe",
    { days: options.days, maxRows: options.maxRows ?? DEFAULT_MAX_ROWS },
    async () => {
      const config = resolveAdsConfig();
      const range = rangeForDays(options.days);
      const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
      const query = productDailyQuery(range.start, range.end);

      log("probe.query", { range, maxRows, apiVersion: config.apiVersion });

      const sample: Array<{ mapped: unknown; raw: unknown }> = [];
      const aggregator = new ProductAggregator();

      const merchantIds = new Map<string, number>();
      const feedLabels = new Map<string, number>();
      const languages = new Map<string, number>();
      const offerShapes = new Map<string, number>();
      const offerExamples = new Map<string, string>();
      const customAttrCounts: Record<string, Map<string, number>> = Object.fromEntries(
        CUSTOM_ATTR_KEYS.map((key) => [key, new Map<string, number>()])
      );

      const byCampaign = new Map<string, MetricBucket & { campaignName: string }>();
      const byLanguage = new Map<string, MetricBucket>();
      const shopifyProductIds = new Set<string>();
      const shopifyVariantIds = new Set<string>();

      let scanned = 0;
      let offerIdParsed = 0;
      let offerIdEmpty = 0;
      const emptyOfferMetrics = emptyMetrics();

      const iterator = searchRows(config, query, { maxRows });
      let next = await iterator.next();
      while (!next.done) {
        const raw = next.value;
        const mapped = mapProductRow(raw);
        scanned += 1;
        aggregator.add(mapped);

        bump(merchantIds, mapped.merchantId.toString());
        bump(feedLabels, mapped.feedLabel || "(empty)");
        bump(languages, mapped.languageCode || "(empty)");

        const shape = describeOfferIdShape(mapped.offerId);
        bump(offerShapes, shape);
        if (!offerExamples.has(shape)) offerExamples.set(shape, mapped.offerId);

        for (const key of CUSTOM_ATTR_KEYS) {
          bump(customAttrCounts[key], mapped[key] || "(empty)");
        }

        const campaignKey = mapped.campaignId.toString();
        let campaignBucket = byCampaign.get(campaignKey);
        if (!campaignBucket) {
          campaignBucket = { ...emptyMetrics(), campaignName: mapped.campaignName };
          byCampaign.set(campaignKey, campaignBucket);
        }
        addMetrics(campaignBucket, mapped);
        if (!campaignBucket.campaignName && mapped.campaignName) {
          campaignBucket.campaignName = mapped.campaignName;
        }

        const languageKey = mapped.languageCode || "(empty)";
        let languageBucket = byLanguage.get(languageKey);
        if (!languageBucket) {
          languageBucket = emptyMetrics();
          byLanguage.set(languageKey, languageBucket);
        }
        addMetrics(languageBucket, mapped);

        if (mapped.offerId.length === 0) {
          offerIdEmpty += 1;
          addMetrics(emptyOfferMetrics, mapped);
        } else {
          const parsed = parseOfferId(mapped.offerId);
          if (parsed.matched) {
            offerIdParsed += 1;
            if (parsed.shopifyProductId !== null) {
              shopifyProductIds.add(parsed.shopifyProductId.toString());
            }
            if (parsed.shopifyVariantId !== null) {
              shopifyVariantIds.add(parsed.shopifyVariantId.toString());
            }
          }
        }

        if (sample.length < SAMPLE_SIZE) {
          sample.push({ mapped: toJsonSafe(mapped), raw: toJsonSafe(raw) });
        }

        next = await iterator.next();
      }
      const stats = next.value;
      const report = aggregator.report();

      const truncated = scanned >= maxRows;
      const parseRate = scanned > 0 ? offerIdParsed / scanned : 0;

      const summary = {
        range,
        apiVersion: config.apiVersion,
        scannedRows: scanned,
        truncated,
        rowCap: maxRows,
        apiRequests: stats.requests,
        apiRetries: stats.retries,
        distinctMerchantIds: merchantIds.size,
        merchantIds: topEntries(merchantIds, 10),
        feedLabels: topEntries(feedLabels, 10),
        languages: topEntries(languages, 10),
        offerIdShapes: topEntries(offerShapes, 15).map(([shape, count]) => ({
          shape,
          count,
          example: offerExamples.get(shape) ?? "",
        })),
        offerIdEmpty,
        offerIdParsedAsShopify: offerIdParsed,
        offerIdParseRate: Number((parseRate * 100).toFixed(2)),
        distinctShopifyProductIds: shopifyProductIds.size,
        distinctShopifyVariantIds: shopifyVariantIds.size,
        byCampaign: Array.from(byCampaign.entries())
          .map(([campaignId, bucket]) => ({
            campaignId,
            campaignName: bucket.campaignName,
            ...shapeMetrics(bucket),
          }))
          .sort((a, b) => b.costChf - a.costChf),
        byLanguage: Array.from(byLanguage.entries())
          .map(([language, bucket]) => ({
            language,
            ...shapeMetrics(bucket),
          }))
          .sort((a, b) => b.costChf - a.costChf),
        customAttributes: Object.fromEntries(
          CUSTOM_ATTR_KEYS.map((key) => [
            key,
            {
              distinct: customAttrCounts[key].size,
              values: topEntries(customAttrCounts[key], 30).map(([value, count]) => ({
                value,
                count,
              })),
            },
          ])
        ),
        emptyOfferIdMetrics: shapeMetrics(emptyOfferMetrics),
        canonicalKeys: report.outputRows,
        duplicateKeys: report.duplicateKeys,
        conflictingKeys: report.conflictingKeys,
        conflictExamples: report.conflictExamples,
      };

      const outDir = options.outDir ?? path.join(process.cwd(), "tmp");
      await mkdir(outDir, { recursive: true });
      const outFile = path.join(outDir, `ads-probe-${range.end}.json`);
      await writeFile(
        outFile,
        stringifySafe({ generatedAt: new Date().toISOString(), summary, sample }, 2),
        "utf8"
      );

      log("probe.summary", summary);
      log("probe.sample_written", { file: outFile, rows: sample.length });

      if (truncated) {
        log("probe.truncated", {
          note: "probe-only row cap reached; backfill has no row cap",
          maxRows,
        });
      }

      return { ...summary, sampleFile: outFile, sampleRows: sample.length };
    },
    { persist: false }
  );
}
