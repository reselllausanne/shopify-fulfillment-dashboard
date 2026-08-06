import type { GoogleAdsRow } from "@/adsanalytics/google/adsClient";
import { normalizeLanguageCode } from "@/adsanalytics/languages";

/**
 * Mapping from the Google Ads REST JSON shape to our row types, plus the
 * canonical-key aggregation that must happen before any upsert.
 */

export type CampaignDailyRow = {
  date: string;
  campaignId: bigint;
  campaignName: string;
  campaignStatus: string;
  channelType: string;
  impressions: bigint;
  clicks: bigint;
  costMicros: bigint;
  conversions: number;
  conversionValue: number;
};

export const PRODUCT_ATTRIBUTE_KEYS = [
  "campaignName",
  "title",
  "brand",
  "productType",
  "customAttr0",
  "customAttr1",
  "customAttr2",
  "customAttr3",
  "customAttr4",
] as const;

/** Custom labels already set by Simprosys / Shopify — never replace a non-empty value. */
export const CUSTOM_ATTR_KEYS = [
  "customAttr0",
  "customAttr1",
  "customAttr2",
  "customAttr3",
  "customAttr4",
] as const;

export type ProductAttributeKey = (typeof PRODUCT_ATTRIBUTE_KEYS)[number];
export type CustomAttrKey = (typeof CUSTOM_ATTR_KEYS)[number];

const CUSTOM_ATTR_KEY_SET = new Set<string>(CUSTOM_ATTR_KEYS);

export type ProductDailyRow = {
  date: string;
  campaignId: bigint;
  merchantId: bigint;
  feedLabel: string;
  languageCode: string;
  offerId: string;
  campaignName: string;
  title: string;
  brand: string;
  productType: string;
  customAttr0: string;
  customAttr1: string;
  customAttr2: string;
  customAttr3: string;
  customAttr4: string;
  impressions: bigint;
  clicks: bigint;
  costMicros: bigint;
  conversions: number;
  conversionValue: number;
};

export type AggregatedProductRow = ProductDailyRow & {
  shopifyProductId: bigint | null;
  shopifyVariantId: bigint | null;
  attributeConflict: boolean;
  sourceRows: number;
};

export type AggregationReport = {
  inputRows: number;
  outputRows: number;
  /** Keys that appeared more than once and needed metric summing. */
  duplicateKeys: number;
  /** Keys where at least one product attribute had two different non-empty values. */
  conflictingKeys: number;
  conflictExamples: Array<{
    key: string;
    attribute: ProductAttributeKey;
    values: string[];
  }>;
};

function asString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return "";
}

function asBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.round(value));
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return BigInt(value.trim());
  return 0n;
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function section(row: GoogleAdsRow, name: string): Record<string, unknown> {
  const value = row[name];
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function mapCampaignRow(row: GoogleAdsRow): CampaignDailyRow {
  const segments = section(row, "segments");
  const campaign = section(row, "campaign");
  const metrics = section(row, "metrics");

  return {
    date: asString(segments.date),
    campaignId: asBigInt(campaign.id),
    campaignName: asString(campaign.name),
    campaignStatus: asString(campaign.status),
    channelType: asString(campaign.advertisingChannelType),
    impressions: asBigInt(metrics.impressions),
    clicks: asBigInt(metrics.clicks),
    costMicros: asBigInt(metrics.costMicros),
    conversions: asNumber(metrics.conversions),
    conversionValue: asNumber(metrics.conversionsValue),
  };
}

/** L1 > L2 > L3, trimmed of empty levels. */
function joinProductType(segments: Record<string, unknown>): string {
  return [segments.productTypeL1, segments.productTypeL2, segments.productTypeL3]
    .map(asString)
    .filter((part) => part.length > 0)
    .join(" > ");
}

export function mapProductRow(row: GoogleAdsRow): ProductDailyRow {
  const segments = section(row, "segments");
  const campaign = section(row, "campaign");
  const metrics = section(row, "metrics");

  return {
    date: asString(segments.date),
    campaignId: asBigInt(campaign.id),
    merchantId: asBigInt(segments.productMerchantId),
    feedLabel: asString(segments.productFeedLabel),
    languageCode: normalizeLanguageCode(asString(segments.productLanguage)),
    offerId: asString(segments.productItemId),
    campaignName: asString(campaign.name),
    title: asString(segments.productTitle),
    brand: asString(segments.productBrand),
    productType: joinProductType(segments),
    customAttr0: asString(segments.productCustomAttribute0),
    customAttr1: asString(segments.productCustomAttribute1),
    customAttr2: asString(segments.productCustomAttribute2),
    customAttr3: asString(segments.productCustomAttribute3),
    customAttr4: asString(segments.productCustomAttribute4),
    impressions: asBigInt(metrics.impressions),
    clicks: asBigInt(metrics.clicks),
    costMicros: asBigInt(metrics.costMicros),
    conversions: asNumber(metrics.conversions),
    conversionValue: asNumber(metrics.conversionsValue),
  };
}

export function canonicalKey(row: ProductDailyRow): string {
  return [
    row.date,
    row.campaignId.toString(),
    row.merchantId.toString(),
    row.feedLabel,
    row.languageCode,
    row.offerId,
  ].join("|");
}

/**
 * Permanent Simprosys / Shopify Google channel offer ID parser.
 * Observed live: shopify_ch_<productId>_<variantId> (99.98% of rows).
 * Case-insensitive prefix; never blocks ingestion on mismatch.
 */
export type OfferIdParse = {
  matched: boolean;
  country: string | null;
  shopifyProductId: bigint | null;
  shopifyVariantId: bigint | null;
};

const SHOPIFY_OFFER_ID = /^shopify_([A-Za-z]{2})_(\d+)(?:_(\d+))?$/i;

export function parseOfferId(offerId: string): OfferIdParse {
  const match = SHOPIFY_OFFER_ID.exec(offerId.trim());
  if (!match) {
    return {
      matched: false,
      country: null,
      shopifyProductId: null,
      shopifyVariantId: null,
    };
  }

  return {
    matched: true,
    country: match[1].toLowerCase(),
    shopifyProductId: BigInt(match[2]),
    shopifyVariantId: match[3] ? BigInt(match[3]) : null,
  };
}

/** Coarse shape used by the probe summary, e.g. "shopify_<cc>_<digits>_<digits>". */
export function describeOfferIdShape(offerId: string): string {
  const trimmed = offerId.trim();
  if (trimmed.length === 0) return "(empty)";
  const parsed = parseOfferId(trimmed);
  if (parsed.matched) {
    return parsed.shopifyVariantId !== null
      ? "shopify_<cc>_<digits>_<digits>"
      : "shopify_<cc>_<digits>";
  }
  return trimmed.replace(/\d+/g, "<digits>");
}

const MAX_CONFLICT_EXAMPLES = 10;

/**
 * Collapse API rows onto the canonical key BEFORE writing.
 *
 * The API can return several rows for one key when a product attribute changed
 * during the day (a retitled product, a new custom label). Upserting row by row
 * would let the last one overwrite the metrics of the previous ones, so metrics
 * are summed and attributes are resolved deterministically: among the distinct
 * non-empty candidates the lexicographically first one wins, which is
 * independent of the order the API happened to return.
 *
 * Incremental by design: only one entry per unique key is held, so a whole month
 * of product rows can be streamed through without buffering the raw response.
 */
export class ProductAggregator {
  private readonly entries = new Map<string, AggregatedProductRow>();
  private inputRows = 0;
  private duplicateKeys = 0;
  private conflictingKeys = 0;
  private readonly conflictExamples: AggregationReport["conflictExamples"] = [];

  add(row: ProductDailyRow): void {
    this.inputRows += 1;
    const key = canonicalKey(row);
    const existing = this.entries.get(key);

    if (!existing) {
      const parsed = parseOfferId(row.offerId);
      this.entries.set(key, {
        ...row,
        shopifyProductId: parsed.shopifyProductId,
        shopifyVariantId: parsed.shopifyVariantId,
        attributeConflict: false,
        sourceRows: 1,
      });
      return;
    }

    if (existing.sourceRows === 1) this.duplicateKeys += 1;
    existing.sourceRows += 1;
    existing.impressions += row.impressions;
    existing.clicks += row.clicks;
    existing.costMicros += row.costMicros;
    existing.conversions += row.conversions;
    existing.conversionValue += row.conversionValue;

    let newlyConflicted = false;
    for (const attribute of PRODUCT_ATTRIBUTE_KEYS) {
      const incoming = row[attribute];
      if (incoming.length === 0) continue;

      const current = existing[attribute];
      if (current.length === 0) {
        existing[attribute] = incoming;
        continue;
      }
      if (current === incoming) continue;

      if (!existing.attributeConflict) newlyConflicted = true;
      if (this.conflictExamples.length < MAX_CONFLICT_EXAMPLES) {
        this.conflictExamples.push({ key, attribute, values: [current, incoming].sort() });
      }

      // Custom labels are already populated by the feed — never overwrite.
      if (CUSTOM_ATTR_KEY_SET.has(attribute)) continue;

      // Other attributes: keep the lexicographically first non-empty value.
      if (incoming < current) existing[attribute] = incoming;
    }

    if (newlyConflicted) {
      existing.attributeConflict = true;
      this.conflictingKeys += 1;
    }
  }

  get size(): number {
    return this.entries.size;
  }

  rows(): AggregatedProductRow[] {
    return Array.from(this.entries.values());
  }

  report(): AggregationReport {
    return {
      inputRows: this.inputRows,
      outputRows: this.entries.size,
      duplicateKeys: this.duplicateKeys,
      conflictingKeys: this.conflictingKeys,
      conflictExamples: this.conflictExamples,
    };
  }
}

export function aggregateProductRows(rows: ProductDailyRow[]): {
  rows: AggregatedProductRow[];
  report: AggregationReport;
} {
  const aggregator = new ProductAggregator();
  for (const row of rows) aggregator.add(row);
  return { rows: aggregator.rows(), report: aggregator.report() };
}
