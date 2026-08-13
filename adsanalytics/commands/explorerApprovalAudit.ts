import { Prisma } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import { EXPLORER_DEFAULT_MERCHANT_ID, writeExplorerReport } from "@/adsanalytics/explorer/core";
import { log, withSyncRun } from "@/adsanalytics/run";

type Options = { days?: number };

export async function explorerApprovalAuditCommand(options: Options = {}): Promise<number> {
  return withSyncRun("explorer:approval-audit", options, async () => {
    const offerRows = await prisma.$queryRaw<
      Array<{
        shopify_product_id: string;
        offer_id: string;
        language_code: string;
        feed_label: string;
        status: string;
        availability: string;
      }>
    >(Prisma.sql`
      SELECT
        "shopify_product_id"::text,
        COALESCE("offer_id",'') AS offer_id,
        COALESCE("language_code",'') AS language_code,
        COALESCE("feed_label",'') AS feed_label,
        COALESCE("status",'') AS status,
        COALESCE("availability",'') AS availability
      FROM "public"."ads_shopping_product_current"
      WHERE "is_current" = true
        AND "merchant_id" = ${EXPLORER_DEFAULT_MERCHANT_ID}::bigint
        AND "shopify_product_id" IS NOT NULL
    `);

    const offerStatus = {
      total: offerRows.length,
      approved: 0,
      pending: 0,
      disapproved: 0,
      unknown: 0,
    };
    const byLang = new Map<string, { total: number; approved: number }>();
    const byFeed = new Map<string, { total: number; approved: number }>();
    const byModel = new Map<
      string,
      {
        total: number;
        approved: number;
        inStockApproved: number;
        statuses: Record<string, number>;
      }
    >();

    for (const row of offerRows) {
      const status = row.status.toUpperCase();
      const approved = status === "ELIGIBLE";
      if (approved) offerStatus.approved += 1;
      else if (status.includes("PENDING")) offerStatus.pending += 1;
      else if (status.includes("DISAPPROVED") || status.includes("NOT_ELIGIBLE"))
        offerStatus.disapproved += 1;
      else offerStatus.unknown += 1;

      const lang = row.language_code.toLowerCase() || "(empty)";
      const langBucket = byLang.get(lang) ?? { total: 0, approved: 0 };
      langBucket.total += 1;
      if (approved) langBucket.approved += 1;
      byLang.set(lang, langBucket);

      const feed = row.feed_label.toUpperCase() || "(empty)";
      const feedBucket = byFeed.get(feed) ?? { total: 0, approved: 0 };
      feedBucket.total += 1;
      if (approved) feedBucket.approved += 1;
      byFeed.set(feed, feedBucket);

      const m = byModel.get(row.shopify_product_id) ?? {
        total: 0,
        approved: 0,
        inStockApproved: 0,
        statuses: {},
      };
      m.total += 1;
      if (approved) m.approved += 1;
      if (approved && row.availability.toUpperCase() === "IN_STOCK") m.inStockApproved += 1;
      m.statuses[status || "(empty)"] = (m.statuses[status || "(empty)"] ?? 0) + 1;
      byModel.set(row.shopify_product_id, m);
    }

    const modelEntries = [...byModel.entries()];
    const modelsAllApproved = modelEntries.filter(([, v]) => v.total > 0 && v.approved === v.total).length;
    const modelsAnyApproved = modelEntries.filter(([, v]) => v.approved > 0).length;
    const modelsPartialApproved = modelEntries.filter(([, v]) => v.approved > 0 && v.approved < v.total).length;
    const modelsZeroApproved = modelEntries.filter(([, v]) => v.approved === 0).length;
    const pilotApprovedDefinitionCount = modelEntries.filter(([, v]) => v.inStockApproved > 0).length;

    const issueCodesAvailable = false;
    const topIssueCodes: Array<{ code: string; count: number }> = [
      { code: "field_unavailable:issue_code_not_imported", count: offerStatus.disapproved + offerStatus.pending + offerStatus.unknown },
    ];

    const rejectedExamples = modelEntries
      .filter(([, v]) => v.inStockApproved === 0)
      .slice(0, 50)
      .map(([modelId, v]) => ({
        modelId,
        offerCount: v.total,
        approvedOffers: v.approved,
        inStockApprovedOffers: v.inStockApproved,
        statuses: v.statuses,
      }));

    const report = {
      generatedAt: new Date().toISOString(),
      merchantId: EXPLORER_DEFAULT_MERCHANT_ID,
      pilotApprovedDefinition:
        "model is approved if at least one in-stock offer is ELIGIBLE for Shopping Ads snapshot",
      offerLevel: offerStatus,
      modelLevel: {
        totalModels: modelEntries.length,
        modelsAllApproved,
        modelsAnyApproved,
        modelsPartialApproved,
        modelsZeroApproved,
        modelsPilotDefinitionApproved: pilotApprovedDefinitionCount,
      },
      breakdowns: {
        byLanguage: [...byLang.entries()].map(([k, v]) => ({ language: k, ...v })),
        byFeedLabel: [...byFeed.entries()].map(([k, v]) => ({ feedLabel: k, ...v })),
      },
      issueCodes: {
        available: issueCodesAvailable,
        top20: topIssueCodes.slice(0, 20),
      },
      rejectedModelExamples: rejectedExamples,
      interpretation: {
        dropFrom53204To28499Likely:
          "merchant_approval_reality_with_offer_level_eligible_filter; not all-offers-approved aggregation bug",
        freeListingsVsShoppingAdsConfusion:
          "status field is unified shopping_product snapshot; no dedicated free-listing discriminator imported",
      },
    };

    const outPath = await writeExplorerReport("explorer-approval-audit.json", report);
    log("explorer_approval_audit.summary", {
      totalOffers: offerStatus.total,
      approvedOffers: offerStatus.approved,
      modelsPilotDefinitionApproved: pilotApprovedDefinitionCount,
      modelsZeroApproved,
      reportPath: outPath,
    });
    return {
      totalOffers: offerStatus.total,
      approvedOffers: offerStatus.approved,
      modelsPilotDefinitionApproved: pilotApprovedDefinitionCount,
      modelsZeroApproved,
      reportPath: outPath,
    };
  });
}

