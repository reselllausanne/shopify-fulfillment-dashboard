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

/**
 * Admin / dashboard: line is fulfilled by the assigned partner (catalog), not StockX.
 * Same prefix rule as {@link filterDecathlonLinesForPartner}; if no prefixed SKUs on the order,
 * whole-order partner assignment treats every line as partner.
 */
export function isDecathlonPartnerFulfillmentLine(
  order: { partnerKey?: string | null; lines?: Array<{ offerSku?: string | null }> },
  line: { offerSku?: string | null }
): boolean {
  const pk = normalizeProviderKey(order?.partnerKey);
  if (!pk) return false;
  const prefix = `${pk.toUpperCase()}_`;
  const lines = order.lines ?? [];
  const hasPrefixed = lines.some((l) => String(l.offerSku ?? "").toUpperCase().startsWith(prefix));
  const offer = String(line.offerSku ?? "").toUpperCase();
  if (hasPrefixed) return offer.startsWith(prefix);
  return true;
}

/**
 * If the line's Mirakl offer SKU or catalog provider key uses a known partner prefix (`NER_…`),
 * returns that partner key — works for mixed orders (e.g. STX + NER) even when `order.partnerKey` is unset.
 */
export function partnerKeyMatchingLineOffer(
  line: { offerSku?: string | null; catalog?: { providerKey?: string | null } | null },
  partnerKeys: readonly string[]
): string | null {
  const offer = String(line.offerSku ?? "").toUpperCase();
  const catPk = String(line.catalog?.providerKey ?? "").toUpperCase();
  for (const raw of partnerKeys) {
    const k = normalizeProviderKey(raw);
    if (!k) continue;
    const prefix = `${k}_`;
    if (offer.startsWith(prefix) || catPk.startsWith(prefix)) return k;
  }
  return null;
}
