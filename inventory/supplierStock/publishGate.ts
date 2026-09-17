import {
  globalPauseZeroDecision,
  reviewBlockedDecision,
} from "./quantity";
import type { SupplierStockPolicyStatus } from "./types";
import { FIRST_INVALID_GRACE_MS, PROOF_MAX_AGE_MS, TEMPORARY_MONITORING_EXCEPTION } from "./types";

export function resolveSupplierKeyFromIds(supplierVariantId: string): string | null {
  const id = String(supplierVariantId ?? "").trim();
  const idx = id.indexOf("_");
  if (idx <= 0) return null;
  return id.slice(0, idx).toLowerCase();
}

function isPausedStatus(status: SupplierStockPolicyStatus | null | undefined): boolean {
  return status === "paused_due_to_scrape_failure" || status === "manually_paused";
}

function hasFreshProof(lastProofAt: Date | null | undefined, now: Date, maxAgeMs = PROOF_MAX_AGE_MS): boolean {
  if (!lastProofAt) return false;
  const ts = lastProofAt instanceof Date ? lastProofAt.getTime() : new Date(lastProofAt).getTime();
  if (!Number.isFinite(ts)) return false;
  return now.getTime() - ts <= maxAgeMs;
}

/**
 * Gate marketplace-visible stock.
 * - manualLock: passthrough
 * - paused: 0
 * - review_required: 0
 * - monitoring_only (TEMPORARY_MONITORING_EXCEPTION): passthrough baseStock
 * - approved: evidence publishedQty only when lastProofAt is fresh source proof
 * Historical SupplierVariant.stock alone never renews proof.
 */
export function applySupplierStockPublishGate(input: {
  baseStock: number;
  policyStatus?: SupplierStockPolicyStatus | null;
  evidencePublishedQty?: number | null;
  lastProofAt?: Date | null;
  manualLock?: boolean | null;
  now?: Date;
  /** After first invalid run, keep last proof for FIRST_INVALID_GRACE_MS. */
  useFirstInvalidGrace?: boolean;
}): number {
  if (input.manualLock) {
    return Math.max(0, Math.floor(Number(input.baseStock) || 0));
  }

  const now = input.now ?? new Date();
  const status = input.policyStatus ?? "review_required";

  if (isPausedStatus(status)) {
    return globalPauseZeroDecision().publishedQty;
  }

  if (status === "review_required") {
    return reviewBlockedDecision().publishedQty;
  }

  if (status === "monitoring_only") {
    // TEMPORARY_MONITORING_EXCEPTION — do not alter WEL/REI live export during freeze.
    void TEMPORARY_MONITORING_EXCEPTION;
    return Math.max(0, Math.floor(Number(input.baseStock) || 0));
  }

  const maxAge = input.useFirstInvalidGrace ? FIRST_INVALID_GRACE_MS : PROOF_MAX_AGE_MS;
  if (!hasFreshProof(input.lastProofAt, now, maxAge)) {
    return 0;
  }

  if (input.evidencePublishedQty != null) {
    return Math.max(0, Math.floor(Number(input.evidencePublishedQty) || 0));
  }

  return 0;
}
