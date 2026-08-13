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
  /** Days before a Long Tail model is offered for a new Explorer test. */
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
  if (input.impressions >= config.zombieImpressions && input.clicks === 0) {
    return {
      ...base,
      destination: "LONG_TAIL_ALL",
      reason: "zombie_no_click",
      ruleId: "explorer_zombie_no_click",
      cooldownUntil: addDaysUtc(now, config.zombieCooldownDays),
    };
  }
  if (input.elapsedDays < config.batchDays) return null;

  if (input.impressions < config.underexposedImpressions) {
    return {
      ...base,
      destination: "LONG_TAIL_ALL",
      reason: "underexposed",
      ruleId: "explorer_underexposed",
      retestAt: addDaysUtc(now, config.retestAfterDays),
    };
  }
  return {
    ...base,
    destination: "LONG_TAIL_ALL",
    reason: "inconclusive",
    ruleId: "explorer_inconclusive",
    retestAt: addDaysUtc(now, config.retestAfterDays),
  };
}

/** Long Tail phase 1: any conversion promotes the model back to the core campaign. */
export function decideLongTailDestination(
  input: ModelRuleInput,
  _config: ExplorerRuleConfig,
  _now: Date = new Date()
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
  return null;
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
      return null;
  }
}

/**
 * End-of-batch guarantee: past the batch window no model may still be explorer_active.
 * Anything undecided is forced to Long Tail rather than left in Explorer.
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
  return {
    modelId: input.modelId,
    destination: "LONG_TAIL_ALL",
    reason: "inconclusive",
    ruleId: "explorer_batch_closure",
    cooldownUntil: null,
    retestAt: addDaysUtc(now, config.retestAfterDays),
  };
}
