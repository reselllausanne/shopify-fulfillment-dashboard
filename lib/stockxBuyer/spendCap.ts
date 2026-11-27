/**
 * Session spend ceiling for one buyer relaunch (both StockX accounts).
 * Crossing the cap halts the worker. It is not a card decline and not a retry.
 */

export function parseSpendCapChf(raw: string | undefined): number | null {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function addPurchaseSpend(spentChf: number, totalChf: number | null | undefined): number {
  const n = Number(totalChf);
  if (!Number.isFinite(n) || n <= 0) return spentChf;
  return Math.round((spentChf + n) * 100) / 100;
}

/** True once this run's all-in total has reached the cap. */
export function sessionSpendReached(spentChf: number, capChf: number | null | undefined): boolean {
  if (capChf == null || !(capChf > 0)) return false;
  return spentChf >= capChf - 0.001;
}

/** Halt text. 6000 CHF is exactly "cap 6k" — never a card-decline phrase. */
export function spendCapHaltReason(capChf: number): string {
  if (Math.abs(capChf - 6000) < 0.001) return "cap 6k";
  const k = capChf / 1000;
  if (Number.isInteger(k) && k >= 1) return `cap ${k}k`;
  return `cap ${capChf}chf`;
}

export function resumeSessionSpend(
  saved: { session: string; spentChf: number; capChf: number } | null,
  session: string,
  capChf: number | null
): number {
  if (capChf == null || !saved) return 0;
  if (saved.session !== session) return 0;
  if (Math.abs(Number(saved.capChf) - capChf) > 0.001) return 0;
  const n = Number(saved.spentChf);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
