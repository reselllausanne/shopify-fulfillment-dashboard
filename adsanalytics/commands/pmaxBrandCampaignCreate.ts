import { resolveAdsConfig } from "@/adsanalytics/config";
import { planHashFromPayload, writeExplorerReport } from "@/adsanalytics/explorer/core";
import { googleAdsMutate, searchAll } from "@/adsanalytics/google/adsClient";
import {
  buildPmaxBrandCampaignMutateOperations,
  createPmaxBrandCampaign,
  defaultUggPmaxSpec,
  type PmaxBrandCampaignSpec,
} from "@/adsanalytics/google/pmaxBrandCampaignMutations";
import { pmaxCampaignSettingsQuery } from "@/adsanalytics/google/queries";
import { log, withSyncRun } from "@/adsanalytics/run";

export type PmaxBrandCampaignCreateOptions = {
  brand?: string;
  name?: string;
  budgetMicros?: number;
  targetRoas?: number;
  validateOnly?: boolean;
  confirm?: string;
  paused?: boolean;
};

function asString(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return "";
}

export async function pmaxBrandCampaignCreateCommand(
  options: PmaxBrandCampaignCreateOptions = {}
): Promise<number> {
  return withSyncRun("pmax:brand-campaign:create", options, async () => {
    const validateOnly = options.validateOnly !== false;
    const brand = (options.brand ?? "ugg").trim().toLowerCase();
    const campaignName =
      options.name?.trim() ||
      (brand === "ugg" ? "UGG PM Feed Only" : `${brand.toUpperCase()} PM Feed Only`);

    const spec: PmaxBrandCampaignSpec = defaultUggPmaxSpec({
      campaignName,
      brand,
      budgetMicros: options.budgetMicros ?? 100_000_000,
      targetRoas: options.targetRoas ?? 5.0,
      status: options.paused ? "PAUSED" : "ENABLED",
    });

    const config = resolveAdsConfig();
    const existing = await searchAll(config, pmaxCampaignSettingsQuery());
    const duplicate = existing.rows.find((row) => {
      const name = asString(row, "campaign.name");
      return name.toLowerCase() === campaignName.toLowerCase();
    });
    if (duplicate && !validateOnly) {
      throw new Error(
        `Campaign already exists: ${asString(duplicate, "campaign.name")} (${asString(duplicate, "campaign.id")})`
      );
    }

    const planHash = planHashFromPayload({ kind: "pmax-brand", spec });
    let createResult: Awaited<ReturnType<typeof createPmaxBrandCampaign>> | null = null;
    let applied = false;

    if (!validateOnly) {
      const confirm = options.confirm?.trim();
      if (!confirm) throw new Error("Missing --confirm=<planHash> for live create");
      if (confirm !== planHash) {
        throw new Error(`Confirm hash mismatch. Expected ${planHash}, got ${confirm}`);
      }
      createResult = await createPmaxBrandCampaign(config, spec, { validateOnlyFirst: true });
      applied = true;
    } else {
      const { mutateOperations } = await buildPmaxBrandCampaignMutateOperations(config, spec);
      const dry = await googleAdsMutate(config, mutateOperations, {
        validateOnly: true,
        partialFailure: false,
      });
      if (dry.partialFailureError) {
        throw new Error(`validate_only failed: ${JSON.stringify(dry.partialFailureError)}`);
      }
    }

    const report = {
      validateOnly,
      planHash,
      applied,
      spec,
      createResult,
      catalogNote:
        brand === "ugg"
          ? "~589 UGG models / ~12.7k offers in Merchant snapshot (mostly sneakers/footwear)."
          : null,
      nextSteps: applied
        ? [
            `npm run ads -- pmax:exclude-routed-labels --campaign-id=${createResult?.campaignId} --validate-only`,
            "Optional: register in weekly explorer sources once Explorer Shopping exists.",
          ]
        : [`npm run ads -- pmax:brand-campaign:create --brand=${brand} --confirm=${planHash}`],
    };
    const outPath = await writeExplorerReport(`pmax-brand-campaign-create-${brand}.json`, report);
    log("pmax_brand_campaign_create.summary", {
      brand,
      validateOnly,
      planHash,
      applied,
      campaignId: createResult?.campaignId ?? null,
      reportPath: outPath,
    });
    return { brand, validateOnly, planHash, applied, reportPath: outPath };
  });
}
