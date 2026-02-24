import { validateGtin } from "@/app/lib/normalize";

const SUPPLIER_CODE_MAP: Record<string, string> = {
  golden: "GLD",
  trm: "TRM",
};

const PROVIDER_KEY_REGEX = /^[A-Z]{3}$/;

export function normalizeProviderKey(value?: string | null): string | null {
  if (!value) return null;
  const cleaned = value.toString().trim().toUpperCase();
  if (PROVIDER_KEY_REGEX.test(cleaned)) return cleaned;
  const prefix = cleaned.split("_")[0]?.trim().toUpperCase();
  return prefix && PROVIDER_KEY_REGEX.test(prefix) ? prefix : null;
}

export function extractProviderKeyFromOrderKey(value?: string | null): string | null {
  if (!value) return null;
  const prefix = value.toString().split("_")[0]?.trim().toUpperCase();
  return PROVIDER_KEY_REGEX.test(prefix) ? prefix : null;
}

export function isValidProviderKeyWithGtin(value?: string | null): boolean {
  if (!value) return false;
  const [prefix, gtin] = value.toString().split("_");
  if (!prefix || !gtin) return false;
  if (!normalizeProviderKey(prefix)) return false;
  return /^\d+$/.test(gtin) && [8, 12, 13, 14].includes(gtin.length);
}

export function resolveSupplierCode(supplierVariantId?: string | null): string {
  if (!supplierVariantId) return "SUP";
  const rawKey = supplierVariantId.split(":")[0]?.toLowerCase();
  if (rawKey && SUPPLIER_CODE_MAP[rawKey]) return SUPPLIER_CODE_MAP[rawKey];
  const cleaned = (rawKey ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned.slice(0, 3) || "SUP";
}

export function buildProviderKey(
  gtin?: string | null,
  supplierVariantId?: string | null
): string | null {
  const cleaned = gtin?.toString().trim() ?? "";
  if (!validateGtin(cleaned)) return null;
  const supplierCode = resolveSupplierCode(supplierVariantId);
  return `${supplierCode}_${cleaned}`;
}

export function assertMappingIntegrity(input: {
  supplierVariantId?: string | null;
  gtin?: string | null;
  providerKey?: string | null;
  status?: string | null;
}) {
  const supplierVariantId = input.supplierVariantId ?? null;
  const status = input.status ? String(input.status) : "";
  const rawGtin = input.gtin ? String(input.gtin).trim() : "";
  const gtin = validateGtin(rawGtin) ? rawGtin : null;
  const providerKey = input.providerKey ? String(input.providerKey).trim() : null;

  if (!gtin) {
    if (providerKey) {
      throw new Error(
        `Mapping invariant failed: providerKey must be null when gtin is missing (supplierVariantId=${supplierVariantId ?? "unknown"})`
      );
    }
    if (status && status !== "PENDING_GTIN" && status !== "AMBIGUOUS_GTIN") {
      throw new Error(
        `Mapping invariant failed: status must be PENDING_GTIN or AMBIGUOUS_GTIN when gtin is missing (supplierVariantId=${supplierVariantId ?? "unknown"}, status=${status})`
      );
    }
    return;
  }

  const expectedProviderKey = buildProviderKey(gtin, supplierVariantId);
  if (!expectedProviderKey || providerKey !== expectedProviderKey) {
    throw new Error(
      `Mapping invariant failed: providerKey must be ${expectedProviderKey} for gtin ${gtin} (supplierVariantId=${supplierVariantId ?? "unknown"}, providerKey=${providerKey ?? "null"})`
    );
  }
  if (status !== "MATCHED" && status !== "SUPPLIER_GTIN") {
    throw new Error(
      `Mapping invariant failed: status must be MATCHED or SUPPLIER_GTIN when gtin exists (supplierVariantId=${supplierVariantId ?? "unknown"}, status=${status})`
    );
  }
}
