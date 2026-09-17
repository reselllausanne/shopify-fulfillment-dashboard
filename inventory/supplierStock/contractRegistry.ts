/**
 * Honest registry: which scrapers actually emit SupplierVariantObservation.
 * Call sites finalize runs — they do NOT prove pages. Until a scraper is wired
 * to the observation adapter, contractImplemented stays false.
 *
 * Do not mark approved when observationContractImplemented=false.
 */

export type SupplierContractStatus = {
  supplierKey: string;
  displayName: string;
  /** Scraper code emits SupplierVariantObservation payloads for this run. */
  observationContractImplemented: boolean;
  /** Human-validated on staging with qualification checklist. */
  observationContractValidated: boolean;
  notes: string;
};

const DISPLAY: Record<string, string> = {
  wel: "WellPlayed",
  rei: "Reichelt",
  bae: "Bächli",
  fan: "FantasyWelt",
  exl: "Ex Libris",
  haw: "Hawk",
  wrk: "Warenkontor",
  bwz: "Baby-Walz",
  tus: "The Uncommon Shop",
  alt: "Alternate",
  ven: "Venova",
  hhv: "HHV",
  snl: "Snowleader",
  nso: "Newsole",
};

/** All scrapers currently pending — none emit the contract yet. */
const CONTRACT_IMPLEMENTED: Record<string, boolean> = {
  wel: false,
  rei: false,
  bae: false,
  fan: false,
  exl: false,
  haw: false,
  wrk: false,
  bwz: false,
  tus: false,
  alt: false,
  ven: false,
  hhv: false,
  snl: false,
  nso: false,
};

export function listSupplierContractStatuses(): SupplierContractStatus[] {
  return Object.keys(DISPLAY).map((supplierKey) => getSupplierContractStatus(supplierKey));
}

export function getSupplierContractStatus(supplierKey: string): SupplierContractStatus {
  const key = String(supplierKey ?? "")
    .trim()
    .toLowerCase();
  const implemented = Boolean(CONTRACT_IMPLEMENTED[key]);
  return {
    supplierKey: key,
    displayName: DISPLAY[key] ?? key.toUpperCase(),
    observationContractImplemented: implemented,
    observationContractValidated: false,
    notes: implemented
      ? "Scraper emits SupplierVariantObservation"
      : "Pending — runner finalizes runs but scraper does not yet emit page proofs",
  };
}

export function isObservationContractImplemented(supplierKey: string): boolean {
  return getSupplierContractStatus(supplierKey).observationContractImplemented;
}

/**
 * Approval eligibility: contract must be implemented in scraper code.
 * Runtime observationsReceivedThisRun is checked separately at approve time.
 */
export function isEligibleForApproval(input: {
  supplierKey: string;
  observationContractImplemented?: boolean;
  observationsReceivedThisRun?: number;
  sourceProofCoverage?: number | null;
}): {
  eligibleForApproval: boolean;
  reason: string | null;
  observationContractImplemented: boolean;
} {
  const implemented =
    input.observationContractImplemented ?? isObservationContractImplemented(input.supplierKey);
  if (!implemented) {
    return {
      eligibleForApproval: false,
      reason: "observation_contract_not_implemented",
      observationContractImplemented: false,
    };
  }
  if (input.observationsReceivedThisRun != null && input.observationsReceivedThisRun <= 0) {
    return {
      eligibleForApproval: false,
      reason: "no_observations_received",
      observationContractImplemented: true,
    };
  }
  return {
    eligibleForApproval: true,
    reason: null,
    observationContractImplemented: true,
  };
}

export type RunContractReport = {
  observationContractImplemented: boolean;
  observationsReceivedThisRun: number;
  /** Share of processed variants that had valid fresh proof (0–1). */
  sourceProofCoverage: number | null;
  eligibleForApproval: boolean;
  eligibleForApprovalReason: string | null;
};

export function buildRunContractReport(input: {
  supplierKey: string;
  observationsReceivedThisRun: number;
  variantsWithFreshProof?: number;
  variantsProcessed?: number;
}): RunContractReport {
  const implemented = isObservationContractImplemented(input.supplierKey);
  const processed = Math.max(0, input.variantsProcessed ?? input.observationsReceivedThisRun);
  const withProof = Math.max(0, input.variantsWithFreshProof ?? 0);
  const coverage =
    processed > 0 ? Math.min(1, withProof / processed) : input.observationsReceivedThisRun > 0 ? null : 0;

  const eligibility = isEligibleForApproval({
    supplierKey: input.supplierKey,
    observationContractImplemented: implemented,
    observationsReceivedThisRun: input.observationsReceivedThisRun,
    sourceProofCoverage: coverage,
  });

  return {
    observationContractImplemented: implemented,
    observationsReceivedThisRun: Math.max(0, input.observationsReceivedThisRun),
    sourceProofCoverage: coverage,
    eligibleForApproval: eligibility.eligibleForApproval,
    eligibleForApprovalReason: eligibility.reason,
  };
}
