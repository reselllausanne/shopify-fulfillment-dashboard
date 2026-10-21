import {
  MAX_ALL_IN_CHF,
  type StockxDesiredLane,
  type StockxLaneCard,
  type StockxLaneLabel,
  type StockxNeedsHumanReason,
} from "@/lib/stockxAutoCheckout/types";

export function classifyLaneLabel(raw: string): StockxLaneLabel {
  const t = String(raw || "").toLowerCase();
  if (/\b(express|xpress)\b/.test(t)) return "EXPRESS";
  if (/\bstandard\b/.test(t)) return "STANDARD";
  return "UNKNOWN";
}

export function moneyToNumber(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d,.-]/g, "").replace(/\s/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Parse Standard / Express / Xpress cards + CHF from checkout body text. */
export function parseLaneCardsFromText(text: string): StockxLaneCard[] {
  const out: StockxLaneCard[] = [];
  const re =
    /\b(Standard|Express|Xpress)\b[^\n]{0,120}?(\d{1,3}(?:[’'\s]\d{3})*(?:[.,]\d{2})?)\s*CHF/gi;
  for (const match of text.matchAll(re)) {
    const rawLabel = String(match[1] || "").trim();
    const totalChf = moneyToNumber(match[2]);
    if (totalChf == null || totalChf <= 0) continue;
    const around = text.slice(Math.max(0, (match.index ?? 0) - 40), (match.index ?? 0) + 160);
    const etaMatch = around.match(
      /(?:Recevez|Arriv|ETA|d['’]ici le|by)\s*([^\n.]{3,40})/i
    );
    out.push({
      label: classifyLaneLabel(rawLabel),
      rawLabel,
      totalChf,
      eta: etaMatch?.[1]?.trim() || null,
    });
  }
  // Dedupe identical label+price
  const seen = new Set<string>();
  return out.filter((lane) => {
    const key = `${lane.label}:${lane.totalChf.toFixed(2)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export type ChooseLaneResult =
  | { ok: true; lane: StockxLaneCard }
  | { ok: false; reason: Extract<StockxNeedsHumanReason, "oos" | "multi_price" | "wrong_lane_only" | "cap">; lane: null };

/**
 * Pick StockX ask lane. Never returns Express when desired=STANDARD.
 * If desired lane missing under cap → hard (wrong_lane_only / cap / oos).
 */
export function chooseLane(
  desired: StockxDesiredLane,
  lanes: StockxLaneCard[],
  maxAllInChf: number = MAX_ALL_IN_CHF
): ChooseLaneResult {
  if (!lanes.length) return { ok: false, reason: "oos", lane: null };

  const underCap = lanes.filter((l) => l.totalChf <= maxAllInChf);
  const desiredUnderCap = underCap.filter((l) => l.label === desired);

  if (desiredUnderCap.length === 0) {
    const desiredAny = lanes.filter((l) => l.label === desired);
    if (desiredAny.length > 0) return { ok: false, reason: "cap", lane: null };
    const otherUnderCap = underCap.filter(
      (l) => l.label === "STANDARD" || l.label === "EXPRESS"
    );
    if (otherUnderCap.length > 0) return { ok: false, reason: "wrong_lane_only", lane: null };
    return { ok: false, reason: "oos", lane: null };
  }

  const priceKeys = new Set(desiredUnderCap.map((l) => l.totalChf.toFixed(2)));
  if (priceKeys.size > 1) return { ok: false, reason: "multi_price", lane: null };

  const lane = [...desiredUnderCap].sort((a, b) => a.totalChf - b.totalChf)[0]!;
  // Safety: never escalate to Express unless requested
  if (desired === "STANDARD" && lane.label === "EXPRESS") {
    return { ok: false, reason: "wrong_lane_only", lane: null };
  }
  return { ok: true, lane };
}

export function marginOk(saleChf: number | null, totalChf: number | null): boolean {
  if (saleChf == null || totalChf == null) return false;
  return saleChf + 0.001 >= totalChf;
}
