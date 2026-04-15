import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";

/**
 * Lines visible to a partner session: prefixed offer SKUs, or whole order when assigned by partnerKey only.
 */
export function filterDecathlonLinesForPartner<T extends { id: string; offerSku?: string | null }>(
  lines: T[],
  order: { partnerKey?: string | null },
  partnerKey: string | null | undefined
): T[] {
  const key = normalizeProviderKey(partnerKey);
  if (!key) return lines;
  const prefix = `${key.toUpperCase()}_`;
  const scoped = (lines ?? []).filter((line) => String(line.offerSku ?? "").toUpperCase().startsWith(prefix));
  if (scoped.length > 0) return scoped;
  const orderPartner = order?.partnerKey ? normalizeProviderKey(order.partnerKey) : null;
  if (orderPartner && orderPartner === key) return lines ?? [];
  return scoped;
}
