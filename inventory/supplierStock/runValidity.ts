import type { RunValidityResult, ScrapeRunMetrics } from "./types";

const CLOUDFLARE_RE = /cloudflare|cf-ray|challenge|captcha|access denied|403 forbidden/i;
const EMPTY_PARSE_RE = /mostly empty|empty parse|0 variants|wrote=0/i;

export type RunValidityOptions = {
  minCoverageRatio?: number;
  maxErrorRate?: number;
  minListedWhenActive?: number;
  volumeDropRatio?: number;
  previousListed?: number;
};

const DEFAULTS: Required<RunValidityOptions> = {
  minCoverageRatio: 0.05,
  maxErrorRate: 0.35,
  minListedWhenActive: 1,
  volumeDropRatio: 0.02,
  previousListed: 0,
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

  const processed = Math.max(wrote, listed, 1);
  const errorRate = processed > 0 ? errors / processed : errors > 0 ? 1 : 0;
  const coverageVsPrevious =
    priorActive > 0 ? wrote / priorActive : listed > 0 ? wrote / listed : wrote > 0 ? 1 : 0;

  // Cloudflare / bot wall (check before generic empty-run — often same shape)
  if (CLOUDFLARE_RE.test(message)) {
    flags.push("cloudflare");
    return {
      valid: false,
      invalidReason: "cloudflare_block",
      completeSnapshot: false,
      errorRate,
      coverageVsPrevious,
      flags,
    };
  }

  // listed=0 with active catalog → invalid
  if (priorActive >= cfg.minListedWhenActive && listed === 0 && wrote === 0) {
    flags.push("listed_zero_with_active_catalog");
    return {
      valid: false,
      invalidReason: "listed_zero_with_active_catalog",
      completeSnapshot: false,
      errorRate,
      coverageVsPrevious,
      flags,
    };
  }

  // Volume drop vs previous listed count
  const prevListed = Math.max(cfg.previousListed, priorActive > 0 ? Math.floor(priorActive * 0.5) : 0);
  if (prevListed > 100 && listed > 0 && listed < prevListed * cfg.volumeDropRatio) {
    flags.push("volume_drop");
    return {
      valid: false,
      invalidReason: "volume_drop",
      completeSnapshot: false,
      errorRate,
      coverageVsPrevious,
      flags,
    };
  }

  // High error rate
  if (errorRate > cfg.maxErrorRate && wrote < priorActive * cfg.minCoverageRatio) {
    flags.push("high_error_rate");
    return {
      valid: false,
      invalidReason: "high_error_rate",
      completeSnapshot: false,
      errorRate,
      coverageVsPrevious,
      flags,
    };
  }

  // Mostly empty parse (listed ok but wrote≈0)
  if (listed > 50 && wrote === 0) {
    flags.push("mostly_empty_parse");
    return {
      valid: false,
      invalidReason: "mostly_empty_parse",
      completeSnapshot: false,
      errorRate,
      coverageVsPrevious,
      flags,
    };
  }

  if (EMPTY_PARSE_RE.test(message) && wrote === 0 && listed > 0) {
    flags.push("empty_parse_message");
    return {
      valid: false,
      invalidReason: "mostly_empty_parse",
      completeSnapshot: false,
      errorRate,
      coverageVsPrevious,
      flags,
    };
  }

  const completeSnapshot =
    metrics.status === "ok" &&
    listed > 0 &&
    wrote > 0 &&
    (priorActive === 0 || coverageVsPrevious >= cfg.minCoverageRatio || wrote >= listed * 0.5);

  return {
    valid: true,
    completeSnapshot,
    errorRate,
    coverageVsPrevious,
    flags,
  };
}
