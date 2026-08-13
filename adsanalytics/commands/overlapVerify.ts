import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { Prisma } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import { resolveAdsConfig } from "@/adsanalytics/config";
import { searchAll, searchRows, type GoogleAdsRow } from "@/adsanalytics/google/adsClient";
import {
  pmaxCampaignSettingsQuery,
  pmaxListingGroupFilterTreeQuery,
  shoppingProductCampaignScopeQuery,
} from "@/adsanalytics/google/queries";
import { stringifySafe } from "@/adsanalytics/json";
import {
  campaignListingNodes,
  mapListingFilterRow,
  offerMatchesListingRules,
  reconstructEffectiveRules,
  type ListingFilterNode,
  type OfferAttrs,
} from "@/adsanalytics/listingGroup";
import { log, withSyncRun } from "@/adsanalytics/run";

type SampleBucket =
  | "nike"
  | "adidas"
  | "jordan"
  | "other_brand"
  | "vetements"
  | "lego";

type DbOffer = OfferAttrs & {
  merchantId: string;
  channel: string;
  languageCode: string;
  feedLabel: string;
  title: string;
  status: string;
  targetedCampaignIds: string[];
  targetedCampaignNames: string[];
  shopifyProductId: string | null;
  shopifyVariantId: string | null;
};

function asString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function section(row: GoogleAdsRow, name: string): Record<string, unknown> {
  const value = row[name];
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

async function loadBucketOffers(bucket: SampleBucket, limit: number): Promise<DbOffer[]> {
  let where: Prisma.Sql;
  switch (bucket) {
    case "nike":
      where = Prisma.sql`LOWER("brand") = 'nike'`;
      break;
    case "adidas":
      where = Prisma.sql`LOWER("brand") = 'adidas'`;
      break;
    case "jordan":
      where = Prisma.sql`LOWER("brand") = 'jordan'`;
      break;
    case "other_brand":
      where = Prisma.sql`LOWER("brand") NOT IN ('nike','adidas','jordan','lego') AND COALESCE("brand",'') <> ''`;
      break;
    case "vetements":
      where = Prisma.sql`(
        LOWER("custom_attr0") LIKE '%vetement%'
        OR LOWER("product_type") LIKE '%streetwear%'
        OR LOWER("product_type") LIKE '%t-shirt%'
        OR LOWER("product_type") LIKE '%vetement%'
      )`;
      break;
    case "lego":
      where = Prisma.sql`(LOWER("brand") = 'lego' OR LOWER("custom_attr0") LIKE '%collectible%' OR LOWER("product_type") LIKE '%collectible%')`;
      break;
  }

  const rows = await prisma.$queryRaw<
    Array<{
      merchant_id: string;
      channel: string;
      language_code: string;
      feed_label: string;
      offer_id: string;
      title: string;
      brand: string;
      product_type: string;
      custom_attr0: string;
      custom_attr1: string;
      custom_attr2: string;
      custom_attr3: string;
      custom_attr4: string;
      status: string;
      targeted_campaign_ids: string[];
      targeted_campaign_names: string[];
      shopify_product_id: string | null;
      shopify_variant_id: string | null;
    }>
  >(Prisma.sql`
    SELECT
      "merchant_id"::text,
      "channel",
      "language_code",
      "feed_label",
      "offer_id",
      "title",
      "brand",
      "product_type",
      "custom_attr0",
      "custom_attr1",
      "custom_attr2",
      "custom_attr3",
      "custom_attr4",
      "status",
      "targeted_campaign_ids",
      "targeted_campaign_names",
      "shopify_product_id"::text,
      "shopify_variant_id"::text
    FROM "public"."ads_shopping_product_current"
    WHERE "is_current" = true
      AND ${where}
    ORDER BY "offer_id"
    LIMIT ${limit}
  `);

  return rows.map((r) => ({
    merchantId: r.merchant_id,
    channel: r.channel,
    languageCode: r.language_code,
    feedLabel: r.feed_label,
    offerId: r.offer_id,
    title: r.title,
    brand: r.brand,
    productType: r.product_type,
    customAttr0: r.custom_attr0,
    customAttr1: r.custom_attr1,
    customAttr2: r.custom_attr2,
    customAttr3: r.custom_attr3,
    customAttr4: r.custom_attr4,
    status: r.status,
    targetedCampaignIds: r.targeted_campaign_ids ?? [],
    targetedCampaignNames: r.targeted_campaign_names ?? [],
    shopifyProductId: r.shopify_product_id,
    shopifyVariantId: r.shopify_variant_id,
  }));
}

async function countCampaignScopeHits(
  customerId: string,
  campaignId: string,
  maxProbeRows: number
): Promise<{ rowsSeen: number; truncated: boolean; gaql: string }> {
  const config = resolveAdsConfig();
  const gaql = shoppingProductCampaignScopeQuery(customerId, campaignId);
  let rowsSeen = 0;
  let truncated = false;
  const iterator = searchRows(config, gaql, { maxRows: maxProbeRows });
  let next = await iterator.next();
  while (!next.done) {
    rowsSeen += 1;
    next = await iterator.next();
  }
  // If we hit the cap, mark truncated (full sync previously saw ~1.1M per campaign).
  if (rowsSeen >= maxProbeRows) truncated = true;
  return { rowsSeen, truncated, gaql };
}

export async function overlapVerifyCommand(): Promise<number> {
  return withSyncRun("overlap:verify", {}, async () => {
    const config = resolveAdsConfig();
    const accountOffers = await prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS n
      FROM "public"."ads_shopping_product_current"
      WHERE "is_current" = true
    `);
    const accountOfferCount = accountOffers[0]?.n ?? 0;

    const settingsRes = await searchAll(config, pmaxCampaignSettingsQuery());
    const campaigns = settingsRes.rows
      .map((row) => {
        const campaign = section(row, "campaign");
        const shopping = section(campaign, "shoppingSetting");
        const budget = section(row, "campaignBudget");
        return {
          campaignId: asString(campaign.id),
          campaignName: asString(campaign.name),
          status: asString(campaign.status),
          channelType: asString(campaign.advertisingChannelType),
          merchantId: asString(shopping.merchantId) || null,
          feedLabel: asString(shopping.feedLabel) || null,
          campaignPriority: asString(shopping.campaignPriority) || null,
          enableLocal: shopping.enableLocal ?? null,
          disableProductFeed: shopping.disableProductFeed ?? null,
          targetRoas: (() => {
            const mcv = section(campaign, "maximizeConversionValue");
            const v = mcv.targetRoas;
            return v == null || v === "" ? null : Number(v);
          })(),
          budgetMicros: asString(budget.amountMicros) || null,
          campaignScopeGaql: shoppingProductCampaignScopeQuery(config.customerId, asString(campaign.id)),
        };
      })
      .filter((c) => c.campaignId.length > 0)
      .sort((a, b) => a.campaignName.localeCompare(b.campaignName));

    const treeRes = await searchAll(config, pmaxListingGroupFilterTreeQuery());
    const nodes: ListingFilterNode[] = [];
    for (const row of treeRes.rows) {
      const mapped = mapListingFilterRow(row);
      if (mapped) nodes.push(mapped);
    }
    const effectiveRules = reconstructEffectiveRules(nodes);

    // Probe campaign-scope cardinality (cap to avoid another 20min sync).
    const PROBE_CAP = 20_000;
    const campaignScopeProbes = [];
    for (const c of campaigns.filter((x) => x.status === "ENABLED")) {
      log("overlap_verify.campaign_scope_probe_start", {
        campaignId: c.campaignId,
        campaignName: c.campaignName,
        maxRows: PROBE_CAP,
      });
      const probe = await countCampaignScopeHits(config.customerId, c.campaignId, PROBE_CAP);
      campaignScopeProbes.push({
        campaignId: c.campaignId,
        campaignName: c.campaignName,
        ...probe,
        accountOfferCount,
        note:
          probe.truncated
            ? `shopping_product campaign scope returned >= ${PROBE_CAP} rows (likely full Merchant catalog; prior full sync saw ~account size per campaign)`
            : `shopping_product campaign scope returned ${probe.rowsSeen} rows`,
      });
    }

    // Sample 20 known offers across buckets.
    const buckets: SampleBucket[] = ["nike", "adidas", "jordan", "other_brand", "vetements", "lego"];
    const perBucket = 4;
    const samples: Array<{
      bucket: SampleBucket;
      offer: DbOffer;
      shoppingProductCampaignScope: Array<{
        campaignId: string;
        campaignName: string;
        inScopeFromSnapshot: boolean;
      }>;
      listingGroupEffective: Array<{
        campaignId: string;
        campaignName: string;
        included: boolean;
        matchedPath: string | null;
        reason: string;
      }>;
      disagreement: Array<{
        campaignId: string;
        campaignName: string;
        shoppingProductSaysIncluded: boolean;
        listingGroupSaysIncluded: boolean;
      }>;
    }> = [];

    for (const bucket of buckets) {
      const offers = await loadBucketOffers(bucket, perBucket);
      for (const offer of offers) {
        const shoppingProductCampaignScope = campaigns.map((c) => ({
          campaignId: c.campaignId,
          campaignName: c.campaignName,
          inScopeFromSnapshot: offer.targetedCampaignIds.includes(c.campaignId),
        }));

        const listingGroupEffective = campaigns.map((c) => {
          const campNodes = campaignListingNodes(nodes, c.campaignId);
          const match = offerMatchesListingRules(offer, campNodes);
          return {
            campaignId: c.campaignId,
            campaignName: c.campaignName,
            ...match,
          };
        });

        const disagreement = campaigns
          .map((c) => {
            const sp = offer.targetedCampaignIds.includes(c.campaignId);
            const lg = listingGroupEffective.find((x) => x.campaignId === c.campaignId)?.included ?? false;
            return {
              campaignId: c.campaignId,
              campaignName: c.campaignName,
              shoppingProductSaysIncluded: sp,
              listingGroupSaysIncluded: lg,
            };
          })
          .filter((d) => d.shoppingProductSaysIncluded !== d.listingGroupSaysIncluded);

        samples.push({
          bucket,
          offer: {
            ...offer,
            // keep payload readable
          },
          shoppingProductCampaignScope,
          listingGroupEffective,
          disagreement,
        });
      }
    }

    const disagreementCount = samples.reduce((s, x) => s + x.disagreement.length, 0);
    const samplesWithDisagreement = samples.filter((s) => s.disagreement.length > 0).length;
    const allScopeProbesTruncated =
      campaignScopeProbes.length > 0 && campaignScopeProbes.every((p) => p.truncated);
    const rulesShowBrandFilters = effectiveRules.some((r) => r.hasExplicitBrandFilter);
    const rulesShowAllProducts = effectiveRules.every((r) => r.isAllProductsStyle);

    let verdict: "confirmed_overlap" | "api_artefact" | "mixed_inconclusive";
    let verdictReason: string;
    if (allScopeProbesTruncated && rulesShowBrandFilters && samplesWithDisagreement > 0) {
      verdict = "api_artefact";
      verdictReason =
        "shopping_product campaign scope returns near-full Merchant catalog for every PMax campaign while listing-group trees encode brand/custom-attr filters. Do NOT use shopping_product campaign scope as overlap proof.";
    } else if (rulesShowAllProducts && allScopeProbesTruncated) {
      verdict = "confirmed_overlap";
      verdictReason =
        "listing-group trees look all-products style and shopping_product campaign scope returns the full catalog — true structural overlap likely.";
    } else if (samplesWithDisagreement > 0) {
      verdict = "api_artefact";
      verdictReason =
        "Manual offer tests disagree between shopping_product campaign-scope snapshot and reconstructed listing-group inclusion. Treat shopping_product campaign scope as unreliable for overlap.";
    } else {
      verdict = "mixed_inconclusive";
      verdictReason =
        "Listing-group reconstruction and campaign-scope signals did not produce a clean contradiction; inspect exported trees before media decisions.";
    }

    // Effective overlap from listing groups only (brand/custom attr intersections).
    const enabled = campaigns.filter((c) => c.status === "ENABLED");
    const brandSets = enabled.map((c) => {
      const rules = effectiveRules.filter((r) => r.campaignId === c.campaignId);
      const includes = [...new Set(rules.flatMap((r) => r.brandIncludes.map((b) => b.toLowerCase())))];
      const excludes = [...new Set(rules.flatMap((r) => r.brandExcludes.map((b) => b.toLowerCase())))];
      const attrs = rules.flatMap((r) =>
        r.customAttrIncludes.map((a) => `${a.index}:${a.value}`.toLowerCase())
      );
      return {
        campaignId: c.campaignId,
        campaignName: c.campaignName,
        brandIncludes: includes,
        brandExcludes: excludes,
        customAttrIncludes: [...new Set(attrs)],
        isAllProductsStyle: rules.length === 0 || rules.every((r) => r.isAllProductsStyle),
      };
    });

    const pairwiseListingOverlap: Array<{
      a: string;
      b: string;
      brandIntersection: string[];
      bothAllProducts: boolean;
      likelyRealOverlap: boolean;
    }> = [];
    for (let i = 0; i < brandSets.length; i += 1) {
      for (let j = i + 1; j < brandSets.length; j += 1) {
        const a = brandSets[i]!;
        const b = brandSets[j]!;
        const brandIntersection = a.brandIncludes.filter((x) => b.brandIncludes.includes(x));
        const bothAllProducts = a.isAllProductsStyle && b.isAllProductsStyle;
        const likelyRealOverlap =
          bothAllProducts ||
          brandIntersection.length > 0 ||
          (a.brandIncludes.length === 0 && b.isAllProductsStyle) ||
          (b.brandIncludes.length === 0 && a.isAllProductsStyle);
        pairwiseListingOverlap.push({
          a: a.campaignName,
          b: b.campaignName,
          brandIntersection,
          bothAllProducts,
          likelyRealOverlap,
        });
      }
    }

    const outDir = path.join(process.cwd(), "tmp");
    await mkdir(outDir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    const treePath = path.join(outDir, `ads-overlap-listing-tree-${stamp}.json`);
    const reportPath = path.join(outDir, `ads-overlap-verify-${stamp}.json`);

    const report = {
      settings: {
        customerId: config.customerId,
        accountOfferCount,
        probeCap: PROBE_CAP,
      },
      campaigns: campaigns.map((c) => ({
        ...c,
        // never log tokens; ids ok
      })),
      campaignScopeGaqlTemplate: shoppingProductCampaignScopeQuery(
        config.customerId,
        "{campaignId}"
      ),
      campaignScopeProbes,
      listingGroupTreeNodeCount: nodes.length,
      listingGroupEffectiveRules: effectiveRules,
      listingGroupBrandSummary: brandSets,
      pairwiseListingOverlap,
      manualOfferTests: {
        sampleCount: samples.length,
        samplesWithDisagreement,
        disagreementPairs: disagreementCount,
        samples,
      },
      verdict: {
        status: verdict,
        reason: verdictReason,
        rule:
          "If shopping_product campaign scope returns the whole Merchant Center despite listing filters, do not use campaign scope as overlap proof. Prefer reconstructed listing-group inclusion.",
      },
      exports: {
        listingTreePath: treePath,
        reportPath,
      },
    };

    await writeFile(treePath, stringifySafe(nodes), "utf8");
    await writeFile(reportPath, stringifySafe(report), "utf8");

    log("overlap_verify.summary", {
      accountOfferCount,
      campaigns: campaigns.length,
      listingNodes: nodes.length,
      samples: samples.length,
      samplesWithDisagreement,
      verdict: report.verdict,
      pairwiseLikelyRealOverlap: pairwiseListingOverlap.filter((p) => p.likelyRealOverlap).length,
      exports: report.exports,
    });

    return report;
  });
}
