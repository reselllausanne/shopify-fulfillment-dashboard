import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import { normalizeSize, normalizeSku } from "@/app/lib/normalize";

/** Canonical SupplierVariant id for partner CSV imports (normalized sku + size). */
export function buildSupplierVariantId(providerKeyRaw: string, skuNormalized: string, sizeNormalized: string): string {
  const providerKey = normalizeProviderKey(providerKeyRaw);
  if (!providerKey) {
    throw new Error("Invalid providerKey for supplierVariantId");
  }
  const cleanKey = providerKey.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const cleanSku = skuNormalized.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  const cleanSize = sizeNormalized.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  return `${cleanKey}:${cleanSku}-${cleanSize}`;
}

/** Resolve SupplierVariant id for a GTIN inbox / upload row (stored id or derived from legacy sku+size). */
export function inboxRowSupplierVariantId(row: {
  supplierVariantId?: string | null;
  providerKey: string;
  sku: string;
  sizeNormalized: string;
  sizeRaw?: string | null;
}): string | null {
  const trimmed = row.supplierVariantId?.trim();
  if (trimmed) return trimmed;
  const pk = normalizeProviderKey(row.providerKey);
  if (!pk) return null;
  const sku = normalizeSku(row.sku) ?? row.sku;
  const size =
    normalizeSize(row.sizeNormalized || row.sizeRaw || "") ?? row.sizeNormalized ?? row.sizeRaw ?? "";
  if (!sku || !size) return null;
  try {
    return buildSupplierVariantId(pk, sku, size);
  } catch {
    return null;
  }
}

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
