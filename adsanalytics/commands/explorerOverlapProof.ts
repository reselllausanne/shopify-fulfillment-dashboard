import { Prisma } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import { latestInventorySyncMeta } from "@/adsanalytics/commands/inventorySync";
import { loadCampaignRegistry } from "@/adsanalytics/explorer/campaignRegistry";
import { EXPLORER_DEFAULT_MERCHANT_ID, writeExplorerReport } from "@/adsanalytics/explorer/core";
import { DESTINATIONS, destinationForLabel, type Destination } from "@/adsanalytics/explorer/destinations";
import { log, withSyncRun } from "@/adsanalytics/run";

export type ExplorerOverlapProofOptions = {
  eligibleOnly?: boolean;
};

type OfferRow = {
  offer_id: string;
  custom_attr3: string;
  status: string;
  availability: string;
  targeted_campaign_ids: string[];
};

type Violation = {
  kind: "overlap" | "wrong_campaign" | "orphan" | "unregistered_destination";
  offerId: string;
  label: string;
  expectedDestination: Destination;
  expectedCampaignId: string | null;
  actualCampaignIds: string[];
};

const MAX_SAMPLES = 20;

/**
 * Zero overlap proof from Google's own targeting snapshot rather than from our
 * reconstruction of the trees: every routed offer must be targeted by exactly the one
 * campaign that owns its custom_label_3 value.
 */
export async function explorerOverlapProofCommand(
  options: ExplorerOverlapProofOptions = {}
): Promise<number> {
  return withSyncRun("explorer:overlap:proof", options, async () => {
    const registry = await loadCampaignRegistry();
    const missingRoles = DESTINATIONS.filter((d) => !registry.has(d));
    const registeredRoles = DESTINATIONS.filter((d) => registry.has(d));

    // A missing role still yields a useful partial proof for the roles that do exist, so
    // the run reports evidence instead of aborting; the missing role stays a blocker.
    const routedCampaignIds = new Map<string, Destination>();
    for (const role of registeredRoles) {
      routedCampaignIds.set(registry.get(role)!.campaignId, role);
    }

    const inventoryMeta = await latestInventorySyncMeta();
    const eligibleOnly = options.eligibleOnly !== false;

    const rows = await prisma.$queryRaw<OfferRow[]>(Prisma.sql`
      SELECT
        "offer_id",
        COALESCE("custom_attr3", '') AS custom_attr3,
        COALESCE("status", '') AS status,
        COALESCE("availability", '') AS availability,
        COALESCE("targeted_campaign_ids", ARRAY[]::text[]) AS targeted_campaign_ids
      FROM "public"."ads_shopping_product_current"
      WHERE "is_current" = true
        AND "merchant_id" = ${EXPLORER_DEFAULT_MERCHANT_ID}::bigint
    `);

    const considered = eligibleOnly
      ? rows.filter(
          (r) => r.status.toUpperCase() === "ELIGIBLE" && r.availability.toUpperCase() === "IN_STOCK"
        )
      : rows;

    const byDestination: Record<Destination, { offers: number; correctlyTargeted: number }> = {
      CORE_ALL: { offers: 0, correctlyTargeted: 0 },
      EXPLORER_ALL: { offers: 0, correctlyTargeted: 0 },
      LONG_TAIL_ALL: { offers: 0, correctlyTargeted: 0 },
    };
    const violations: Violation[] = [];
    let overlapCount = 0;
    let wrongCampaignCount = 0;
    let orphanCount = 0;
    let unregisteredDestinationCount = 0;

    for (const row of considered) {
      const expectedDestination = destinationForLabel(row.custom_attr3);
      const expectedCampaignId = registry.get(expectedDestination)?.campaignId ?? null;
      const actual = row.targeted_campaign_ids.filter((id) => routedCampaignIds.has(id));
      byDestination[expectedDestination].offers += 1;

      if (expectedCampaignId === null) {
        unregisteredDestinationCount += 1;
        if (violations.length < MAX_SAMPLES * 3) {
          violations.push({
            kind: "unregistered_destination",
            offerId: row.offer_id,
            label: row.custom_attr3,
            expectedDestination,
            expectedCampaignId,
            actualCampaignIds: actual,
          });
        }
        continue;
      }

      if (actual.length > 1) {
        overlapCount += 1;
        if (violations.length < MAX_SAMPLES * 3) {
          violations.push({
            kind: "overlap",
            offerId: row.offer_id,
            label: row.custom_attr3,
            expectedDestination,
            expectedCampaignId,
            actualCampaignIds: actual,
          });
        }
        continue;
      }
      if (actual.length === 0) {
        orphanCount += 1;
        if (violations.length < MAX_SAMPLES * 3) {
          violations.push({
            kind: "orphan",
            offerId: row.offer_id,
            label: row.custom_attr3,
            expectedDestination,
            expectedCampaignId,
            actualCampaignIds: actual,
          });
        }
        continue;
      }
      if (actual[0] !== expectedCampaignId) {
        wrongCampaignCount += 1;
        if (violations.length < MAX_SAMPLES * 3) {
          violations.push({
            kind: "wrong_campaign",
            offerId: row.offer_id,
            label: row.custom_attr3,
            expectedDestination,
            expectedCampaignId,
            actualCampaignIds: actual,
          });
        }
        continue;
      }
      byDestination[expectedDestination].correctlyTargeted += 1;
    }

    const blockers: string[] = [];
    if (missingRoles.length > 0) {
      blockers.push(
        `unregistered campaign roles ${missingRoles.join(", ")}; run explorer:campaign:discover then explorer:campaign:register`
      );
    }
    if (unregisteredDestinationCount > 0) {
      blockers.push(
        `${unregisteredDestinationCount} offers carry a label whose destination campaign is not registered`
      );
    }
    if (inventoryMeta.stale) {
      blockers.push(
        `Inventory snapshot is stale (last inventory:sync ${inventoryMeta.lastInventorySyncAt ?? "never"}); run inventory:sync before trusting this proof`
      );
    }
    if (overlapCount > 0) blockers.push(`${overlapCount} offers targeted by more than one routed campaign`);
    if (wrongCampaignCount > 0) {
      blockers.push(`${wrongCampaignCount} offers targeted by a campaign that does not own their label`);
    }

    const warnings: string[] = [];
    if (orphanCount > 0) {
      warnings.push(`${orphanCount} eligible offers are targeted by none of the routed campaigns`);
    }

    const report = {
      pass: blockers.length === 0,
      eligibleOnly,
      inventoryMeta,
      missingRoles,
      campaigns: Object.fromEntries(
        DESTINATIONS.map((role) => [
          role,
          registry.has(role)
            ? {
                campaignId: registry.get(role)!.campaignId,
                campaignName: registry.get(role)!.campaignName,
                includeLabel: registry.get(role)!.includeLabel,
              }
            : null,
        ])
      ),
      offersConsidered: considered.length,
      offersTotal: rows.length,
      byDestination,
      overlapCount,
      wrongCampaignCount,
      orphanCount,
      unregisteredDestinationCount,
      blockers,
      warnings,
      violationSamples: violations.slice(0, MAX_SAMPLES),
    };
    const outPath = await writeExplorerReport("explorer-overlap-proof.json", report);
    log("explorer_overlap_proof.summary", {
      pass: report.pass,
      offersConsidered: considered.length,
      overlapCount,
      wrongCampaignCount,
      orphanCount,
      unregisteredDestinationCount,
      byDestination,
      blockers,
      warnings,
      reportPath: outPath,
    });

    if (!report.pass) {
      throw new Error(`Zero overlap proof failed: ${blockers.join(" | ")}`);
    }
    return {
      pass: report.pass,
      offersConsidered: considered.length,
      overlapCount,
      wrongCampaignCount,
      orphanCount,
      reportPath: outPath,
    };
  });
}
