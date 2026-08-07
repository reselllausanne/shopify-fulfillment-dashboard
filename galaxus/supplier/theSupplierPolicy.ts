import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";

export const THE_SUPPLIER_PARTNER_KEY = "THE";
export const THE_SUPPLIER_KEY = "the";

/** Legacy THE warehouse supplier. Disabled unless THE_SUPPLIER_ENABLED=true. */
export function isTheSupplierEnabled(): boolean {
  const raw = process.env.THE_SUPPLIER_ENABLED ?? "false";
  return ["1", "true", "yes"].includes(String(raw).toLowerCase());
}

export function isTheSupplierPartnerKey(partnerKey: string | null | undefined): boolean {
  return normalizeProviderKey(partnerKey) === THE_SUPPLIER_PARTNER_KEY;
}

export function isTheSupplierKey(supplierKey: string | null | undefined): boolean {
  return String(supplierKey ?? "").trim().toLowerCase() === THE_SUPPLIER_KEY;
}

export function isTheSupplierProviderKey(providerKey: string | null | undefined): boolean {
  return /^THE_/i.test(String(providerKey ?? "").trim());
}

export function isTheSupplierVariantId(supplierVariantId: string | null | undefined): boolean {
  const id = String(supplierVariantId ?? "")
    .trim()
    .toLowerCase();
  return id.startsWith("the_") || id.startsWith("the:");
}

export function isThePartnerUploadProviderKey(providerKey: string | null | undefined): boolean {
  return isTheSupplierPartnerKey(normalizeProviderKey(providerKey));
}

export type PartnerSyncGateResult =
  | { allowed: true }
  | { allowed: false; reason: string };

/** Block explicit THE partner sync when the supplier is disabled. */
export function gatePartnerSyncForTheSupplier(partnerKey?: string | null): PartnerSyncGateResult {
  if (isTheSupplierEnabled()) return { allowed: true };
  if (isTheSupplierPartnerKey(partnerKey)) {
    return { allowed: false, reason: "THE supplier is disabled" };
  }
  return { allowed: true };
}
