/**
 * Shopify OrderMatch eligibility for scan / suggest / GTIN auto-fulfill.
 * Stale matches (fulfilled or older than ~2 months) must not drive packing.
 */

export const SHOPIFY_MATCH_MAX_AGE_MONTHS = 2;

export function shopifyMatchMinCreatedAt(now: Date = new Date()): Date {
  const cutoff = new Date(now.getTime());
  cutoff.setMonth(cutoff.getMonth() - SHOPIFY_MATCH_MAX_AGE_MONTHS);
  return cutoff;
}

export function isShopifyOrderMatchFresh(
  createdAt: Date | string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!createdAt) return false;
  const at = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(at.getTime())) return false;
  return at.getTime() >= shopifyMatchMinCreatedAt(now).getTime();
}
