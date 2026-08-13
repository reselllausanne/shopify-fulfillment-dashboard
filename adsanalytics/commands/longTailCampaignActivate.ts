import { resolveAdsConfig } from "@/adsanalytics/config";
import { fetchCampaignFacts } from "@/adsanalytics/explorer/campaignInspect";
import { loadCampaignRegistry, requireCampaign } from "@/adsanalytics/explorer/campaignRegistry";
import { planHashFromPayload, writeExplorerReport } from "@/adsanalytics/explorer/core";
import { EXPLORER_ACTIVE_LABEL, LONG_TAIL_ALL_LABEL } from "@/adsanalytics/explorer/labels";
import {
  enableExplorerAdGroup,
  enableExplorerAdGroupAd,
  enableExplorerCampaign,
} from "@/adsanalytics/google/explorerCampaignMutations";
import { log, withSyncRun } from "@/adsanalytics/run";

export type LongTailCampaignActivateOptions = {
  validateOnly?: boolean;
  confirm?: string;
};

/**
 * Long Tail All must be serving before the reconciler routes anything to it: a model that
 * leaves Explorer is already excluded from the core campaign, so a paused destination
 * would silently remove it from every campaign.
 */
export async function longTailCampaignActivateCommand(
  options: LongTailCampaignActivateOptions = {}
): Promise<number> {
  return withSyncRun("longtail:campaign:activate", options, async () => {
    const validateOnly = options.validateOnly !== false;
    const registry = await loadCampaignRegistry();
    const row = await requireCampaign(registry, "LONG_TAIL_ALL");

    const config = resolveAdsConfig();
    const facts = (await fetchCampaignFacts(config, [row.campaignId])).get(row.campaignId);
    if (!facts) throw new Error(`Campaign ${row.campaignId} not found in account ${config.customerId}`);

    const blockers: string[] = [];
    if (!facts.includedCustomLabel3.includes(LONG_TAIL_ALL_LABEL)) {
      blockers.push(`campaign does not include custom_label_3=${LONG_TAIL_ALL_LABEL}`);
    }
    if (facts.includedCustomLabel3.includes(EXPLORER_ACTIVE_LABEL)) {
      blockers.push(`campaign also includes ${EXPLORER_ACTIVE_LABEL}, which would overlap Explorer`);
    }
    if (!facts.adGroupResourceName) blockers.push("campaign has no ad group");
    if (!facts.adGroupAdResourceName) blockers.push("campaign has no shopping ad");

    const planHash = planHashFromPayload({
      role: "LONG_TAIL_ALL",
      campaignId: row.campaignId,
      includeLabel: LONG_TAIL_ALL_LABEL,
      target: "ENABLED",
    });

    let applied = false;
    if (!validateOnly) {
      if (blockers.length > 0) {
        throw new Error(`Refusing to activate Long Tail All: ${blockers.join("; ")}`);
      }
      const confirm = options.confirm?.trim();
      if (!confirm) throw new Error("Missing --confirm=<planHash> for non validate-only run");
      if (confirm !== planHash) {
        throw new Error(`Confirm hash mismatch. Expected ${planHash}, got ${confirm}`);
      }
      await enableExplorerCampaign(config, facts.campaignResourceName);
      await enableExplorerAdGroup(config, facts.adGroupResourceName!);
      await enableExplorerAdGroupAd(config, facts.adGroupAdResourceName!);
      applied = true;
    }

    const after = applied
      ? ((await fetchCampaignFacts(config, [row.campaignId])).get(row.campaignId) ?? null)
      : null;

    const report = {
      validateOnly,
      planHash,
      applied,
      blockers,
      campaignId: row.campaignId,
      campaignName: facts.campaignName,
      before: {
        campaignStatus: facts.status,
        adGroupStatus: facts.adGroupStatus,
        budgetMicros: facts.budgetMicros,
        maxCpcMicros: facts.maxCpcMicros,
        includedCustomLabel3: facts.includedCustomLabel3,
      },
      after: after && {
        campaignStatus: after.status,
        adGroupStatus: after.adGroupStatus,
      },
    };
    const outPath = await writeExplorerReport("longtail-campaign-activate.json", report);
    log("longtail_campaign_activate.summary", {
      validateOnly,
      planHash,
      applied,
      blockers,
      campaignId: row.campaignId,
      campaignStatus: after?.status ?? facts.status,
      adGroupStatus: after?.adGroupStatus ?? facts.adGroupStatus,
      reportPath: outPath,
    });
    return { validateOnly, planHash, applied, blockers, reportPath: outPath };
  });
}
