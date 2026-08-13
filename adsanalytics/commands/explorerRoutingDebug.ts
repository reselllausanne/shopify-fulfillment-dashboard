import {
  campaignListingNodes,
  leafPath,
  resolveIncludedLeafNodesForOffer,
} from "@/adsanalytics/listingGroup";
import {
  loadBatchById,
  loadExplorerCampaignsAndListingNodes,
  loadOfferAttrsForBatch,
  writeExplorerReport,
} from "@/adsanalytics/explorer/core";
import { log, withSyncRun } from "@/adsanalytics/run";

type Options = { batch?: string };

function requiredBatchId(batchId: string | undefined): string {
  const id = batchId?.trim();
  if (!id) throw new Error("Missing --batch=<id>");
  return id;
}

type BucketKey =
  | "zero_included_leaf"
  | "exactly_one_leaf"
  | "multi_leaf_same_asset_group"
  | "multi_asset_group_same_campaign"
  | "multi_campaign_enabled"
  | "excluded_only"
  | "non_eligible"
  | "missing_required_attrs";

const BUCKET_ORDER: BucketKey[] = [
  "zero_included_leaf",
  "exactly_one_leaf",
  "multi_leaf_same_asset_group",
  "multi_asset_group_same_campaign",
  "multi_campaign_enabled",
  "excluded_only",
  "non_eligible",
  "missing_required_attrs",
];

type OfferDebug = {
  modelId: string;
  offerId: string;
  status: string;
  availability: string;
  language: string;
  feedLabel: string;
  brand: string;
  customAttrs: { c0: string; c1: string; c2: string; c3: string; c4: string };
  campaigns: Array<{ campaignId: string; campaignName: string; assetGroupId: string; leafId: string; path: string }>;
  reasons: string[];
};

function sanitizeOfferDebug(row: OfferDebug): Record<string, unknown> {
  return {
    modelId: row.modelId,
    offerId: row.offerId,
    status: row.status,
    availability: row.availability,
    language: row.language,
    feedLabel: row.feedLabel,
    brand: row.brand,
    customAttrs: row.customAttrs,
    campaigns: row.campaigns,
    reasons: row.reasons,
  };
}

export async function explorerRoutingDebugCommand(options: Options = {}): Promise<number> {
  return withSyncRun("explorer:routing-debug", options, async () => {
    const batchId = requiredBatchId(options.batch);
    const batch = await loadBatchById(batchId);
    if (!batch) throw new Error(`Batch not found: ${batchId}`);
    const [offers, listingCtx] = await Promise.all([
      loadOfferAttrsForBatch(batchId),
      loadExplorerCampaignsAndListingNodes(),
    ]);

    const byCampaign = new Map(
      listingCtx.campaigns.map((c) => [c.campaignId, campaignListingNodes(listingCtx.listingNodes, c.campaignId)])
    );
    const campaignNameById = new Map(listingCtx.campaigns.map((c) => [c.campaignId, c.campaignName]));

    const buckets = new Map<
      BucketKey,
      { offers: OfferDebug[]; models: Set<string>; eligible: number; nonEligible: number }
    >();
    const ensure = (k: BucketKey) => {
      const b = buckets.get(k);
      if (b) return b;
      const next = { offers: [] as OfferDebug[], models: new Set<string>(), eligible: 0, nonEligible: 0 };
      buckets.set(k, next);
      return next;
    };

    for (const offer of offers) {
      const isEligible = offer.status.toUpperCase() === "ELIGIBLE";
      const missingRequired =
        !offer.offerId ||
        !offer.feedLabel ||
        !offer.languageCode ||
        !offer.brand ||
        !offer.productType;

      const includeRows: OfferDebug["campaigns"] = [];
      const exclusionHits: string[] = [];
      for (const campaign of listingCtx.campaigns) {
        const nodes = byCampaign.get(campaign.campaignId) ?? [];
        const resolved = resolveIncludedLeafNodesForOffer(offer, nodes);
        if (resolved.included && resolved.matchedIncludedLeafs.length > 0) {
          for (const leaf of resolved.matchedIncludedLeafs) {
            includeRows.push({
              campaignId: leaf.campaignId,
              campaignName: campaignNameById.get(leaf.campaignId) ?? leaf.campaignName,
              assetGroupId: leaf.assetGroupId,
              leafId: leaf.id,
              path: leafPath(nodes, leaf),
            });
          }
        } else if (resolved.reason === "matched_exclude_path") {
          exclusionHits.push(campaign.campaignId);
        }
      }

      const campaignSet = new Set(includeRows.map((r) => r.campaignId));
      const assetGroupsByCampaign = new Map<string, Set<string>>();
      for (const row of includeRows) {
        const set = assetGroupsByCampaign.get(row.campaignId) ?? new Set<string>();
        set.add(row.assetGroupId);
        assetGroupsByCampaign.set(row.campaignId, set);
      }
      const hasMultiLeafSameAsset = (() => {
        const keyCounts = new Map<string, number>();
        for (const row of includeRows) {
          const key = `${row.campaignId}|${row.assetGroupId}`;
          keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
        }
        return [...keyCounts.values()].some((n) => n > 1);
      })();

      const debug: OfferDebug = {
        modelId: offer.shopifyProductId,
        offerId: offer.offerId,
        status: offer.status,
        availability: offer.availability,
        language: offer.languageCode,
        feedLabel: offer.feedLabel,
        brand: offer.brand,
        customAttrs: {
          c0: offer.customAttr0,
          c1: offer.customAttr1,
          c2: offer.customAttr2,
          c3: offer.customAttr3,
          c4: offer.customAttr4,
        },
        campaigns: includeRows,
        reasons: [],
      };

      let bucket: BucketKey;
      if (!isEligible) bucket = "non_eligible";
      else if (missingRequired) bucket = "missing_required_attrs";
      else if (includeRows.length === 0 && exclusionHits.length > 0) bucket = "excluded_only";
      else if (includeRows.length === 0) bucket = "zero_included_leaf";
      else if (campaignSet.size > 1) bucket = "multi_campaign_enabled";
      else if (hasMultiLeafSameAsset) bucket = "multi_leaf_same_asset_group";
      else if ((assetGroupsByCampaign.get([...campaignSet][0] ?? "")?.size ?? 0) > 1)
        bucket = "multi_asset_group_same_campaign";
      else if (includeRows.length === 1) bucket = "exactly_one_leaf";
      else bucket = "multi_leaf_same_asset_group";

      const b = ensure(bucket);
      b.offers.push(debug);
      b.models.add(offer.shopifyProductId);
      if (isEligible) b.eligible += 1;
      else b.nonEligible += 1;
    }

    for (const key of BUCKET_ORDER) ensure(key);

    const report = {
      batchId,
      generatedAt: new Date().toISOString(),
      groups: BUCKET_ORDER.map((key) => {
        const b = buckets.get(key)!;
        return {
        group: key,
        offerCount: b.offers.length,
        modelCount: b.models.size,
        eligibleOffers: b.eligible,
        nonEligibleOffers: b.nonEligible,
        examples: b.offers.slice(0, 30).map((x) => sanitizeOfferDebug(x)),
      };
      }),
    };
    const outPath = await writeExplorerReport(`explorer-routing-debug-${batchId}.json`, report);
    log("explorer_routing_debug.summary", {
      batchId,
      groups: report.groups.map((g) => ({ group: g.group, offerCount: g.offerCount, modelCount: g.modelCount })),
      reportPath: outPath,
    });
    return { batchId, groups: report.groups, reportPath: outPath };
  });
}

