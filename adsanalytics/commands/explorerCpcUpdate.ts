import { resolveAdsConfig } from "@/adsanalytics/config";
import {
  EXPLORER_DEFAULT_MAX_CPC_MICROS,
  planHashFromPayload,
  writeExplorerReport,
} from "@/adsanalytics/explorer/core";
import {
  listExplorerShoppingCampaignIds,
  updateExplorerShoppingMaxCpc,
} from "@/adsanalytics/google/explorerCampaignMutations";
import { log, withSyncRun } from "@/adsanalytics/run";
import { Prisma } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";

export type ExplorerCpcUpdateOptions = {
  maxCpcMicros?: number;
  validateOnly?: boolean;
  confirm?: string;
};

export async function explorerCpcUpdateCommand(
  options: ExplorerCpcUpdateOptions = {}
): Promise<number> {
  return withSyncRun("explorer:cpc:update", options, async () => {
    const validateOnly = options.validateOnly !== false;
    const maxCpcMicros = options.maxCpcMicros ?? EXPLORER_DEFAULT_MAX_CPC_MICROS;
    const config = resolveAdsConfig();
    const campaigns = await listExplorerShoppingCampaignIds(config);

    if (campaigns.length === 0) {
      throw new Error('No live Shopping campaigns matching name "Explorer%"');
    }

    const planHash = planHashFromPayload({
      maxCpcMicros,
      campaignIds: campaigns.map((c) => c.campaignId).sort(),
    });

    const results: Array<{
      campaignId: string;
      campaignName: string;
      adGroupUpdates: number;
      criterionUpdates: number;
    }> = [];

    if (!validateOnly) {
      const confirm = options.confirm?.trim();
      if (!confirm) throw new Error("Missing --confirm=<planHash> for live CPC update");
      if (confirm !== planHash) {
        throw new Error(`Confirm hash mismatch. Expected ${planHash}, got ${confirm}`);
      }
    }

    for (const campaign of campaigns) {
      const updated = await updateExplorerShoppingMaxCpc(
        config,
        campaign.campaignId,
        maxCpcMicros,
        { validateOnly }
      );
      results.push({ ...campaign, ...updated });
    }

    if (!validateOnly) {
      await prisma.$executeRaw(Prisma.sql`
        UPDATE "public"."ads_explorer_batches"
        SET
          "max_cpc_micros" = ${BigInt(maxCpcMicros)},
          "stats_json" = COALESCE("stats_json", '{}'::jsonb) || ${JSON.stringify({
            maxCpcUpdatedAt: new Date().toISOString(),
            maxCpcMicros,
          })}::jsonb,
          "updated_at" = CURRENT_TIMESTAMP
        WHERE "status" = 'active'
      `);
    }

    const report = {
      validateOnly,
      planHash,
      maxCpcMicros,
      maxCpcChf: maxCpcMicros / 1e6,
      campaigns: results,
      applied: !validateOnly,
    };
    const outPath = await writeExplorerReport("explorer-cpc-update.json", report);
    log("explorer_cpc_update.summary", {
      validateOnly,
      planHash,
      maxCpcChf: maxCpcMicros / 1e6,
      campaignCount: results.length,
      reportPath: outPath,
    });
    return report;
  });
}
