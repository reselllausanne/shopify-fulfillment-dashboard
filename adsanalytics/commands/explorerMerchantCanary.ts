import {
  loadBatchById,
  loadOffersForBatchModels,
  writeExplorerReport,
} from "@/adsanalytics/explorer/core";
import { EXPLORER_ACTIVE_LABEL, EXPLORER_LABELS } from "@/adsanalytics/explorer/labels";
import { EXPLORER_SOURCE_NAME } from "@/adsanalytics/explorer/supplementalSource";
import {
  createSupplementalApiDataSource,
  deleteSupplementalProductInput,
  extractCustomLabel3,
  getProcessedProduct,
  insertSupplementalProductLabel,
  listMerchantSources,
  patchPrimaryDataSourceDefaultRule,
  type MerchantProductRef,
} from "@/adsanalytics/explorer/merchantClient";
import { log, withSyncRun } from "@/adsanalytics/run";

type Options = {
  batch?: string;
  limit?: number;
};

function requiredBatchId(batchId: string | undefined): string {
  const id = batchId?.trim();
  if (!id) throw new Error("Missing --batch=<id>");
  return id;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function waitForLabel(
  merchantId: string,
  item: MerchantProductRef,
  expected: string | null,
  timeoutMs: number
): Promise<{ ok: boolean; observed: string | null; attempts: number }> {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  let last: string | null = null;
  while (Date.now() <= deadline) {
    attempts += 1;
    try {
      const product = await getProcessedProduct(merchantId, item);
      last = extractCustomLabel3(product);
      if ((expected ?? "") === (last ?? "")) {
        return { ok: true, observed: last, attempts };
      }
    } catch {
      // Product processing can lag briefly after writes; keep polling.
    }
    await sleep(5_000);
  }
  return { ok: false, observed: last, attempts };
}

export async function explorerMerchantCanaryCommand(options: Options = {}): Promise<number> {
  return withSyncRun("explorer:merchant:canary", options, async () => {
    const batchId = requiredBatchId(options.batch);
    const limit = Math.max(1, Math.min(10, Math.floor(options.limit ?? 3)));
    const batch = await loadBatchById(batchId);
    if (!batch) throw new Error(`Batch not found: ${batchId}`);
    const canaryStats = (batch.statsJson ?? {}) as Record<string, unknown>;
    const canaryRawLabel =
      typeof canaryStats.explorerLabel === "string" ? canaryStats.explorerLabel.trim() : "";
    const EXPLORER_LABEL =
      canaryRawLabel && (EXPLORER_LABELS as readonly string[]).includes(canaryRawLabel)
        ? canaryRawLabel
        : EXPLORER_ACTIVE_LABEL;

    const offers = await loadOffersForBatchModels(batchId);
    if (offers.length < limit) throw new Error(`Not enough offers in batch ${batchId} for canary`);
    const sorted = [...offers].sort((a, b) =>
      `${a.offerId}|${a.languageCode}|${a.feedLabel}`.localeCompare(`${b.offerId}|${b.languageCode}|${b.feedLabel}`)
    );
    const selected = sorted.slice(0, limit);
    const merchantId = selected[0]!.merchantId;

    const sources = await listMerchantSources(merchantId);
    let explorerSource = sources.sources.find((s) => {
      const input = String((s.raw.input ?? "")).toUpperCase();
      return s.name.trim().toLowerCase() === EXPLORER_SOURCE_NAME.toLowerCase() && input === "API";
    });
    let sourceCreated = false;
    if (!explorerSource) {
      const created = await createSupplementalApiDataSource(merchantId, EXPLORER_SOURCE_NAME);
      const createdName = String(created.name ?? "");
      if (!createdName) throw new Error("Failed to create supplemental API data source");
      explorerSource = {
        id: createdName,
        name: EXPLORER_SOURCE_NAME,
        backend: "merchantapi_v1beta",
        primaryGuess: false,
        explorerGuess: true,
        raw: created,
      };
      sourceCreated = true;
    }
    const dataSource = explorerSource.id;
    const primaryPatches: Array<{ source: string; patched: boolean; before: unknown; after: unknown }> = [];
    for (const src of sources.sources) {
      const primary = (src.raw.primaryProductDataSource as Record<string, unknown> | undefined) ?? null;
      if (!primary) continue;
      const defaultRule = (primary.defaultRule as Record<string, unknown> | undefined) ?? {};
      const beforeRefs = normalizeRefs(defaultRule.takeFromDataSources);
      if (beforeRefs.length === 0) {
        throw new Error(`Unsafe primary defaultRule for ${src.id}: empty takeFromDataSources`);
      }
      const hasExplorer = beforeRefs.some((r) => r.supplementalDataSourceName === dataSource);
      if (hasExplorer) {
        primaryPatches.push({ source: src.id, patched: false, before: beforeRefs, after: beforeRefs });
        continue;
      }
      const afterRefs = [...beforeRefs, { supplementalDataSourceName: dataSource }];
      await patchPrimaryDataSourceDefaultRule(src.id, afterRefs);
      primaryPatches.push({ source: src.id, patched: true, before: beforeRefs, after: afterRefs });
    }

    const baseline: Array<{ product: MerchantProductRef; baselineLabel: string | null }> = [];
    for (const item of selected) {
      const ref: MerchantProductRef = {
        offerId: item.offerId,
        contentLanguage: item.languageCode,
        feedLabel: item.feedLabel,
      };
      const product = await getProcessedProduct(merchantId, ref);
      baseline.push({ product: ref, baselineLabel: extractCustomLabel3(product) });
    }

    const inserted: MerchantProductRef[] = [];
    for (const row of baseline) {
      await insertSupplementalProductLabel(merchantId, dataSource, row.product, EXPLORER_LABEL);
      inserted.push(row.product);
    }

    const afterInsert = await Promise.all(
      baseline.map(async (row) => {
        const waited = await waitForLabel(merchantId, row.product, EXPLORER_LABEL, 120_000);
        return {
          product: row.product,
          expected: EXPLORER_LABEL,
          observed: waited.observed,
          ok: waited.ok,
          attempts: waited.attempts,
        };
      })
    );

    log("explorer_merchant_canary.insert_phase", {
      batchId,
      checked: afterInsert.length,
      insertPass: afterInsert.every((x) => x.ok),
    });

    for (const row of inserted) {
      await deleteSupplementalProductInput(merchantId, dataSource, row);
    }

    const afterDelete = await Promise.all(
      baseline.map(async (row) => {
        const waited = await waitForLabel(merchantId, row.product, row.baselineLabel, 120_000);
        return {
          product: row.product,
          expected: row.baselineLabel,
          observed: waited.observed,
          ok: waited.ok,
          attempts: waited.attempts,
        };
      })
    );

    const allInsertOk = afterInsert.every((x) => x.ok);
    const allDeleteOk = afterDelete.every((x) => x.ok);
    const report = {
      batchId,
      merchantId,
      dataSource,
      sourceCreated,
      primaryPatches,
      offerCount: baseline.length,
      baseline,
      afterInsert,
      afterDelete,
      canaryPass: allInsertOk && allDeleteOk,
    };
    const outPath = await writeExplorerReport(`explorer-merchant-canary-${batchId}.json`, report);
    log("explorer_merchant_canary.summary", {
      batchId,
      merchantId,
      dataSource,
      sourceCreated,
      primaryPatchedCount: primaryPatches.filter((x) => x.patched).length,
      offerCount: baseline.length,
      insertPass: allInsertOk,
      deletePass: allDeleteOk,
      canaryPass: allInsertOk && allDeleteOk,
      reportPath: outPath,
    });
    return {
      batchId,
      merchantId,
      dataSource,
      sourceCreated,
      primaryPatchedCount: primaryPatches.filter((x) => x.patched).length,
      offerCount: baseline.length,
      insertPass: allInsertOk,
      deletePass: allDeleteOk,
      canaryPass: allInsertOk && allDeleteOk,
      reportPath: outPath,
    };
  });
}

