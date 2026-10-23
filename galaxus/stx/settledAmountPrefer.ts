/**
 * Prefer StockX API / match settled over stale unit confirm-OCR.
 * Never let a higher unit amount clobber a lower existing (API) amount.
 */
export function preferApiSettledOverUnitOcr(
  existingAmount: unknown,
  unitAmount: unknown
): number | null {
  const existing =
    existingAmount != null && Number.isFinite(Number(existingAmount))
      ? Number(existingAmount)
      : null;
  const unit =
    unitAmount != null && Number.isFinite(Number(unitAmount)) ? Number(unitAmount) : null;
  if (existing != null && unit != null && unit > existing + 1e-9) return existing;
  if (unit != null) return unit;
  return existing;
}

/** True when unit settled looks like confirm-OCR above a lower match/API settled. */
export function unitSettledLooksLikeOcrAboveApi(
  unitSettled: unknown,
  apiOrMatchSettled: unknown
): boolean {
  if (unitSettled == null || !Number.isFinite(Number(unitSettled))) return false;
  if (apiOrMatchSettled == null || !Number.isFinite(Number(apiOrMatchSettled))) return false;
  return Number(unitSettled) > Number(apiOrMatchSettled) + 0.009;
}
