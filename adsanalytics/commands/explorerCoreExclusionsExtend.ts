import { resolveAdsConfig } from "@/adsanalytics/config";
import { loadCampaignRegistry } from "@/adsanalytics/explorer/campaignRegistry";
import {
  EXPLORER_OPS_DAILY_LIMIT,
  loadExplorerCampaignsAndListingNodes,
  planHashFromPayload,
  saveListingBackups,
  writeExplorerReport,
} from "@/adsanalytics/explorer/core";
import { LONG_TAIL_ALL_LABEL, ROUTED_LABELS } from "@/adsanalytics/explorer/labels";
import {
  applyAdditionalLabelExclusions,
  findSubdivisionsMissingLabelExclusion,
  summarizeTouchedLeafPaths,
} from "@/adsanalytics/google/listingGroupMutations";
import { log, withSyncRun } from "@/adsanalytics/run";

export type ExplorerCoreExclusionsExtendOptions = {
  label?: string;
  validateOnly?: boolean;
  confirm?: string;
  batch?: string;
};

/**
 * The core campaign must exclude every routed label. The first core-exclusions pass only
 * excluded explorer_active, so this adds the missing UNIT_EXCLUDED siblings additively
 * instead of rebuilding the subdivisions.
 */
export async function explorerCoreExclusionsExtendCommand(
  options: ExplorerCoreExclusionsExtendOptions = {}
): Promise<number> {
  return withSyncRun("explorer:core-exclusions:extend", options, async () => {
    const label = (options.label ?? LONG_TAIL_ALL_LABEL).trim();
    if (!(ROUTED_LABELS as readonly string[]).includes(label)) {
      throw new Error(`Label ${label} is not a routed label (${ROUTED_LABELS.join(", ")})`);
    }
    const validateOnly = options.validateOnly !== false;

    const registry = await loadCampaignRegistry();
    const core = registry.get("CORE_ALL");
    if (!core) {
      throw new Error(
        "CORE_ALL campaign is not registered. Run explorer:campaign:register --role=CORE_ALL first."
      );
    }

    const config = resolveAdsConfig();
    const listingCtx = await loadExplorerCampaignsAndListingNodes();
    const targets = findSubdivisionsMissingLabelExclusion(
      listingCtx.listingNodes,
      core.campaignId,
      label
    );
    const touchedPaths = summarizeTouchedLeafPaths(
      listingCtx.listingNodes,
      targets.map((t) => t.id)
    );
    const touchedCampaigns = [...new Set(targets.map((t) => t.campaignId))];

    const blockers: string[] = [];
    if (touchedCampaigns.some((id) => id !== core.campaignId)) {
      blockers.push(
        `Plan would touch campaigns other than CORE_ALL: ${touchedCampaigns.join(", ")}`
      );
    }
    if (targets.length > EXPLORER_OPS_DAILY_LIMIT) {
      blockers.push(`Plan exceeds the daily Ads operation limit (${targets.length})`);
    }

    const planPayload = {
      role: "CORE_ALL",
      campaignId: core.campaignId,
      label,
      subdivisionIds: targets.map((t) => t.id).sort(),
    };
    const planHash = planHashFromPayload(planPayload);

    let applied = false;
    let mutation: Awaited<ReturnType<typeof applyAdditionalLabelExclusions>> | null = null;
    let backup: Awaited<ReturnType<typeof saveListingBackups>> | null = null;

    if (targets.length === 0) {
      log("explorer_core_exclusions_extend.noop", { campaignId: core.campaignId, label });
    } else if (validateOnly) {
      mutation = await applyAdditionalLabelExclusions(config, targets, label, {
        validateOnlyFirst: true,
        validateOnly: true,
      });
    } else {
      const confirm = options.confirm?.trim();
      if (!confirm) throw new Error("Missing --confirm=<planHash> for non validate-only run");
      if (confirm !== planHash) {
        throw new Error(`Confirm hash mismatch. Expected ${planHash}, got ${confirm}`);
      }
      if (blockers.length > 0) {
        throw new Error(`Refusing to apply with blockers: ${blockers.join(" | ")}`);
      }
      backup = await saveListingBackups(
        options.batch?.trim() || `core-exclusions-extend-${label}`,
        listingCtx.listingNodes.filter((n) => n.campaignId === core.campaignId)
      );
      mutation = await applyAdditionalLabelExclusions(config, targets, label, {
        validateOnlyFirst: true,
      });
      applied = mutation.perAssetGroup.every((g) => g.applied && !g.error);
      if (!applied) {
        throw new Error(
          `Mutation incomplete: ${JSON.stringify(mutation.perAssetGroup.filter((g) => !g.applied || g.error))}`
        );
      }
    }

    const refreshed = applied ? await loadExplorerCampaignsAndListingNodes() : null;
    const remaining = refreshed
      ? findSubdivisionsMissingLabelExclusion(refreshed.listingNodes, core.campaignId, label).length
      : null;

    const report = {
      campaignId: core.campaignId,
      campaignName: core.campaignName,
      label,
      validateOnly,
      planHash,
      blockers,
      subdivisionsToExtend: targets.length,
      touchedCampaigns,
      touchedPaths,
      applied,
      mutation,
      backup,
      remainingAfterApply: remaining,
    };
    const outPath = await writeExplorerReport(
      `explorer-core-exclusions-extend-${label}.json`,
      report
    );
    log("explorer_core_exclusions_extend.summary", {
      campaignId: core.campaignId,
      label,
      validateOnly,
      planHash,
      subdivisionsToExtend: targets.length,
      applied,
      remainingAfterApply: remaining,
      blockers,
      reportPath: outPath,
    });
    return {
      campaignId: core.campaignId,
      label,
      validateOnly,
      planHash,
      subdivisionsToExtend: targets.length,
      applied,
      blockers,
      reportPath: outPath,
    };
  });
}
