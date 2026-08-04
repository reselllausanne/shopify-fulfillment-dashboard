/** Public portal: FAQ exclusions (CHF 650+ and Soldes / promo). */
export const PUBLIC_RETURN_MAX_UNIT_PRICE_CHF = 650;

export type ReturnExcludeReason = "PRICE_OVER_LIMIT" | "SALE_OR_PROMO";

export type ReturnEligibilityInput = {
  unitAmount: number | null;
  currencyCode?: string | null;
  compareAtPrice?: number | null;
  delivery48h?: string | null;
  priceLocked?: string | null;
  productTags?: string[] | null;
  collectionHandles?: string[] | null;
};

function isTruthyMetafield(value: string | null | undefined): boolean {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

function normalizeHandle(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/** Soldes / liquidation / archive collection handles + loose match. */
export function isSaleCollectionHandle(handle: string): boolean {
  const h = normalizeHandle(handle);
  if (!h) return false;
  if (
    h === "soldes" ||
    h === "soldes-48h" ||
    h === "soldes48h" ||
    h === "liquidation" ||
    h === "archive" ||
    h === "archives"
  ) {
    return true;
  }
  return h.includes("solde") || h.includes("liquidation") || h.includes("archive");
}

export function hasSaleTag(tags: string[] | null | undefined): boolean {
  for (const tag of tags ?? []) {
    const t = normalizeHandle(tag);
    if (!t) continue;
    if (t.includes("solde") || t.includes("liquidation") || t.includes("archive")) return true;
  }
  return false;
}

/** Prix barré: compare-at meaningfully above paid unit price. */
export function hasCompareAtPromo(unitAmount: number | null, compareAtPrice: number | null): boolean {
  if (unitAmount == null || compareAtPrice == null) return false;
  if (!Number.isFinite(unitAmount) || !Number.isFinite(compareAtPrice)) return false;
  return compareAtPrice > unitAmount + 0.01;
}

export function isPriceOverReturnLimit(
  unitAmount: number | null,
  currencyCode: string | null | undefined = "CHF",
  max = PUBLIC_RETURN_MAX_UNIT_PRICE_CHF
): boolean {
  if (unitAmount == null || !Number.isFinite(unitAmount)) return false;
  const currency = String(currencyCode ?? "CHF").trim().toUpperCase() || "CHF";
  // Shop money for this store is CHF; skip hard cut for other currencies.
  if (currency !== "CHF") return false;
  return unitAmount > max;
}

export function isSaleOrPromoItem(input: ReturnEligibilityInput): boolean {
  if (isTruthyMetafield(input.delivery48h)) return true;
  if (isTruthyMetafield(input.priceLocked)) return true;
  if (hasSaleTag(input.productTags)) return true;
  if ((input.collectionHandles ?? []).some(isSaleCollectionHandle)) return true;
  // Prix barré only (FAQ). Checkout code discounts (e.g. FIRST10) are NOT an exclusion.
  if (hasCompareAtPromo(input.unitAmount, input.compareAtPrice ?? null)) return true;
  return false;
}

export function resolveReturnExcludeReason(
  input: ReturnEligibilityInput
): ReturnExcludeReason | null {
  if (isPriceOverReturnLimit(input.unitAmount, input.currencyCode)) return "PRICE_OVER_LIMIT";
  if (isSaleOrPromoItem(input)) return "SALE_OR_PROMO";
  return null;
}

export function splitReturnableByEligibility<T extends ReturnEligibilityInput>(
  lines: T[]
): {
  allowed: T[];
  excluded: Array<T & { excludeReason: ReturnExcludeReason }>;
} {
  const allowed: T[] = [];
  const excluded: Array<T & { excludeReason: ReturnExcludeReason }> = [];
  for (const line of lines) {
    const reason = resolveReturnExcludeReason(line);
    if (reason) excluded.push({ ...line, excludeReason: reason });
    else allowed.push(line);
  }
  return { allowed, excluded };
}
