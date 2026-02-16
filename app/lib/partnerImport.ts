export function buildDuplicateKey(
  providerKeyRaw: string,
  skuRaw: string,
  sizeRaw: string
): string | null {
  const providerKey = providerKeyRaw.trim().toUpperCase();
  const sku = skuRaw.trim();
  const size = sizeRaw.trim();
  if (!providerKey || !sku || !size) return null;
  return `${providerKey}|${sku}|${size}`;
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
