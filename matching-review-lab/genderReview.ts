/**
 * Women / GS (youth) cases must go to human review in the lab —
 * never auto-promoted as production rules or silent HIGH accepts.
 */

export function hasWomenOrGsMarkers(params: {
  title?: string | null;
  size?: string | null;
  variantTitle?: string | null;
}): boolean {
  const blob = `${params.title ?? ""} ${params.size ?? ""} ${params.variantTitle ?? ""}`.toLowerCase();
  if (/(women|womens|woman|female|\bw\b)/.test(blob)) return true;
  if (/(youth|kids|grade school|\bgs\b)/.test(blob)) return true;
  const size = String(params.size ?? params.variantTitle ?? "").toUpperCase();
  if (/(^|\b)\d+(\.\d+)?\s*Y\b/.test(size)) return true;
  if (/(^|\b)GS\b/.test(size)) return true;
  return false;
}

/** Lab policy: Women/GS → review flag even if scorer returns a candidate. */
export function requiresGenderOrSizeSystemReview(params: {
  clientTitle?: string | null;
  clientSize?: string | null;
  clientVariantTitle?: string | null;
  buyTitle?: string | null;
  buySize?: string | null;
}): boolean {
  return (
    hasWomenOrGsMarkers({
      title: params.clientTitle,
      size: params.clientSize,
      variantTitle: params.clientVariantTitle,
    }) ||
    hasWomenOrGsMarkers({
      title: params.buyTitle,
      size: params.buySize,
    })
  );
}
