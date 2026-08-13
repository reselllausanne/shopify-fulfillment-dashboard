import {
  createSupplementalApiDataSource,
  listMerchantSources,
  patchPrimaryDataSourceDefaultRule,
} from "@/adsanalytics/explorer/merchantClient";

export const EXPLORER_SOURCE_NAME = "Resell Lausanne Explorer Labels";

export type EnsureSupplementalSourceResult = {
  dataSource: string;
  sourceCreated: boolean;
  primaryPatches: Array<{ source: string; patched: boolean }>;
};

function normalizeRefs(rawRefs: unknown): Array<Record<string, unknown>> {
  const refs = Array.isArray(rawRefs) ? rawRefs : [];
  const out: Array<Record<string, unknown>> = [];
  for (const entry of refs) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    if (row.self === true) out.push({ self: true });
    const supplemental =
      typeof row.supplementalDataSourceName === "string" ? row.supplementalDataSourceName : "";
    const primary = typeof row.primaryDataSourceName === "string" ? row.primaryDataSourceName : "";
    if (supplemental) out.push({ supplementalDataSourceName: supplemental });
    if (primary) out.push({ primaryDataSourceName: primary });
  }
  return out;
}

/**
 * Resolve (or create) the Explorer supplemental API data source and make sure every
 * primary source additively takes from it. Never replaces an existing default rule.
 */
export async function ensureExplorerSupplementalSource(
  merchantId: string
): Promise<EnsureSupplementalSourceResult> {
  const sources = await listMerchantSources(merchantId);
  let explorerSource = sources.sources.find((s) => {
    const input = String(s.raw.input ?? "").toUpperCase();
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
  const primaryPatches: Array<{ source: string; patched: boolean }> = [];
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
      primaryPatches.push({ source: src.id, patched: false });
      continue;
    }
    const afterRefs = [...beforeRefs, { supplementalDataSourceName: dataSource }];
    await patchPrimaryDataSourceDefaultRule(src.id, afterRefs);
    primaryPatches.push({ source: src.id, patched: true });
  }
  return { dataSource, sourceCreated, primaryPatches };
}
