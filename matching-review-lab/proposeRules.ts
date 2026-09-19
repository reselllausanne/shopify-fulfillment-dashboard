/**
 * Controlled "learning" — propose rules from reviews, never apply them.
 */

import type {
  LabReviewRecord,
  MatchingReviewDecision,
  MatchingReviewReasonCode,
  MatchingRulesReport,
  ProposedMatchingRule,
} from "./types";
import { MATCHING_REVIEW_REASONS } from "./types";

function emptyDecisionCounts(): Record<MatchingReviewDecision, number> {
  return {
    CORRECT: 0,
    WRONG_PICK_BUY: 0,
    NO_STOCKX_MATCH: 0,
    SPECIAL_EQUIVALENCE: 0,
    NEVER_AUTO_MATCH: 0,
  };
}

export function buildRulesReport(reviews: LabReviewRecord[]): MatchingRulesReport {
  const decisionCounts = emptyDecisionCounts();
  const reasonCounts: Partial<Record<MatchingReviewReasonCode, number>> = {};
  const skuErrors = new Map<string, { count: number; examples: string[] }>();
  const sizeEq = new Map<string, { from: string; to: string; count: number; examples: string[] }>();
  const accountErrors = new Map<string, { expected: string; proposed: string; count: number }>();
  const causalErrors: MatchingRulesReport["causalDateErrors"] = [];
  const missingData: string[] = [];
  const generalizableRules: ProposedMatchingRule[] = [];
  const manualOnlyExceptions: ProposedMatchingRule[] = [];

  for (const r of reviews) {
    decisionCounts[r.decision] = (decisionCounts[r.decision] ?? 0) + 1;
    for (const code of r.reasonCodes) {
      reasonCounts[code] = (reasonCounts[code] ?? 0) + 1;
    }

    if (r.reasonCodes.includes("WRONG_PRODUCT") || r.reasonCodes.includes("WRONG_SIZE")) {
      const key = `${r.skuNormalized ?? r.skuRaw ?? "?"}→${r.chosenBuyOrderNumber ?? "none"}`;
      const prev = skuErrors.get(key) ?? { count: 0, examples: [] };
      prev.count += 1;
      if (prev.examples.length < 5) prev.examples.push(r.unitKey);
      skuErrors.set(key, prev);
    }

    if (
      r.reasonCodes.includes("WRONG_SIZE") ||
      r.reasonCodes.includes("WRONG_GENDER_OR_SIZE_SYSTEM") ||
      r.reasonCodes.includes("VALID_EQUIVALENCE_TO_REVIEW")
    ) {
      const from = r.sizeNormalized ?? r.sizeRaw ?? "?";
      const to = String((r.evidence?.chosen as any)?.sizeEU ?? "?");
      const mapKey = `${from}=>${to}`;
      const prev = sizeEq.get(mapKey) ?? { from, to, count: 0, examples: [] };
      prev.count += 1;
      if (prev.examples.length < 5) prev.examples.push(r.orderNumber);
      sizeEq.set(mapKey, prev);
    }

    if (r.reasonCodes.includes("WRONG_STOCKX_ACCOUNT")) {
      const expected = String(r.proposedAccountKey ?? "unknown");
      const proposed = String(r.chosenAccountKey ?? r.proposedAccountKey ?? "unknown");
      const mapKey = `${expected}|${proposed}`;
      const prev = accountErrors.get(mapKey) ?? { expected, proposed, count: 0 };
      prev.count += 1;
      accountErrors.set(mapKey, prev);
    }

    if (r.reasonCodes.includes("WRONG_CAUSAL_DATE")) {
      causalErrors.push({
        unitKey: r.unitKey,
        orderDate: r.orderDate,
        buyDate: r.proposedPurchaseDate ?? r.chosenPurchaseDate ?? "",
      });
    }

    if (!r.gtinRaw) missingData.push(`${r.unitKey}:missing_gtin`);
    if (!r.skuRaw) missingData.push(`${r.unitKey}:missing_sku`);
    if (!r.sizeRaw) missingData.push(`${r.unitKey}:missing_size`);

    if (r.decision === "NEVER_AUTO_MATCH" || r.decision === "SPECIAL_EQUIVALENCE") {
      manualOnlyExceptions.push({
        id: `manual-${r.id.slice(0, 8)}`,
        title: `Manual-only: ${r.decision} on ${r.orderNumber}`,
        conditions: [
          `channel=${r.channel}`,
          `sku=${r.skuNormalized ?? r.skuRaw ?? "n/a"}`,
          `size=${r.sizeNormalized ?? r.sizeRaw ?? "n/a"}`,
          ...r.reasonCodes.map((c) => `reason=${c}`),
        ],
        confirmingCaseCount: 1,
        confirmingUnitKeys: [r.unitKey],
        counterExamples: [],
        affectedOrders: [r.orderNumber],
        risk: "high",
        proposedUnitTest: `it("keeps ${r.orderNumber} as manual-only — never auto-match", () => { expect(decision).toBe("${r.decision}"); });`,
        applied: false,
      });
    }
  }

  // Propose generalizable rules only when ≥2 confirming cases of same reason pattern.
  for (const code of MATCHING_REVIEW_REASONS) {
    const count = reasonCounts[code] ?? 0;
    if (count < 2) continue;
    if (code === "ONE_OFF_MANUAL_EXCEPTION" || code === "NO_STOCKX_PURCHASE") continue;

    const confirming = reviews.filter((r) => r.reasonCodes.includes(code));
    const counterExamples = reviews
      .filter((r) => r.decision === "CORRECT" && !r.reasonCodes.includes(code))
      .slice(0, 3)
      .map((r) => r.unitKey);

    generalizableRules.push({
      id: `rule-${code.toLowerCase()}`,
      title: `Proposed filter/hardening for ${code}`,
      conditions: [
        `reasonCode=${code}`,
        "humanValidated=true",
        "applied=false (requires separate PR)",
      ],
      confirmingCaseCount: count,
      confirmingUnitKeys: confirming.map((r) => r.unitKey).slice(0, 20),
      counterExamples,
      affectedOrders: [...new Set(confirming.map((r) => r.orderNumber))].slice(0, 20),
      risk: code === "VALID_EQUIVALENCE_TO_REVIEW" ? "high" : "medium",
      proposedUnitTest: [
        `it("applies ${code} guard when conditions match", () => {`,
        `  // Arrange fixture from reviews confirming ${code}`,
        `  // Assert matcher refuses or routes to review`,
        `  expect(proposal.refusalReasons).toContain("${code}");`,
        `});`,
      ].join("\n"),
      applied: false,
    });
  }

  // Size equivalences with ≥2 hits → proposed rule (not applied).
  for (const eq of sizeEq.values()) {
    if (eq.count < 2) continue;
    generalizableRules.push({
      id: `size-eq-${eq.from}-${eq.to}`.replace(/\s+/g, ""),
      title: `Size equivalence candidate: ${eq.from} ↔ ${eq.to}`,
      conditions: [
        `clientSizeNormalized=${eq.from}`,
        `stockxSizeNormalized=${eq.to}`,
        "requires human PR — never auto Women/GS alias",
      ],
      confirmingCaseCount: eq.count,
      confirmingUnitKeys: eq.examples,
      counterExamples: [],
      affectedOrders: eq.examples,
      risk: "high",
      proposedUnitTest: `it("documents size equivalence ${eq.from}↔${eq.to} without auto-applying", () => { expect(applied).toBe(false); });`,
      applied: false,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    reviewCount: reviews.length,
    decisionCounts,
    reasonCounts,
    frequentSkuNormalizationErrors: Array.from(skuErrors.entries()).map(([pattern, v]) => ({
      pattern,
      count: v.count,
      examples: v.examples,
    })),
    recurrentSizeEquivalences: Array.from(sizeEq.values()).sort((a, b) => b.count - a.count),
    stockxAccountErrors: Array.from(accountErrors.values()),
    causalDateErrors: causalErrors,
    missingData: [...new Set(missingData)].slice(0, 50),
    generalizableRules,
    manualOnlyExceptions,
    note:
      "Rules are proposals only. Do not auto-add Women/GS aliases, title-similarity links, or promote one-off corrections to global rules. Validate in a separate PR.",
  };
}
