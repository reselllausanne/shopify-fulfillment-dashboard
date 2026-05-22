/**
 * Shopify Admin `Order.risk` (OrderRiskSummary) → compact fields for matching UI.
 * @see https://shopify.dev/docs/api/admin-graphql/latest/objects/OrderRiskSummary
 */

const RISK_LEVEL_RANK: Record<string, number> = {
  HIGH: 4,
  MEDIUM: 3,
  PENDING: 2,
  LOW: 1,
  NONE: 0,
};

export type NormalizedOrderRisk = {
  /** Worst `riskLevel` across assessments (HIGH > MEDIUM > …). */
  fraudRiskLevel: string | null;
  /** `OrderRiskRecommendationResult`: ACCEPT | CANCEL | INVESTIGATE | NONE */
  fraudRecommendation: string | null;
  /** Short label for badges, e.g. "HIGH · CANCEL" */
  fraudSummaryLabel: string;
};

export function normalizeOrderRisk(risk: any | null | undefined): NormalizedOrderRisk {
  if (!risk) {
    return {
      fraudRiskLevel: null,
      fraudRecommendation: null,
      fraudSummaryLabel: "Fraud: —",
    };
  }

  const recommendation = (risk.recommendation as string | null | undefined) ?? null;
  const assessments = Array.isArray(risk.assessments) ? risk.assessments : [];

  let fraudRiskLevel: string | null = null;
  let bestRank = -1;
  for (const a of assessments) {
    const lv = a?.riskLevel as string | undefined;
    if (!lv) continue;
    const r = RISK_LEVEL_RANK[lv] ?? 0;
    if (r > bestRank) {
      bestRank = r;
      fraudRiskLevel = lv;
    }
  }

  const parts: string[] = [];
  if (fraudRiskLevel) parts.push(fraudRiskLevel);
  if (recommendation && recommendation !== "NONE") parts.push(recommendation);
  const fraudSummaryLabel = parts.length ? `Fraud: ${parts.join(" · ")}` : "Fraud: OK";

  return { fraudRiskLevel, fraudRecommendation: recommendation, fraudSummaryLabel };
}

/** Card styling: HIGH / CANCEL = do not buy. */
export function shopifyFraudUiTone(
  r: Pick<NormalizedOrderRisk, "fraudRiskLevel" | "fraudRecommendation">
): "danger" | "warn" | "ok" | "muted" {
  const rec = (r.fraudRecommendation || "").toUpperCase();
  const lv = (r.fraudRiskLevel || "").toUpperCase();
  if (rec === "CANCEL" || lv === "HIGH") return "danger";
  if (rec === "INVESTIGATE" || lv === "MEDIUM" || lv === "PENDING") return "warn";
  if (lv === "LOW" || rec === "ACCEPT") return "ok";
  return "muted";
}
