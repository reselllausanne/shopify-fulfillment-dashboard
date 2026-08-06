import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";

export function isPartnerSelfFulfillEnabled(partnerKey: string | null | undefined): boolean {
  const normalizedKey = normalizeProviderKey(partnerKey ?? null);
  if (!normalizedKey) return false;
  return true;
}
