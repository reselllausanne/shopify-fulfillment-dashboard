import { describe, expect, it } from "vitest";

import {
  DEFAULT_EXPLORER_RULES,
  decideBatchClosure,
  decideDestination,
  decideExplorerDestination,
  decideLongTailDestination,
  loadExplorerRuleConfig,
  type ModelRuleInput,
} from "@/adsanalytics/explorer/rules";

const NOW = new Date("2026-08-10T00:00:00.000Z");

function model(overrides: Partial<ModelRuleInput> = {}): ModelRuleInput {
  return {
    modelId: "1",
    destination: "EXPLORER_ALL",
    impressions: 0,
    clicks: 0,
    conversions: 0,
    ltConversions: 0,
    elapsedDays: 2,
    ...overrides,
  };
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

describe("explorer exit rules", () => {
  it("rule 1: a conversion sends the model back to CORE_ALL", () => {
    const decision = decideExplorerDestination(
      model({ conversions: 1, impressions: 4, clicks: 1 }),
      DEFAULT_EXPLORER_RULES,
      NOW
    );
    expect(decision).toMatchObject({ destination: "CORE_ALL", reason: "converted" });
    expect(decision?.cooldownUntil).toBeNull();
    expect(decision?.retestAt).toBeNull();
  });

  it("rule 2: three clicks without conversion is discovered demand", () => {
    const decision = decideExplorerDestination(
      model({ clicks: 3, impressions: 40 }),
      DEFAULT_EXPLORER_RULES,
      NOW
    );
    expect(decision).toMatchObject({ destination: "CORE_ALL", reason: "discovered" });
  });

  it("rule 2 does not fire below the configured click threshold", () => {
    const decision = decideExplorerDestination(
      model({ clicks: 2, impressions: 40 }),
      DEFAULT_EXPLORER_RULES,
      NOW
    );
    expect(decision).toBeNull();
  });

  it("rule 3: 100 impressions and zero clicks is a zombie with a 60 day cooldown", () => {
    const decision = decideExplorerDestination(
      model({ impressions: 100, clicks: 0 }),
      DEFAULT_EXPLORER_RULES,
      NOW
    );
    expect(decision).toMatchObject({ destination: "LONG_TAIL_ALL", reason: "zombie_no_click" });
    expect(decision?.cooldownUntil).not.toBeNull();
    expect(daysBetween(NOW, decision!.cooldownUntil!)).toBe(60);
  });

  it("rule 3 fires before day 10 because it does not depend on batch age", () => {
    const decision = decideExplorerDestination(
      model({ impressions: 250, clicks: 0, elapsedDays: 1 }),
      DEFAULT_EXPLORER_RULES,
      NOW
    );
    expect(decision?.reason).toBe("zombie_no_click");
  });

  it("rule 4: under 50 impressions at day 10 is underexposed with a retest date", () => {
    const decision = decideExplorerDestination(
      model({ impressions: 12, clicks: 1, elapsedDays: 10 }),
      DEFAULT_EXPLORER_RULES,
      NOW
    );
    expect(decision).toMatchObject({ destination: "LONG_TAIL_ALL", reason: "underexposed" });
    expect(daysBetween(NOW, decision!.retestAt!)).toBe(60);
    expect(decision?.cooldownUntil).toBeNull();
  });

  it("rule 5: exposed but no positive threshold at day 10 is inconclusive", () => {
    const decision = decideExplorerDestination(
      model({ impressions: 80, clicks: 2, elapsedDays: 10 }),
      DEFAULT_EXPLORER_RULES,
      NOW
    );
    expect(decision).toMatchObject({ destination: "LONG_TAIL_ALL", reason: "inconclusive" });
    expect(decision?.retestAt).not.toBeNull();
  });

  it("keeps a model in Explorer while the batch window is still open", () => {
    expect(
      decideExplorerDestination(
        model({ impressions: 80, clicks: 2, elapsedDays: 9 }),
        DEFAULT_EXPLORER_RULES,
        NOW
      )
    ).toBeNull();
  });

  it("applies rules in priority order: conversion beats zombie", () => {
    const decision = decideExplorerDestination(
      model({ impressions: 500, clicks: 0, conversions: 2 }),
      DEFAULT_EXPLORER_RULES,
      NOW
    );
    expect(decision?.reason).toBe("converted");
  });
});

describe("long tail phase 1", () => {
  it("promotes a converting Long Tail model back to CORE_ALL", () => {
    const decision = decideLongTailDestination(
      model({ destination: "LONG_TAIL_ALL", ltConversions: 1 }),
      DEFAULT_EXPLORER_RULES,
      NOW
    );
    expect(decision).toMatchObject({ destination: "CORE_ALL", reason: "long_tail_converted" });
  });

  it("leaves a non converting Long Tail model where it is", () => {
    expect(
      decideLongTailDestination(
        model({ destination: "LONG_TAIL_ALL", impressions: 9000, clicks: 40 }),
        DEFAULT_EXPLORER_RULES,
        NOW
      )
    ).toBeNull();
  });

  it("never moves a CORE_ALL model", () => {
    expect(
      decideDestination(
        model({ destination: "CORE_ALL", conversions: 5, clicks: 90 }),
        DEFAULT_EXPLORER_RULES,
        NOW
      )
    ).toBeNull();
  });
});

describe("batch closure", () => {
  it("forces every remaining Explorer model out at the end of the batch", () => {
    const decision = decideBatchClosure(
      model({ impressions: 60, clicks: 1, elapsedDays: 11 }),
      DEFAULT_EXPLORER_RULES,
      NOW
    );
    expect(decision?.destination).toBe("LONG_TAIL_ALL");
  });

  it("does not close a batch that is still running", () => {
    expect(
      decideBatchClosure(model({ elapsedDays: 3 }), DEFAULT_EXPLORER_RULES, NOW)
    ).toBeNull();
  });
});

describe("rule configuration", () => {
  it("reads thresholds from the environment", () => {
    const config = loadExplorerRuleConfig(
      {},
      { ADS_EXPLORER_RULE_DISCOVERED_CLICKS: "5", ADS_EXPLORER_RULE_BATCH_DAYS: "14" }
    );
    expect(config.discoveredClicks).toBe(5);
    expect(config.batchDays).toBe(14);
    expect(config.zombieImpressions).toBe(DEFAULT_EXPLORER_RULES.zombieImpressions);
  });

  it("lets explicit overrides win over the environment", () => {
    const config = loadExplorerRuleConfig(
      { discoveredClicks: 2 },
      { ADS_EXPLORER_RULE_DISCOVERED_CLICKS: "5" }
    );
    expect(config.discoveredClicks).toBe(2);
  });

  it("rejects a non numeric threshold", () => {
    expect(() =>
      loadExplorerRuleConfig({}, { ADS_EXPLORER_RULE_ZOMBIE_IMPRESSIONS: "many" })
    ).toThrow(/ADS_EXPLORER_RULE_ZOMBIE_IMPRESSIONS/);
  });

  it("changes the decision when the threshold changes", () => {
    const strict = loadExplorerRuleConfig({ discoveredClicks: 10 });
    expect(decideExplorerDestination(model({ clicks: 3 }), strict, NOW)).toBeNull();
    const loose = loadExplorerRuleConfig({ discoveredClicks: 1 });
    expect(decideExplorerDestination(model({ clicks: 3 }), loose, NOW)?.reason).toBe("discovered");
  });
});
