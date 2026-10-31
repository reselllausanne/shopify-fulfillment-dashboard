import type { Destination } from "@/adsanalytics/explorer/destinations";

/**
 * Explorer exit rules. Every threshold is configuration, never a literal in the
 * decision function, so a batch can be re-tuned without a code change.
 */
export type ExplorerRuleConfig = {
  /** Clicks proving demand: model goes back to the core campaign. */
  discoveredClicks: number;
  /** Impressions with zero clicks: model is a zombie. */
  zombieImpressions: number;
  /** Days a zombie model must wait before it can be re-selected. */
  zombieCooldownDays: number;
  /** Impressions considered a real exposure test by the end of the batch. */
  underexposedImpressions: number;
  /** Batch duration, in days, after which the terminal rules apply. */
  batchDays: number;
  /** Days before an excluded model is offered for a new Explorer test. */
  retestAfterDays: number;
};

export const DEFAULT_EXPLORER_RULES: ExplorerRuleConfig = {
  discoveredClicks: 3,
  zombieImpressions: 100,
  zombieCooldownDays: 60,
  underexposedImpressions: 50,
  batchDays: 10,
  retestAfterDays: 60,
};

const ENV_KEYS: Record<keyof ExplorerRuleConfig, string> = {
  discoveredClicks: "ADS_EXPLORER_RULE_DISCOVERED_CLICKS",
  zombieImpressions: "ADS_EXPLORER_RULE_ZOMBIE_IMPRESSIONS",
  zombieCooldownDays: "ADS_EXPLORER_RULE_ZOMBIE_COOLDOWN_DAYS",
  underexposedImpressions: "ADS_EXPLORER_RULE_UNDEREXPOSED_IMPRESSIONS",
  batchDays: "ADS_EXPLORER_RULE_BATCH_DAYS",
  retestAfterDays: "ADS_EXPLORER_RULE_RETEST_AFTER_DAYS",
};

export function loadExplorerRuleConfig(
  overrides: Partial<ExplorerRuleConfig> = {},
  env: Record<string, string | undefined> = process.env
): ExplorerRuleConfig {
  const config = { ...DEFAULT_EXPLORER_RULES };
  for (const key of Object.keys(ENV_KEYS) as Array<keyof ExplorerRuleConfig>) {
    const raw = env[ENV_KEYS[key]];
    if (raw == null || raw.trim() === "") continue;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`Invalid ${ENV_KEYS[key]}=${raw}: expected a non-negative number`);
    }
    config[key] = parsed;
  }
  for (const [key, value] of Object.entries(overrides) as Array<
    [keyof ExplorerRuleConfig, number | undefined]
  >) {
    if (value == null) continue;
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid rule override ${key}=${value}`);
    }
    config[key] = value;
  }
  return config;
}

export type ModelRuleInput = {
  modelId: string;
  /** Current verified destination. */
  destination: Destination;
  /** Explorer campaign metrics since batch activation. */
  impressions: number;
  clicks: number;
  conversions: number;
  /** Long Tail campaign metrics since the model entered Long Tail. */
  ltConversions: number;
  /** Days elapsed since batch activation. */
  elapsedDays: number;
};

export type RuleDecision = {
  modelId: string;
  destination: Destination;
  reason: string;
  ruleId: string;
  cooldownUntil: Date | null;
  retestAt: Date | null;
};

function addDaysUtc(now: Date, days: number): Date {
  return new Date(now.getTime() + days * 86_400_000);
}

/**
 * True kill only after a real exposure test failed.
 * custom_label_3=ads_excluded — no Shopping/PMax campaign includes that label.
 */
function excludeDecision(
  base: { modelId: string },
  reason: string,
  ruleId: string,
  now: Date,
  config: ExplorerRuleConfig,
  kind: "cooldown" | "retest"
): RuleDecision {
  return {
    ...base,
    destination: "ADS_EXCLUDED",
    reason,
    ruleId,
    cooldownUntil: kind === "cooldown" ? addDaysUtc(now, config.zombieCooldownDays) : null,
    retestAt: kind === "retest" ? addDaysUtc(now, config.retestAfterDays) : null,
  };
}

/** Put the model back on the main catalog (clear label). Used when Explorer never really tested it. */
function returnToCore(
  base: { modelId: string },
  reason: string,
  ruleId: string,
  now: Date,
  config: ExplorerRuleConfig
): RuleDecision {
  return {
    ...base,
    destination: "CORE_ALL",
    reason,
    ruleId,
    cooldownUntil: null,
    // Short retest gate so the next weekly batch does not immediately re-pull the same starved SKU.
    retestAt: addDaysUtc(now, Math.min(14, config.retestAfterDays)),
  };
}

/** Rules for a model currently sitting in Explorer All. First match wins. */
export function decideExplorerDestination(
  input: ModelRuleInput,
  config: ExplorerRuleConfig,
  now: Date = new Date()
): RuleDecision | null {
  const base = { modelId: input.modelId, cooldownUntil: null, retestAt: null };

  if (input.conversions > 0) {
    return { ...base, destination: "CORE_ALL", reason: "converted", ruleId: "explorer_converted" };
  }
  if (input.clicks >= config.discoveredClicks) {
    return { ...base, destination: "CORE_ALL", reason: "discovered", ruleId: "explorer_discovered" };
  }
  // Real test failed: many imps, zero clicks → kill ads.
  if (input.impressions >= config.zombieImpressions && input.clicks === 0) {
    return excludeDecision(base, "zombie_no_click", "explorer_zombie_no_click", now, config, "cooldown");
  }
  if (input.elapsedDays < config.batchDays) return null;

  // Starved (median ~1 imp historically) — NOT a fail. Give back to core, do not exclude.
  if (input.impressions < config.underexposedImpressions) {
    return returnToCore(base, "underexposed_return", "explorer_underexposed_return", now, config);
  }
  // Got exposure + some engagement but no convert — soft kill, retest later.
  return excludeDecision(base, "inconclusive", "explorer_inconclusive", now, config, "retest");
}

/**
 * Long Tail drain: conversion → core. Else ADS_EXCLUDED (stop paying for parked junk).
 * Historical Long Tail is mostly underexposed leftovers — those still get killed here because
 * they already burned LT budget; new Explorer underexposed never enter LT anymore.
 */
export function decideLongTailDestination(
  input: ModelRuleInput,
  config: ExplorerRuleConfig,
  now: Date = new Date()
): RuleDecision | null {
  if (input.ltConversions > 0) {
    return {
      modelId: input.modelId,
      destination: "CORE_ALL",
      reason: "long_tail_converted",
      ruleId: "long_tail_converted",
      cooldownUntil: null,
      retestAt: null,
    };
  }
  return excludeDecision(
    { modelId: input.modelId },
    "long_tail_kill_no_convert",
    "long_tail_kill_no_convert",
    now,
    config,
    "retest"
  );
}

export function decideDestination(
  input: ModelRuleInput,
  config: ExplorerRuleConfig,
  now: Date = new Date()
): RuleDecision | null {
  switch (input.destination) {
    case "EXPLORER_ALL":
      return decideExplorerDestination(input, config, now);
    case "LONG_TAIL_ALL":
      return decideLongTailDestination(input, config, now);
    case "CORE_ALL":
    case "ADS_EXCLUDED":
      return null;
  }
}

/**
 * End-of-batch guarantee: past the batch window no model may still be explorer_active.
 * Undecided leftovers return to core (same as underexposed) — never invent a fail.
 */
export function decideBatchClosure(
  input: ModelRuleInput,
  config: ExplorerRuleConfig,
  now: Date = new Date()
): RuleDecision | null {
  if (input.destination !== "EXPLORER_ALL") return null;
  if (input.elapsedDays < config.batchDays) return null;
  const decision = decideExplorerDestination(input, config, now);
  if (decision) return decision;
  return returnToCore(input, "batch_closure_return", "explorer_batch_closure", now, config);
}
