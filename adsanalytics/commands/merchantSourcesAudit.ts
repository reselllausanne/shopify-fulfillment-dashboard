import { Prisma } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import {
  EXPLORER_DEFAULT_MERCHANT_ID,
  writeExplorerReport,
} from "@/adsanalytics/explorer/core";
import { listMerchantSources, sourcePlanHash } from "@/adsanalytics/explorer/merchantClient";
import { log, withSyncRun } from "@/adsanalytics/run";

export async function merchantSourcesAuditCommand(): Promise<number> {
  return withSyncRun("merchant:sources:audit", {}, async () => {
    let sourcesRes:
      | Awaited<ReturnType<typeof listMerchantSources>>
      | null = null;
    let sourceError: string | null = null;
    try {
      sourcesRes = await listMerchantSources(EXPLORER_DEFAULT_MERCHANT_ID);
    } catch (err) {
      sourceError = err instanceof Error ? err.message : String(err);
    }
    const customLabel3Usage = await prisma.$queryRaw<
      Array<{ total: number; non_empty: number; pct: number }>
    >(Prisma.sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE COALESCE(NULLIF("custom_attr3", ''), '') <> '')::int AS non_empty,
        ROUND(
          CASE
            WHEN COUNT(*) = 0 THEN 0
            ELSE (COUNT(*) FILTER (WHERE COALESCE(NULLIF("custom_attr3", ''), '') <> '')::numeric / COUNT(*)::numeric) * 100
          END
        , 4)::float8 AS pct
      FROM "public"."ads_shopping_product_current"
      WHERE "is_current" = true
        AND "merchant_id" = ${EXPLORER_DEFAULT_MERCHANT_ID}::bigint
    `);

    const sources = sourcesRes?.sources ?? [];
    const primarySources = sources.filter((s) => s.primaryGuess);
    const explorerSources = sources.filter((s) => s.explorerGuess);
    const defaultRuleRaw = sources.map((s) => ({
      id: s.id,
      name: s.name,
      raw: s.raw,
    }));

    const plan = {
      merchantId: EXPLORER_DEFAULT_MERCHANT_ID,
      backend: sourcesRes?.backend ?? null,
      sourceCount: sources.length,
      sourceError,
      primarySources: primarySources.map((s) => ({ id: s.id, name: s.name })),
      explorerSources: explorerSources.map((s) => ({ id: s.id, name: s.name })),
      customLabel3Usage: customLabel3Usage[0] ?? { total: 0, non_empty: 0, pct: 0 },
      defaultRuleSnapshots: defaultRuleRaw,
      proposedChange:
        "Add supplementary source `Resell Lausanne Explorer Labels` writing only customLabel3=explorer_active. Preserve existing source links and default rules; additive diff only.",
      manualStepIfApiBlocked:
        "Merchant Center > Data sources > Add supplementary source `Resell Lausanne Explorer Labels` and map custom label 3 only. Do not touch primary Simprosys sources.",
    };
    const planHash = sourcePlanHash(plan);
    const outPath = await writeExplorerReport("merchant-sources-audit.json", {
      ...plan,
      planHash,
      fetchedAt: new Date().toISOString(),
      rawResponse: sourcesRes?.rawResponse ?? null,
    });

    log("merchant_sources_audit.summary", {
      merchantId: EXPLORER_DEFAULT_MERCHANT_ID,
      backend: sourcesRes?.backend ?? null,
      sourceCount: sources.length,
      sourceError,
      primaryCount: primarySources.length,
      explorerCount: explorerSources.length,
      customLabel3UsagePct: plan.customLabel3Usage.pct,
      planHash,
      reportPath: outPath,
    });

    return {
      merchantId: EXPLORER_DEFAULT_MERCHANT_ID,
      backend: sourcesRes?.backend ?? null,
      sourceCount: sources.length,
      sourceError,
      primaryCount: primarySources.length,
      explorerCount: explorerSources.length,
      customLabel3UsagePct: plan.customLabel3Usage.pct,
      planHash,
      reportPath: outPath,
    };
  });
}

