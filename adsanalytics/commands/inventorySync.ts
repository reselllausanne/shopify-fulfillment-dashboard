import { Prisma } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import { resolveAdsConfig } from "@/adsanalytics/config";
import { defaultEndDate } from "@/adsanalytics/dates";
import { searchAll, searchRows } from "@/adsanalytics/google/adsClient";
import {
  activeShoppingAndPmaxCampaignsQuery,
  pmaxAssetGroupListingGroupQuery,
  pmaxCampaignSettingsQuery,
  shoppingProductAccountScopeQuery,
  shoppingProductCampaignScopeQuery,
} from "@/adsanalytics/google/queries";
import {
  mapActiveCampaign,
  mapShoppingCampaignScopeRow,
  mapShoppingProductCurrentRow,
  shoppingOfferKey,
  type ActiveCampaign,
  type CampaignScopeRow,
  type ShoppingProductCurrentRow,
} from "@/adsanalytics/shoppingInventory";
import {
  finalizeShoppingProductCurrent,
  upsertCampaignSettingsDaily,
  upsertShoppingProductCurrent,
  type CampaignSettingsSnapshotRow,
  type ShoppingProductSnapshotRow,
} from "@/adsanalytics/repository";
import { log, withSyncRun } from "@/adsanalytics/run";

type OfferAccumulator = ShoppingProductCurrentRow & {
  targetedCampaignIds: Set<string>;
  targetedCampaignNames: Set<string>;
};

function dig(row: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = row;
  for (const part of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function num(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value) || 0;
  return 0;
}

function str(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return "";
}

function bigintOrNull(value: unknown): bigint | null {
  const s = str(value);
  if (!s || !/^-?\d+$/.test(s)) return null;
  return BigInt(s);
}

function dedupeSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function toSnapshotRows(map: Map<string, OfferAccumulator>): ShoppingProductSnapshotRow[] {
  return [...map.values()].map((row) => ({
    merchantId: row.merchantId,
    channel: row.channel,
    languageCode: row.languageCode,
    feedLabel: row.feedLabel,
    offerId: row.offerId,
    title: row.title,
    brand: row.brand,
    productType: row.productType,
    customAttr0: row.customAttr0,
    customAttr1: row.customAttr1,
    customAttr2: row.customAttr2,
    customAttr3: row.customAttr3,
    customAttr4: row.customAttr4,
    status: row.status,
    availability: row.availability,
    shopifyProductId: row.shopifyProductId,
    shopifyVariantId: row.shopifyVariantId,
    targetedCampaignIds: dedupeSorted(row.targetedCampaignIds),
    targetedCampaignNames: dedupeSorted(row.targetedCampaignNames),
  }));
}

function addCampaignScopeHit(
  map: Map<string, OfferAccumulator>,
  hit: CampaignScopeRow
): { matched: boolean } {
  // Defence in depth: a NOT_ELIGIBLE row means the campaign's listing tree does not target
  // this offer, so recording it would fabricate overlap between routed campaigns.
  if (hit.status.toUpperCase() === "NOT_ELIGIBLE") return { matched: false };
  const key = shoppingOfferKey({
    merchantId: hit.merchantId,
    channel: hit.channel,
    languageCode: hit.languageCode,
    feedLabel: hit.feedLabel,
    offerId: hit.offerId,
  });
  const existing = map.get(key);
  if (!existing) return { matched: false };
  existing.targetedCampaignIds.add(hit.campaignId);
  if (hit.campaignName) existing.targetedCampaignNames.add(hit.campaignName);
  return { matched: true };
}

async function fetchListingGroupFiltersByCampaign(): Promise<Map<string, Prisma.JsonValue[]>> {
  const config = resolveAdsConfig();
  const out = new Map<string, Prisma.JsonValue[]>();
  const { rows } = await searchAll(config, pmaxAssetGroupListingGroupQuery());
  for (const row of rows) {
    const campaignId = str(dig(row as Record<string, unknown>, ["campaign", "id"]));
    if (!campaignId) continue;
    const current = out.get(campaignId) ?? [];
    current.push({
      assetGroupId: str(dig(row as Record<string, unknown>, ["assetGroup", "id"])),
      assetGroupName: str(dig(row as Record<string, unknown>, ["assetGroup", "name"])),
      filterId: str(dig(row as Record<string, unknown>, ["assetGroupListingGroupFilter", "id"])),
      type: str(dig(row as Record<string, unknown>, ["assetGroupListingGroupFilter", "type"])),
      listingSource: str(
        dig(row as Record<string, unknown>, ["assetGroupListingGroupFilter", "listingSource"])
      ),
    });
    out.set(campaignId, current);
  }
  return out;
}

async function snapshotCampaignSettings(
  campaigns: ActiveCampaign[],
  snapshotDate: string
): Promise<{ written: number; rows: CampaignSettingsSnapshotRow[] }> {
  const config = resolveAdsConfig();
  const [{ rows: settingsRows }, listingByCampaign] = await Promise.all([
    searchAll(config, pmaxCampaignSettingsQuery()),
    fetchListingGroupFiltersByCampaign(),
  ]);
  const settingsById = new Map<string, Record<string, unknown>>();
  for (const row of settingsRows as Array<Record<string, unknown>>) {
    const id = str(dig(row, ["campaign", "id"]));
    if (id) settingsById.set(id, row);
  }

  const snapshotRows: CampaignSettingsSnapshotRow[] = campaigns.map((campaign) => {
    const row = settingsById.get(campaign.campaignId);
    const budgetMicros = bigintOrNull(
      row ? dig(row, ["campaignBudget", "amountMicros"]) : undefined
    );
    const targetRoas = num(row ? dig(row, ["campaign", "maximizeConversionValue", "targetRoas"]) : 0);
    const merchantId = bigintOrNull(
      row ? dig(row, ["campaign", "shoppingSetting", "merchantId"]) : undefined
    );
    const feedLabel = str(row ? dig(row, ["campaign", "shoppingSetting", "feedLabel"]) : "");
    return {
      snapshotDate,
      campaignId: BigInt(campaign.campaignId),
      campaignName: campaign.campaignName,
      status: campaign.status,
      channelType: campaign.channelType,
      budgetMicros,
      biddingStrategy: str(row ? dig(row, ["campaign", "biddingStrategyType"]) : ""),
      targetRoas: Number.isFinite(targetRoas) && targetRoas > 0 ? targetRoas : null,
      merchantId,
      feedLabel: feedLabel || null,
      listingGroupFilters: listingByCampaign.get(campaign.campaignId) ?? [],
    };
  });

  const written = await upsertCampaignSettingsDaily(snapshotRows);
  return { written, rows: snapshotRows };
}

async function syncInventorySnapshot(
  runId: string,
  onProgress?: (progress: Record<string, unknown>) => Promise<void>
) {
  const config = resolveAdsConfig();
  const offerMap = new Map<string, OfferAccumulator>();
  let accountRows = 0;
  let accountPages = 0;
  let accountRetries = 0;
  let accountRequests = 0;

  const accountIterator = searchRows(config, shoppingProductAccountScopeQuery());
  let next = await accountIterator.next();
  while (!next.done) {
    accountRows += 1;
    const mapped = mapShoppingProductCurrentRow(next.value);
    const key = shoppingOfferKey({
      merchantId: mapped.merchantId,
      channel: mapped.channel,
      languageCode: mapped.languageCode,
      feedLabel: mapped.feedLabel,
      offerId: mapped.offerId,
    });
    if (!offerMap.has(key)) {
      offerMap.set(key, {
        ...mapped,
        targetedCampaignIds: new Set<string>(),
        targetedCampaignNames: new Set<string>(),
      });
    }
    next = await accountIterator.next();
  }
  if (next.value) {
    accountPages = next.value.pages;
    accountRetries = next.value.retries;
    accountRequests = next.value.requests;
  }

  const activeCampaignRows = await searchAll(config, activeShoppingAndPmaxCampaignsQuery());
  const campaigns = activeCampaignRows.rows
    .map((row) => mapActiveCampaign(row))
    .filter((c) => c.campaignId.length > 0);
  log("inventory_sync.active_campaigns", { count: campaigns.length });

  let campaignScopeRows = 0;
  let campaignScopePages = 0;
  let campaignScopeRequests = 0;
  let campaignScopeRetries = 0;
  let campaignScopeUnmatched = 0;
  const campaignHitCounts: Array<{ campaignId: string; campaignName: string; hits: number }> = [];

  // User requested sequential campaign calls.
  for (const campaign of campaigns) {
    log("inventory_sync.campaign_scope_start", {
      campaignId: campaign.campaignId,
      campaignName: campaign.campaignName,
    });
    let hits = 0;
    const iterator = searchRows(
      config,
      shoppingProductCampaignScopeQuery(config.customerId, campaign.campaignId)
    );
    let nextCampaign = await iterator.next();
    while (!nextCampaign.done) {
      campaignScopeRows += 1;
      const row = nextCampaign.value;
      const mapped = mapShoppingCampaignScopeRow(row);
      if (!mapped.campaignName) mapped.campaignName = campaign.campaignName;
      const { matched } = addCampaignScopeHit(offerMap, mapped);
      if (matched) hits += 1;
      else campaignScopeUnmatched += 1;
      nextCampaign = await iterator.next();
    }
    if (nextCampaign.value) {
      campaignScopePages += nextCampaign.value.pages;
      campaignScopeRequests += nextCampaign.value.requests;
      campaignScopeRetries += nextCampaign.value.retries;
    }
    campaignHitCounts.push({
      campaignId: campaign.campaignId,
      campaignName: campaign.campaignName,
      hits,
    });
    if (onProgress) {
      await onProgress({
        campaignScopeProgress: {
          done: campaignHitCounts.length,
          total: campaigns.length,
          lastCampaignId: campaign.campaignId,
          lastCampaignName: campaign.campaignName,
          rows: campaignScopeRows,
        },
      });
    }
  }

  const seenAt = new Date();
  const snapshotRows = toSnapshotRows(offerMap);
  const written = await upsertShoppingProductCurrent(snapshotRows, runId, seenAt);
  const { deactivated } = await finalizeShoppingProductCurrent(runId);

  const parseable = snapshotRows.filter((r) => r.shopifyProductId != null).length;
  const withCampaign = snapshotRows.filter((r) => r.targetedCampaignIds.length > 0).length;
  const overlapOffers = snapshotRows.filter((r) => r.targetedCampaignIds.length > 1).length;
  const distinctVariants = new Set(
    snapshotRows.filter((r) => r.shopifyVariantId != null).map((r) => r.shopifyVariantId!.toString())
  ).size;
  const distinctModels = new Set(
    snapshotRows.filter((r) => r.shopifyProductId != null).map((r) => r.shopifyProductId!.toString())
  ).size;

  return {
    campaigns,
    campaignHitCounts,
    snapshotRows,
    inventoryStats: {
      accountScope: {
        pages: accountPages,
        requests: accountRequests,
        retries: accountRetries,
        rows: accountRows,
      },
      campaignScope: {
        pages: campaignScopePages,
        requests: campaignScopeRequests,
        retries: campaignScopeRetries,
        rows: campaignScopeRows,
        unmatchedRows: campaignScopeUnmatched,
      },
      offersUnique: snapshotRows.length,
      variantsUnique: distinctVariants,
      modelsUnique: distinctModels,
      parseRatePct:
        snapshotRows.length > 0 ? Number(((parseable / snapshotRows.length) * 100).toFixed(2)) : null,
      targetedOffers: withCampaign,
      notTargetedOffers: snapshotRows.length - withCampaign,
      overlapOffers,
      writtenRows: written,
      deactivatedRows: deactivated,
      durationNote: "duration in run metadata timestamps",
    },
  };
}

export async function inventorySyncCommand(): Promise<number> {
  return withSyncRun("inventory:sync", {}, async (run) => {
    const started = Date.now();
    const snapshotDate = defaultEndDate();
    const synced = await syncInventorySnapshot(run.id, async (progress) => {
      await run.setStats(progress);
    });
    const settings = await snapshotCampaignSettings(synced.campaigns, snapshotDate);

    const elapsedMs = Date.now() - started;
    const result = {
      snapshotDate,
      elapsedMs,
      inventory: synced.inventoryStats,
      activeCampaigns: synced.campaigns.length,
      campaignScopeByCampaign: synced.campaignHitCounts,
      campaignSettingsWritten: settings.written,
      errors: [],
    };
    await run.setStats(result);
    log("inventory_sync.summary", result);
    return result;
  });
}

export async function latestInventorySyncMeta(): Promise<{
  lastInventorySyncAt: string | null;
  stale: boolean;
}> {
  const row = await prisma.$queryRaw<Array<{ ts: string | null }>>(Prisma.sql`
    SELECT MAX("finished_at")::text AS ts
    FROM "public"."ads_sync_runs"
    WHERE "command" = 'inventory:sync'
      AND "status" = 'succeeded'
  `);
  const ts = row[0]?.ts ?? null;
  if (!ts) return { lastInventorySyncAt: null, stale: true };
  const ageMs = Date.now() - new Date(ts).getTime();
  return { lastInventorySyncAt: ts, stale: ageMs > 26 * 60 * 60 * 1000 };
}
