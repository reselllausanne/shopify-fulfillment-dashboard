import { readFile } from "node:fs/promises";

import { listMerchantSources, getProductInput, getProcessedProduct, extractCustomLabel3, type MerchantProductRef } from "@/adsanalytics/explorer/merchantClient";
import { writeExplorerReport } from "@/adsanalytics/explorer/core";
import { log, withSyncRun } from "@/adsanalytics/run";

type Options = { batch?: string };

type CanaryReport = {
  batchId: string;
  merchantId: string;
  dataSource: string;
  baseline: Array<{ product: MerchantProductRef; baselineLabel: string | null }>;
  primaryPatches?: Array<{ source: string; before: unknown; after: unknown }>;
};

function requiredBatchId(batchId: string | undefined): string {
  const id = batchId?.trim();
  if (!id) throw new Error("Missing --batch=<id>");
  return id;
}

function normalizeRefs(rawRefs: unknown): Array<Record<string, unknown>> {
  const refs = Array.isArray(rawRefs) ? rawRefs : [];
  const out: Array<Record<string, unknown>> = [];
  for (const entry of refs) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    if (row.self === true) out.push({ self: true });
    const supplemental = typeof row.supplementalDataSourceName === "string" ? row.supplementalDataSourceName : "";
    const primary = typeof row.primaryDataSourceName === "string" ? row.primaryDataSourceName : "";
    if (supplemental) out.push({ supplementalDataSourceName: supplemental });
    if (primary) out.push({ primaryDataSourceName: primary });
  }
  return out;
}

function refsFingerprint(refs: Array<Record<string, unknown>>): string {
  return refs
    .map((r) => JSON.stringify(r))
    .sort()
    .join("|");
}

export async function explorerMerchantCanaryVerifyCommand(options: Options = {}): Promise<number> {
  return withSyncRun("explorer:merchant:canary:verify", options, async () => {
    const batchId = requiredBatchId(options.batch);
    const reportPath = `tmp/explorer/explorer-merchant-canary-${batchId}.json`;
    const raw = await readFile(reportPath, "utf8");
    const prior = JSON.parse(raw) as CanaryReport;

    const inputChecks = await Promise.all(
      prior.baseline.map(async ({ product }) => {
        const row = await getProductInput(prior.merchantId, prior.dataSource, product);
        return {
          product,
          exists: row != null,
          inputName: typeof row?.name === "string" ? row.name : null,
        };
      })
    );
    const remainingInputs = inputChecks.filter((x) => x.exists);
    const deletedInSource = remainingInputs.length === 0;

    const processedChecks = await Promise.all(
      prior.baseline.map(async ({ product, baselineLabel }) => {
        const p = await getProcessedProduct(prior.merchantId, product);
        const observed = extractCustomLabel3(p);
        return {
          product,
          baselineLabel,
          observed,
          reverted: (baselineLabel ?? "") === (observed ?? ""),
        };
      })
    );
    const processedReverted = processedChecks.every((x) => x.reverted);

    const sources = await listMerchantSources(prior.merchantId);
    const primaryRuleChecks = (prior.primaryPatches ?? []).map((patch) => {
      const current = sources.sources.find((s) => s.id === patch.source);
      const primary = (current?.raw.primaryProductDataSource as Record<string, unknown> | undefined) ?? {};
      const defaultRule = (primary.defaultRule as Record<string, unknown> | undefined) ?? {};
      const currentRefs = normalizeRefs(defaultRule.takeFromDataSources);
      const expectedRefs = normalizeRefs(patch.after);
      const matches = refsFingerprint(currentRefs) === refsFingerprint(expectedRefs);
      return {
        source: patch.source,
        expected: expectedRefs,
        current: currentRefs,
        matches,
      };
    });
    const primaryRulesUnchanged = primaryRuleChecks.every((x) => x.matches);

    const verifyReport = {
      batchId,
      merchantId: prior.merchantId,
      dataSource: prior.dataSource,
      deletedInSource,
      processedReverted,
      primaryRulesUnchanged,
      inputChecks,
      processedChecks,
      primaryRuleChecks,
      recommendation: deletedInSource
        ? processedReverted
          ? "canary_pass"
          : "source_delete_pass_wait_propagation_15_30m_then_recheck"
        : "delete_failed_fix_resource_name_or_datasource_then_delete_only_three",
    };
    const outPath = await writeExplorerReport(`explorer-merchant-canary-verify-${batchId}.json`, verifyReport);
    log("explorer_merchant_canary_verify.summary", {
      batchId,
      merchantId: prior.merchantId,
      dataSource: prior.dataSource,
      deletedInSource,
      processedReverted,
      primaryRulesUnchanged,
      remainingInputs: remainingInputs.length,
      reportPath: outPath,
    });
    return {
      batchId,
      merchantId: prior.merchantId,
      dataSource: prior.dataSource,
      deletedInSource,
      processedReverted,
      primaryRulesUnchanged,
      remainingInputs: remainingInputs.length,
      reportPath: outPath,
    };
  });
}

