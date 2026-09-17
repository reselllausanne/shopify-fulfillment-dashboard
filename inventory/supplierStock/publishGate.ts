import {
  globalPauseZeroDecision,
  reviewBlockedDecision,
} from "./quantity";
import type { SupplierStockPolicyStatus } from "./types";

const PROOF_MAX_AGE_MS = 48 * 60 * 60 * 1000;

export function resolveSupplierKeyFromIds(supplierVariantId: string): string | null {
  const id = String(supplierVariantId ?? "").trim();
  const idx = id.indexOf("_");
  if (idx <= 0) return null;
  return id.slice(0, idx).toLowerCase();
}

function isPausedStatus(status: SupplierStockPolicyStatus | null | undefined): boolean {
  return status === "paused_due_to_scrape_failure" || status === "manually_paused";
}

function hasFreshProof(lastProofAt: Date | null | undefined, now: Date): boolean {
  if (!lastProofAt) return false;
  const ts = lastProofAt instanceof Date ? lastProofAt.getTime() : new Date(lastProofAt).getTime();
  if (!Number.isFinite(ts)) return false;
  return now.getTime() - ts <= PROOF_MAX_AGE_MS;
}

/**
 * Gate marketplace-visible stock.
 * - manualLock: passthrough (caller)
 * - paused: 0
 * - review_required: 0
 * - monitoring_only: passthrough baseStock (do not break WEL/REI live export)
 * - approved: evidence publishedQty only when fresh proof exists; else 0
 */
export function applySupplierStockPublishGate(input: {
  baseStock: number;
  policyStatus?: SupplierStockPolicyStatus | null;
  evidencePublishedQty?: number | null;
  lastProofAt?: Date | null;
  manualLock?: boolean | null;
  now?: Date;
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
    return Math.max(0, Math.floor(Number(input.baseStock) || 0));
  }

  // approved — require fresh proof (no historical qty without it)
  if (!hasFreshProof(input.lastProofAt, now)) {
    return 0;
  }

  if (input.evidencePublishedQty != null) {
    return Math.max(0, Math.floor(Number(input.evidencePublishedQty) || 0));
  }

  return 0;
}
