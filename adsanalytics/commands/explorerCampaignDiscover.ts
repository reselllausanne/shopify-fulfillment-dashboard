import { resolveAdsConfig } from "@/adsanalytics/config";
import { fetchCampaignFacts, listShoppingCampaignIds } from "@/adsanalytics/explorer/campaignInspect";
import { loadCampaignRegistry } from "@/adsanalytics/explorer/campaignRegistry";
import { writeExplorerReport } from "@/adsanalytics/explorer/core";
import { DESTINATIONS, labelForDestination } from "@/adsanalytics/explorer/destinations";
import type { Destination } from "@/adsanalytics/explorer/destinations";
import { log, withSyncRun } from "@/adsanalytics/run";

export type ExplorerCampaignDiscoverOptions = {
  role?: string;
  name?: string;
};

/**
 * Answers "does a campaign for this role already exist in Ads?" before anything is created.
 * A campaign qualifies for a role when its listing tree actually includes the role label;
 * a name match alone is only a hint, because names drift from what they target.
 */
export async function explorerCampaignDiscoverCommand(
  options: ExplorerCampaignDiscoverOptions = {}
): Promise<number> {
  return withSyncRun("explorer:campaign:discover", options, async () => {
    const config = resolveAdsConfig();
    const registry = await loadCampaignRegistry();
    const campaignIds = await listShoppingCampaignIds(config);
    const facts = await fetchCampaignFacts(config, campaignIds);

    const registeredByCampaignId = new Map<string, Destination>();
    for (const [role, row] of registry) registeredByCampaignId.set(row.campaignId, role);

    const nameFilter = options.name?.trim().toLowerCase();
    const campaigns = [...facts.values()]
      .filter((c) => !nameFilter || c.campaignName.toLowerCase().includes(nameFilter))
      .map((c) => ({
        ...c,
        registeredRole: registeredByCampaignId.get(c.campaignId) ?? null,
        matchesRoleByLabel: DESTINATIONS.filter((role) => {
          const label = labelForDestination(role);
          return label !== null && c.includedCustomLabel3.includes(label);
        }),
      }));

    const roles = (options.role ? [options.role.trim().toUpperCase()] : [...DESTINATIONS]).filter(
      (role): role is Destination => (DESTINATIONS as readonly string[]).includes(role)
    );

    const roleFindings = roles.map((role) => {
      const label = labelForDestination(role);
      const registered = registry.get(role) ?? null;
      const byLabel = campaigns.filter((c) => c.matchesRoleByLabel.includes(role));
      const nameHints = label
        ? campaigns.filter(
            (c) =>
              !byLabel.some((m) => m.campaignId === c.campaignId) &&
              c.campaignName.toLowerCase().includes(label.replace(/_/g, " ").replace(" all", ""))
          )
        : [];
      return {
        role,
        includeLabel: label,
        registeredCampaignId: registered?.campaignId ?? null,
        campaignsTargetingLabel: byLabel.map((c) => ({
          campaignId: c.campaignId,
          campaignName: c.campaignName,
          status: c.status,
          registeredRole: c.registeredRole,
        })),
        nameOnlyHints: nameHints.map((c) => ({
          campaignId: c.campaignId,
          campaignName: c.campaignName,
          status: c.status,
          registeredRole: c.registeredRole,
          includedCustomLabel3: c.includedCustomLabel3,
        })),
        recommendation: registered
          ? "already_registered"
          : byLabel.length === 1
            ? `register: npm run ads -- explorer:campaign:register --role=${role} --campaign-id=${byLabel[0]?.campaignId}`
            : byLabel.length > 1
              ? "ambiguous_multiple_campaigns_target_label"
              : "no_campaign_targets_this_label",
      };
    });

    const report = {
      customerId: config.customerId,
      shoppingCampaignCount: campaignIds.length,
      campaigns,
      roleFindings,
    };
    const outPath = await writeExplorerReport("explorer-campaign-discover.json", report);
    log("explorer_campaign_discover.summary", {
      shoppingCampaignCount: campaignIds.length,
      roleFindings: roleFindings.map((f) => ({
        role: f.role,
        registeredCampaignId: f.registeredCampaignId,
        targeting: f.campaignsTargetingLabel.map((c) => c.campaignId),
        recommendation: f.recommendation,
      })),
      reportPath: outPath,
    });
    return { roleFindings, reportPath: outPath };
  });
}
