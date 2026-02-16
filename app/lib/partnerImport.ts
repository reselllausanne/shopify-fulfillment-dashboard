import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import { normalizeSize, normalizeSku } from "@/app/lib/normalize";

function canonicalizeSku(value: string): string {
  return value
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

function canonicalizeSize(value: string): string {
  return value
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

export function buildDuplicateKey(
  providerKeyRaw: string,
  skuRaw: string,
  sizeRaw: string
): string | null {
  const providerKey = normalizeProviderKey(providerKeyRaw)?.toUpperCase() ?? "";
  const sku = normalizeSku(skuRaw) ?? "";
  const size = normalizeSize(sizeRaw) ?? "";
  if (!providerKey || !sku || !size) return null;
  const skuKey = canonicalizeSku(sku);
  const sizeKey = canonicalizeSize(size);
  if (!skuKey || !sizeKey) return null;
  return `${providerKey}|${skuKey}|${sizeKey}`;
}

export function computeLastRowByKey(rows: string[][], headerMap: Map<string, number>): Map<string, number> {
  const lastRowByKey = new Map<string, number>();
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const providerKeyRaw = row[headerMap.get("providerKey") ?? -1]?.trim() ?? "";
    const skuRaw = row[headerMap.get("sku") ?? -1]?.trim() ?? "";
    const sizeRaw = row[headerMap.get("size") ?? -1]?.trim() ?? "";
    const key = buildDuplicateKey(providerKeyRaw, skuRaw, sizeRaw);
    if (!key) continue;
    lastRowByKey.set(key, i);
  }
  return lastRowByKey;
}
