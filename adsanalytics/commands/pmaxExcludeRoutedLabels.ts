import { resolveAdsConfig } from "@/adsanalytics/config";
import {
  EXPLORER_OPS_DAILY_LIMIT,
  loadExplorerCampaignsAndListingNodes,
  planHashFromPayload,
  saveListingBackups,
  writeExplorerReport,
} from "@/adsanalytics/explorer/core";
import {
  CUSTOM_LABEL_3_INDEX,
  ROUTED_LABELS,
} from "@/adsanalytics/explorer/labels";
import {
  applyAdditionalLabelExclusions,
  applyCoreExclusionMutations,
  findSubdivisionsMissingLabelExclusion,
  summarizeTouchedLeafPaths,
  type CoreExclusionApplyResult,
} from "@/adsanalytics/google/listingGroupMutations";
import { log, withSyncRun } from "@/adsanalytics/run";

export type PmaxExcludeRoutedLabelsOptions = {
  campaignId?: string;
  labels?: string;
  validateOnly?: boolean;
  confirm?: string;
};

/**
 * Generic PMax exclusion: for an arbitrary campaign, ensure every UNIT_INCLUDED leaf
 * is protected against routed labels (explorer_active, long_tail_all).
 *
 * Two passes:
 *   A) UNIT_INCLUDED leaves not under a custom_label_3 subdivision → subdivide with
 *      all target labels UNIT_EXCLUDED + everything_else UNIT_INCLUDED.
 *   B) Existing custom_label_3 subdivisions missing a target label → add the missing
 *      UNIT_EXCLUDED sibling additively.
 *
 * Idempotent: re-running finds nothing to do once the tree is clean.
 */
export async function pmaxExcludeRoutedLabelsCommand(
  options: PmaxExcludeRoutedLabelsOptions = {}
): Promise<number> {
  return withSyncRun("pmax:exclude-routed-labels", options, async () => {
    const campaignId = options.campaignId?.trim();
    if (!campaignId) throw new Error("Missing --campaign-id=<id>");

    const labels = (options.labels?.trim() || ROUTED_LABELS.join(","))
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const l of labels) {
      if (!(ROUTED_LABELS as readonly string[]).includes(l)) {
        throw new Error(`Label ${l} not routed (${ROUTED_LABELS.join(", ")})`);
      }
    }
    const validateOnly = options.validateOnly !== false;

    const config = resolveAdsConfig();
    const listingCtx = await loadExplorerCampaignsAndListingNodes();
    const campaign = listingCtx.campaigns.find((c) => c.campaignId === campaignId);
    if (!campaign) {
      throw new Error(`Campaign not found or not ENABLED: ${campaignId}`);
    }

    const nodes = listingCtx.listingNodes.filter((n) => n.campaignId === campaignId);
    if (nodes.length === 0) {
      throw new Error(`No listing nodes for campaign ${campaignId}`);
    }

    const includedLeavesToSubdivide = nodes.filter(
      (n) =>
        n.type === "UNIT_INCLUDED" &&
        !(
          n.dimension.kind === "product_custom_attribute" &&
          n.dimension.index === CUSTOM_LABEL_3_INDEX
        )
    );

    const missingByLabel = new Map<string, ReturnType<typeof findSubdivisionsMissingLabelExclusion>>();
    for (const label of labels) {
      const missing = findSubdivisionsMissingLabelExclusion(nodes, campaignId, label);
      if (missing.length > 0) missingByLabel.set(label, missing);
    }

    const subdivideOpsEstimate = includedLeavesToSubdivide.length * (2 + labels.length);
    const extendOpsEstimate = [...missingByLabel.values()].reduce((s, arr) => s + arr.length, 0);
    const totalOps = subdivideOpsEstimate + extendOpsEstimate;

    const planPayload = {
      campaignId,
      campaignName: campaign.campaignName,
      labels: [...labels].sort(),
      subdivideLeafIds: includedLeavesToSubdivide.map((l) => l.id).sort(),
      extendByLabel: Object.fromEntries(
        [...missingByLabel.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([l, arr]) => [l, arr.map((n) => n.id).sort()])
      ),
    };
    const planHash = planHashFromPayload(planPayload);

    const blockers: string[] = [];
    if (totalOps > EXPLORER_OPS_DAILY_LIMIT) {
      blockers.push(`Plan ops ${totalOps} exceed daily limit ${EXPLORER_OPS_DAILY_LIMIT}`);
    }
    if (totalOps > 2000) {
      blockers.push(`Plan ops ${totalOps} exceed 2000 hard cap`);
    }

    const touchedLeafPaths = summarizeTouchedLeafPaths(
      nodes,
      includedLeavesToSubdivide.map((n) => n.id)
    );

    let applied = false;
    let backup: Awaited<ReturnType<typeof saveListingBackups>> | null = null;
    let subdivideResult: CoreExclusionApplyResult | null = null;
    const extendResults: Record<string, CoreExclusionApplyResult> = {};

    if (totalOps === 0) {
      log("pmax_exclude_routed_labels.noop", {
        campaignId,
        campaignName: campaign.campaignName,
        labels,
      });
    } else if (validateOnly) {
      if (includedLeavesToSubdivide.length > 0) {
        subdivideResult = await applyCoreExclusionMutations(
          config,
          nodes,
          includedLeavesToSubdivide.map((l) => l.id),
          { validateOnlyFirst: true, validateOnly: true }
        );
      }
      for (const [label, missing] of missingByLabel.entries()) {
        extendResults[label] = await applyAdditionalLabelExclusions(config, missing, label, {
          validateOnlyFirst: true,
          validateOnly: true,
        });
      }
    } else {
      const confirm = options.confirm?.trim();
      if (!confirm) throw new Error("Missing --confirm=<planHash> for non validate-only run");
      if (confirm !== planHash) {
        throw new Error(`Confirm hash mismatch. Expected ${planHash}, got ${confirm}`);
      }
      if (blockers.length > 0) throw new Error(`Blocked: ${blockers.join("; ")}`);

      backup = await saveListingBackups(
        `pmax-exclude-${campaign.campaignName}-${labels.join("_")}`,
        nodes
      );

      if (includedLeavesToSubdivide.length > 0) {
        subdivideResult = await applyCoreExclusionMutations(
          config,
          nodes,
          includedLeavesToSubdivide.map((l) => l.id),
          { validateOnlyFirst: true }
        );
        if (!subdivideResult.perAssetGroup.every((g) => g.applied && !g.error)) {
          const failed = subdivideResult.perAssetGroup.filter((g) => !g.applied || g.error);
          throw new Error(
            `Subdivide pass failed: ${failed.map((g) => `${g.assetGroupId}:${g.error ?? "not applied"}`).join("; ")}`
          );
        }
      }
      for (const [label, missing] of missingByLabel.entries()) {
        const res = await applyAdditionalLabelExclusions(config, missing, label, {
          validateOnlyFirst: true,
        });
        extendResults[label] = res;
        if (!res.perAssetGroup.every((g) => g.applied && !g.error)) {
          const failed = res.perAssetGroup.filter((g) => !g.applied || g.error);
          throw new Error(
            `Extend pass for ${label} failed: ${failed.map((g) => `${g.assetGroupId}:${g.error ?? "not applied"}`).join("; ")}`
          );
        }
      }
      applied = true;
    }

    let remainingAfterApply: {
      leavesToSubdivide: number;
      missingByLabel: Record<string, number>;
    } | null = null;
    if (applied) {
      const refreshed = await loadExplorerCampaignsAndListingNodes();
      const refreshedNodes = refreshed.listingNodes.filter((n) => n.campaignId === campaignId);
      const leavesToSubdivide = refreshedNodes.filter(
        (n) =>
          n.type === "UNIT_INCLUDED" &&
          !(
            n.dimension.kind === "product_custom_attribute" &&
            n.dimension.index === CUSTOM_LABEL_3_INDEX
          )
      ).length;
      const missing: Record<string, number> = {};
      for (const label of labels) {
        missing[label] = findSubdivisionsMissingLabelExclusion(
          refreshedNodes,
          campaignId,
          label
        ).length;
      }
      remainingAfterApply = { leavesToSubdivide, missingByLabel: missing };
    }

    const report = {
      campaignId,
      campaignName: campaign.campaignName,
      labels,
      validateOnly,
      planHash,
      blockers,
      leavesToSubdivide: includedLeavesToSubdivide.length,
      missingByLabel: Object.fromEntries(
        [...missingByLabel.entries()].map(([l, arr]) => [l, arr.length])
      ),
      totalOps,
      touchedLeafPaths,
      applied,
      backup,
      subdivideResult,
      extendResults,
      remainingAfterApply,
    };
    const safeName = campaign.campaignName.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const outPath = await writeExplorerReport(
      `pmax-exclude-${safeName}-${labels.join("_")}.json`,
      report
    );

    log("pmax_exclude_routed_labels.summary", {
      campaignId,
      campaignName: campaign.campaignName,
      labels,
      validateOnly,
      planHash,
      leavesToSubdivide: includedLeavesToSubdivide.length,
      totalOps,
      applied,
      blockers,
      remainingAfterApply,
      reportPath: outPath,
    });

    return {
      campaignId,
      campaignName: campaign.campaignName,
      labels,
      validateOnly,
      planHash,
      leavesToSubdivide: includedLeavesToSubdivide.length,
      missingByLabel: Object.fromEntries(
        [...missingByLabel.entries()].map(([l, arr]) => [l, arr.length])
      ),
      totalOps,
      applied,
      blockers,
      remainingAfterApply,
      reportPath: outPath,
    };
  });
}
