import type { RunValidityResult, ScrapeRunMetrics, SnapshotCompleteness } from "./types";
import { DEFAULT_FULL_SNAPSHOT_COVERAGE, isScrapeSuccessStatus } from "./types";

const CLOUDFLARE_RE = /cloudflare|cf-ray|challenge|captcha|access denied|403 forbidden|just a moment/i;

export type RunValidityOptions = {
  /** Min coverage vs last reliable FULL snapshot — default 0.80, never 0.05. */
  minFullSnapshotCoverage?: number;
  maxErrorRate?: number;
  volumeDropRatio?: number;
  previousListed?: number;
};

const DEFAULTS = {
  minFullSnapshotCoverage: DEFAULT_FULL_SNAPSHOT_COVERAGE,
  maxErrorRate: 0.35,
  volumeDropRatio: 0.35,
};

export function evaluateScrapeRunValidity(
  metrics: ScrapeRunMetrics,
  opts: RunValidityOptions = {}
): RunValidityResult {
  const cfg = { ...DEFAULTS, ...opts };
  const flags: string[] = [];

  const listed = Math.max(0, metrics.productsListed);
  const wrote = Math.max(0, metrics.variantsUpserted);
  const errors = Math.max(0, metrics.errors);
  const priorActive = Math.max(0, metrics.priorActiveCatalog);
  const message = String(metrics.message ?? "");
  const status = String(metrics.status ?? "")
    .trim()
    .toLowerCase();

  const processed = Math.max(wrote, listed, 1);
  const errorRate = processed > 0 ? errors / processed : errors > 0 ? 1 : 0;

  const previousReliable = Math.max(
    0,
    Number(metrics.previousReliableSnapshotCount ?? opts.previousListed ?? 0) || 0
  );
  const coverageDenom = previousReliable > 0 ? previousReliable : priorActive > 0 ? priorActive : 0;
  // Coverage uses listed when available (catalog walk), else wrote — never GTIN-only as sole proof of exhaustiveness.
  const coverageNumerator = listed > 0 ? listed : wrote;
  const coverageVsPrevious = coverageDenom > 0 ? coverageNumerator / coverageDenom : listed > 0 || wrote > 0 ? 1 : 0;

  const declared = (metrics.snapshotCompleteness ?? "unknown") as SnapshotCompleteness;
  const incompletenessReason =
    metrics.incompletenessReason ??
    (metrics.partialRun ? "partial_run_flag" : declared !== "full" ? "snapshot_not_declared_full" : null);

  // Cloudflare classification even when status=error (clearer than generic run_status_error).
  if (CLOUDFLARE_RE.test(message)) {
    flags.push("cloudflare");
    return {
      valid: false,
      invalidReason: "cloudflare_block",
      completeSnapshot: false,
      snapshotCompleteness: "partial",
      incompletenessReason: "cloudflare_or_challenge",
      errorRate,
      coverageVsPrevious,
      flags,
    };
  }

  // Non-success / unfinished statuses are always invalid.
  if (!isScrapeSuccessStatus(status)) {
    flags.push(`status_${status || "missing"}`);
    const reason = status ? `run_status_${status}` : "run_status_missing";
    return {
      valid: false,
      invalidReason: reason,
      completeSnapshot: false,
      snapshotCompleteness: "partial",
      incompletenessReason: incompletenessReason ?? reason,
      errorRate,
      coverageVsPrevious,
      flags,
    };
  }

  if (!metrics.finishedAt) {
    flags.push("finish_missing");
    return {
      valid: false,
      invalidReason: "run_finish_missing",
      completeSnapshot: false,
      snapshotCompleteness: "partial",
      incompletenessReason: "finished_at_missing",
      errorRate,
      coverageVsPrevious,
      flags,
    };
  }

  if (priorActive > 0 && listed === 0 && wrote === 0) {
    flags.push("listed_zero_with_active_catalog");
    return {
      valid: false,
      invalidReason: "listed_zero_with_active_catalog",
      completeSnapshot: false,
      snapshotCompleteness: "partial",
      incompletenessReason: "empty_run_on_active_catalog",
      errorRate,
      coverageVsPrevious,
      flags,
    };
  }

  if (metrics.partialRun) {
    flags.push("partial_run");
    // Partial runs can still be "valid" for evidence of observed rows, but never complete.
    // If empty on active catalog already handled; otherwise continue validity checks.
  }

  if (previousReliable > 100 && listed > 0 && listed < previousReliable * cfg.volumeDropRatio) {
    flags.push("volume_drop");
    return {
      valid: false,
      invalidReason: "volume_drop",
      completeSnapshot: false,
      snapshotCompleteness: "partial",
      incompletenessReason: "abnormal_volume_drop",
      errorRate,
      coverageVsPrevious,
      flags,
    };
  }

  if (errorRate > cfg.maxErrorRate && wrote === 0 && listed > 0) {
    flags.push("high_error_rate");
    return {
      valid: false,
      invalidReason: "high_error_rate",
      completeSnapshot: false,
      snapshotCompleteness: "partial",
      incompletenessReason: "error_rate_too_high",
      errorRate,
      coverageVsPrevious,
      flags,
    };
  }

  if (listed > 50 && wrote === 0) {
    flags.push("mostly_empty_parse");
    return {
      valid: false,
      invalidReason: "mostly_empty_parse",
      completeSnapshot: false,
      snapshotCompleteness: "partial",
      incompletenessReason: "listed_but_no_writes",
      errorRate,
      coverageVsPrevious,
      flags,
    };
  }

  // Complete snapshot ONLY when scraper explicitly declares full + success + not partial + coverage ≥ threshold.
  const coverageOk =
    previousReliable === 0 || coverageVsPrevious >= cfg.minFullSnapshotCoverage;
  const completeSnapshot =
    declared === "full" &&
    !metrics.partialRun &&
    coverageOk &&
    listed > 0;

  if (declared === "full" && !completeSnapshot) {
    flags.push("full_declared_but_guards_failed");
  }

  if (!completeSnapshot && previousReliable > 0 && coverageVsPrevious < cfg.minFullSnapshotCoverage) {
    flags.push("coverage_below_threshold_review");
  }

  return {
    valid: true,
    completeSnapshot,
    snapshotCompleteness: completeSnapshot ? "full" : declared === "full" ? "partial" : declared,
    incompletenessReason: completeSnapshot
      ? null
      : incompletenessReason ??
        (!coverageOk ? "coverage_below_threshold" : "snapshot_not_full"),
    errorRate,
    coverageVsPrevious,
    flags,
  };
}
