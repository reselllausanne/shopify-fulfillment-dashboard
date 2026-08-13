import { resolveAdsConfig } from "@/adsanalytics/config";
import { fetchCampaignFacts } from "@/adsanalytics/explorer/campaignInspect";
import {
  loadCampaignRegistry,
  upsertCampaignRegistry,
} from "@/adsanalytics/explorer/campaignRegistry";
import { writeExplorerReport } from "@/adsanalytics/explorer/core";
import { DESTINATIONS, isDestination, labelForDestination } from "@/adsanalytics/explorer/destinations";
import { ROUTED_LABELS } from "@/adsanalytics/explorer/labels";
import { log, withSyncRun } from "@/adsanalytics/run";

export type ExplorerCampaignRegisterOptions = {
  role?: string;
  campaignId?: string;
  force?: boolean;
};

/**
 * Bind an existing Google Ads campaign to a routing role so the reconciler, the metric
 * sync and the overlap proof all resolve the same ids. Registration is refused when the
 * campaign does not actually target the role label, because a wrong mapping would make
 * the overlap proof report exclusivity that does not exist in Ads.
 */
export async function explorerCampaignRegisterCommand(
  options: ExplorerCampaignRegisterOptions = {}
): Promise<number> {
  return withSyncRun("explorer:campaign:register", options, async () => {
    const role = options.role?.trim().toUpperCase();
    if (!isDestination(role)) {
      throw new Error(`Missing or invalid --role. Expected one of ${DESTINATIONS.join(", ")}`);
    }
    const campaignId = options.campaignId?.trim();
    if (!campaignId) throw new Error("Missing --campaign-id=<googleCampaignId>");

    const config = resolveAdsConfig();
    const facts = (await fetchCampaignFacts(config, [campaignId])).get(campaignId);
    if (!facts) throw new Error(`Campaign ${campaignId} not found in account ${config.customerId}`);

    const registry = await loadCampaignRegistry();
    const conflictingRole = [...registry.entries()].find(
      ([existingRole, row]) => row.campaignId === campaignId && existingRole !== role
    );
    if (conflictingRole) {
      throw new Error(
        `Campaign ${campaignId} is already registered as ${conflictingRole[0]}. One campaign cannot serve two routing roles.`
      );
    }
    const currentForRole = registry.get(role);
    if (currentForRole && currentForRole.campaignId !== campaignId && !options.force) {
      throw new Error(
        `Role ${role} is already mapped to campaign ${currentForRole.campaignId}. Re-run with --force to remap.`
      );
    }

    const includeLabel = labelForDestination(role);
    const mismatches: string[] = [];
    if (includeLabel) {
      if (!facts.includedCustomLabel3.includes(includeLabel)) {
        mismatches.push(
          `campaign does not include custom_label_3=${includeLabel} (included: ${facts.includedCustomLabel3.join(", ") || "none"})`
        );
      }
      const foreignLabels = facts.includedCustomLabel3.filter(
        (value) => value !== includeLabel && (ROUTED_LABELS as readonly string[]).includes(value)
      );
      if (foreignLabels.length > 0) {
        mismatches.push(`campaign also includes routed labels: ${foreignLabels.join(", ")}`);
      }
    } else {
      const routedIncluded = facts.includedCustomLabel3.filter((value) =>
        (ROUTED_LABELS as readonly string[]).includes(value)
      );
      if (routedIncluded.length > 0) {
        mismatches.push(`CORE_ALL campaign includes routed labels: ${routedIncluded.join(", ")}`);
      }
      const missingExclusions = ROUTED_LABELS.filter(
        (label) => !facts.excludedCustomLabel3.includes(label)
      );
      if (missingExclusions.length > 0) {
        mismatches.push(`CORE_ALL campaign does not exclude: ${missingExclusions.join(", ")}`);
      }
    }

    const registered = mismatches.length === 0 || options.force === true;
    if (registered) {
      await upsertCampaignRegistry({
        role,
        campaignId,
        campaignName: facts.campaignName,
        campaignResourceName: facts.campaignResourceName,
        adGroupId: facts.adGroupId,
        adGroupResourceName: facts.adGroupResourceName,
        adGroupAdResourceName: facts.adGroupAdResourceName,
        budgetResourceName: facts.budgetResourceName,
        includeLabel,
        statsJson: {
          registeredAt: new Date().toISOString(),
          status: facts.status,
          channelType: facts.channelType,
          biddingStrategyType: facts.biddingStrategyType,
          merchantId: facts.merchantId,
          feedLabel: facts.feedLabel,
          budgetMicros: facts.budgetMicros,
          maxCpcMicros: facts.maxCpcMicros,
          endDateTime: facts.endDateTime,
          includedCustomLabel3: facts.includedCustomLabel3,
          excludedCustomLabel3: facts.excludedCustomLabel3,
          forcedDespiteMismatches: mismatches.length > 0 ? mismatches : undefined,
        },
      });
    }

    const finalRegistry = await loadCampaignRegistry();
    const report = {
      role,
      campaignId,
      campaignName: facts.campaignName,
      includeLabel,
      registered,
      mismatches,
      campaignFacts: facts,
      registry: Object.fromEntries(finalRegistry),
      missingRoles: DESTINATIONS.filter((d) => !finalRegistry.has(d)),
    };
    const outPath = await writeExplorerReport("explorer-campaign-registry.json", report);
    log("explorer_campaign_register.summary", {
      role,
      campaignId,
      campaignName: facts.campaignName,
      registered,
      mismatches,
      missingRoles: report.missingRoles,
      reportPath: outPath,
    });
    if (!registered) {
      throw new Error(
        `Refusing to register ${campaignId} as ${role}: ${mismatches.join("; ")}. Fix the listing tree or re-run with --force.`
      );
    }
    return { role, campaignId, campaignName: facts.campaignName, missingRoles: report.missingRoles, reportPath: outPath };
  });
}
