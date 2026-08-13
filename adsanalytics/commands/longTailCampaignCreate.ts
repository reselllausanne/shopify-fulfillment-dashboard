import { resolveAdsConfig } from "@/adsanalytics/config";
import { fetchCampaignFacts, listShoppingCampaignIds } from "@/adsanalytics/explorer/campaignInspect";
import {
  loadCampaignRegistry,
  upsertCampaignRegistry,
} from "@/adsanalytics/explorer/campaignRegistry";
import {
  EXPLORER_DEFAULT_FEED_LABEL,
  EXPLORER_DEFAULT_MAX_CPC_MICROS,
  EXPLORER_DEFAULT_MERCHANT_ID,
  planHashFromPayload,
  writeExplorerReport,
} from "@/adsanalytics/explorer/core";
import { LONG_TAIL_ALL_LABEL } from "@/adsanalytics/explorer/labels";
import { createExplorerShoppingCampaign } from "@/adsanalytics/google/explorerCampaignMutations";
import { log, withSyncRun } from "@/adsanalytics/run";

export type LongTailCampaignCreateOptions = {
  budgetMicros?: number;
  maxCpcMicros?: number;
  validateOnly?: boolean;
  confirm?: string;
};

export const LONG_TAIL_CAMPAIGN_NAME = "Long Tail | All | CH";
const LONG_TAIL_DEFAULT_BUDGET_MICROS = 20_000_000;

/**
 * Long Tail All is the permanent home for models that left Explorer without proving
 * demand: Standard Shopping, manual CPC, no end date, and a listing tree that includes
 * custom_label_3=long_tail_all only.
 */
export async function longTailCampaignCreateCommand(
  options: LongTailCampaignCreateOptions = {}
): Promise<number> {
  return withSyncRun("longtail:campaign:create", options, async () => {
    const validateOnly = options.validateOnly !== false;
    const registry = await loadCampaignRegistry();
    const existing = registry.get("LONG_TAIL_ALL");

    const config = resolveAdsConfig();
    const shoppingCampaignIds = await listShoppingCampaignIds(config);
    const facts = await fetchCampaignFacts(config, shoppingCampaignIds);
    const adoptable = [...facts.values()].filter((c) =>
      c.includedCustomLabel3.includes(LONG_TAIL_ALL_LABEL)
    );

    const spec = {
      campaignName: LONG_TAIL_CAMPAIGN_NAME,
      type: "STANDARD_SHOPPING",
      bidding: "MANUAL_CPC",
      budgetMicros: options.budgetMicros ?? LONG_TAIL_DEFAULT_BUDGET_MICROS,
      maxCpcMicros: options.maxCpcMicros ?? Number(EXPLORER_DEFAULT_MAX_CPC_MICROS),
      merchantId: EXPLORER_DEFAULT_MERCHANT_ID,
      feedLabel: EXPLORER_DEFAULT_FEED_LABEL,
      country: "CH",
      endAfterDays: null,
      adGroupName: "Long Tail Products",
      listingGroup: {
        rootSubdivision: "custom_label_3",
        includeValue: LONG_TAIL_ALL_LABEL,
        include: "INCLUDED",
        everythingElse: "EXCLUDED",
      },
      statusOnCreate: "PAUSED",
      targetRoas: null,
      assets: "none",
    };
    const planHash = planHashFromPayload({ role: "LONG_TAIL_ALL", spec });

    const duplicateBlockers: string[] = [];
    if (existing) {
      duplicateBlockers.push(
        `role LONG_TAIL_ALL already registered as campaign ${existing.campaignId} (${existing.campaignName})`
      );
    }
    for (const candidate of adoptable) {
      duplicateBlockers.push(
        `campaign ${candidate.campaignId} (${candidate.campaignName}) already includes custom_label_3=${LONG_TAIL_ALL_LABEL}`
      );
    }
    const attachSuggestion =
      existing || adoptable.length === 0
        ? null
        : `npm run ads -- explorer:campaign:register --role=LONG_TAIL_ALL --campaign-id=${adoptable[0]?.campaignId}`;

    let applied = false;
    let createResult: Awaited<ReturnType<typeof createExplorerShoppingCampaign>> | null = null;

    if (duplicateBlockers.length > 0 && !validateOnly) {
      throw new Error(
        `Refusing to create a duplicate Long Tail All campaign: ${duplicateBlockers.join("; ")}.` +
          (attachSuggestion ? ` Attach the existing one instead: ${attachSuggestion}` : "")
      );
    }

    if (!validateOnly) {
      const confirm = options.confirm?.trim();
      if (!confirm) throw new Error("Missing --confirm=<planHash> for non validate-only run");
      if (confirm !== planHash) {
        throw new Error(`Confirm hash mismatch. Expected ${planHash}, got ${confirm}`);
      }

      createResult = await createExplorerShoppingCampaign(
        config,
        {
          campaignName: spec.campaignName,
          budgetMicros: spec.budgetMicros,
          maxCpcMicros: spec.maxCpcMicros,
          merchantId: spec.merchantId,
          feedLabel: spec.feedLabel,
          endAfterDays: null,
          adGroupName: spec.adGroupName,
          includeLabel: LONG_TAIL_ALL_LABEL,
        },
        { validateOnlyFirst: true }
      );
      applied = true;

      await upsertCampaignRegistry({
        role: "LONG_TAIL_ALL",
        campaignId: createResult.campaignId,
        campaignName: spec.campaignName,
        campaignResourceName: createResult.campaignResourceName,
        adGroupId: createResult.adGroupId,
        adGroupResourceName: createResult.adGroupResourceName,
        adGroupAdResourceName: createResult.adGroupAdResourceName,
        budgetResourceName: createResult.budgetResourceName,
        includeLabel: LONG_TAIL_ALL_LABEL,
        statsJson: { createPlanHash: planHash, createdAt: new Date().toISOString(), spec },
      });
    }

    const action = duplicateBlockers.length > 0 ? "attach_existing" : "create_new";
    const report = {
      validateOnly,
      planHash,
      applied,
      action,
      duplicateBlockers,
      attachSuggestion,
      existingCampaignId: existing?.campaignId ?? null,
      adoptableCampaigns: adoptable.map((c) => ({
        campaignId: c.campaignId,
        campaignName: c.campaignName,
        status: c.status,
        includedCustomLabel3: c.includedCustomLabel3,
      })),
      createResult,
      campaignSpec: spec,
      note:
        duplicateBlockers.length > 0
          ? "A Long Tail All campaign already exists or is registered; create is refused, attach instead."
          : validateOnly
            ? "validate_only checks the deterministic spec only; no Ads mutation."
            : "Long Tail All created PAUSED. Activate only after the zero overlap proof passes.",
    };
    const outPath = await writeExplorerReport("longtail-campaign-create.json", report);
    log("longtail_campaign_create.summary", {
      validateOnly,
      planHash,
      applied,
      action,
      duplicateBlockers,
      attachSuggestion,
      campaignId: createResult?.campaignId ?? existing?.campaignId ?? null,
      reportPath: outPath,
    });
    return { validateOnly, planHash, applied, action, duplicateBlockers, reportPath: outPath };
  });
}
