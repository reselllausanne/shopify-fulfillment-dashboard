/**
 * Merge KickDB product payloads for persistence.
 *
 * Price-only SSE updates omit gallery / gallery_360. Spreading incoming over
 * existing keeps media while refreshing variants + prices.
 */
export function mergeKickdbRawJson(
  existing: unknown | null | undefined,
  incoming: Record<string, unknown>,
  priceOnly: boolean
): Record<string, unknown> {
  if (!priceOnly) return incoming;
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
    return incoming;
  }
  const { gallery: _gallery, gallery_360: _gallery360, ...priceFields } = incoming;
  return { ...(existing as Record<string, unknown>), ...priceFields };
}
