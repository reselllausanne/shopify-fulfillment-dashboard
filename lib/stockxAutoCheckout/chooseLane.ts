import {
  MAX_ALL_IN_CHF,
  type StockxDesiredLane,
  type StockxLaneCard,
  type StockxLaneLabel,
  type StockxNeedsHumanReason,
} from "@/lib/stockxAutoCheckout/types";

/** Galaxus DD CSAT: Express if live margin vs sell > 5%. */
export const GALAXUS_CSAT_MIN_MARGIN = 0.05;

/**
 * Ignore bare ask scraps / 0,00 placeholders. Must stay BELOW real cheap all-in
 * sneakers (Stan Smith ~68 CHF) or date-tier parse returns [] → express_unparsed
 * / express_only fail-closed on an otherwise buyable checkout.
 * Item-only "Prix de l'article" (~40–50) stays under this; use XPRESS_ITEM_MIN_CHF
 * for the single-price Xpress synth path.
 */
export const LANE_MIN_ALL_IN_CHF = 50;
/**
 * Single-price Xpress "Prix de l'article" can be well under all-in (fees/ship added
 * to Sous-total). Live subtotal still gates Place Order — only seed the synth path.
 */
export const XPRESS_ITEM_MIN_CHF = 15;

/** Require decimals — bare `\d{1,3}` alone matches "86" from "86,74 CHF" and drops under min. */
const MONEY_RE = String.raw`(\d{1,3}(?:[’'\s]\d{3})*[.,]\d{2})`;
/** Money w/ optional decimals — single-price Xpress shows "119 CHF" (no decimals). */
const MONEY_OPT_DEC_RE = String.raw`(\d{1,3}(?:[’'\s]\d{3})*(?:[.,]\d{2})?)`;
const LANE_LABEL_RE = String.raw`(Standard|Express|Xpress|Fastest|Expedited)`;

/** Default StockX express→expedited upgrade thresholds (env-overridable). */
export const EXPEDITED_UPGRADE_MAX_PCT_DEFAULT = 0.05;
export const EXPEDITED_UPGRADE_MAX_DELTA_CHF_DEFAULT = 10;
/**
 * STANDARD → faster-lane (EXPRESS/EXPEDITED) upgrade. A customer who paid for standard
 * is strictly better off on a faster lane when it costs about the same, and when NO
 * standard lane exists we must still buy (take the faster lane) rather than refuse.
 * Upgrade-by-preference is bounded by pct/delta; "standard missing" always takes faster.
 */
export const STANDARD_UPGRADE_MAX_PCT_DEFAULT = 0.05;
/** Hard rule: Xpress expedited within +2 CHF of Standard MUST be taken (and up to +10). */
export const STANDARD_UPGRADE_MAX_DELTA_CHF_DEFAULT = 10;

function envNum(name: string, def: number): number {
  const v = process.env[name];
  if (v == null || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export function classifyLaneLabel(raw: string): StockxLaneLabel {
  const t = String(raw || "").toLowerCase();
  if (/\b(expedited|fastest)\b/.test(t)) return "EXPEDITED";
  if (/\b(express|xpress)\b/.test(t)) return "EXPRESS";
  if (/\bstandard\b/.test(t)) return "STANDARD";
  return "UNKNOWN";
}

/** Express family = normal express or the fastest/expedited tier. */
export function isExpressFamily(label: StockxLaneLabel): boolean {
  return label === "EXPRESS" || label === "EXPEDITED";
}

/**
 * Single-price Xpress direct-ship pages show only an item price
 * ("Prix de l'article 119 CHF" / "Item price") and no Standard/Express cards.
 * Parse that item price so a single EXPRESS lane can be synthesized.
 */
export function parseSingleXpressItemPriceChf(
  body: string | null | undefined
): number | null {
  const t = String(body || "");
  // FR sometimes inserts "de" between label and amount ("Prix de l'article\nde\n43 CHF").
  const patterns = [
    new RegExp(
      String.raw`Prix de l['’]article\s*(?:de\s*)?(?:CHF\s*)?${MONEY_OPT_DEC_RE}(?:\s*CHF)?`,
      "i"
    ),
    new RegExp(
      String.raw`Item price\s*(?:from\s*)?(?:CHF\s*)?${MONEY_OPT_DEC_RE}(?:\s*CHF)?`,
      "i"
    ),
  ];
  for (const re of patterns) {
    const m = t.match(re);
    const n = moneyToNumber(m?.[1] ?? null);
    if (n != null && n >= XPRESS_ITEM_MIN_CHF) return n;
  }
  return null;
}

export function moneyToNumber(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d,.-]/g, "").replace(/\s/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function laneMarginPct(sellChf: number, allInChf: number): number {
  if (!(sellChf > 0) || !(allInChf > 0)) return Number.NEGATIVE_INFINITY;
  return (sellChf - allInChf) / sellChf;
}

export function extractCheckoutSubtotalChf(text: string): number | null {
  const patterns = [
    new RegExp(String.raw`Subtotal\s+CHF\s*${MONEY_RE}`, "i"),
    new RegExp(String.raw`Subtotal\s*${MONEY_RE}\s*CHF`, "i"),
    new RegExp(String.raw`Sous[- ]?total\s+CHF\s*${MONEY_RE}`, "i"),
    new RegExp(String.raw`Sous[- ]?total\s*${MONEY_RE}\s*CHF`, "i"),
    new RegExp(String.raw`Total(?:\s*Price)?\s+CHF\s*${MONEY_RE}`, "i"),
    new RegExp(String.raw`Total(?:\s*Price)?\s*${MONEY_RE}\s*CHF`, "i"),
    new RegExp(String.raw`Total\s*à\s*payer\s*${MONEY_RE}\s*CHF`, "i"),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    const n = moneyToNumber(m?.[1] ?? null);
    // Ignore 0,00 placeholder before lane select.
    if (n != null && n >= LANE_MIN_ALL_IN_CHF) return n;
  }
  return null;
}

export function laneMatchesSubtotal(
  lane: StockxLaneCard,
  subtotalChf: number | null,
  tolChf = 0.51
): boolean {
  if (subtotalChf == null) return false;
  return Math.abs(subtotalChf - lane.totalChf) <= tolChf;
}

function pushLane(
  out: StockxLaneCard[],
  seen: Set<string>,
  rawLabel: string,
  totalChf: number,
  eta: string | null = null
): void {
  const label = classifyLaneLabel(rawLabel);
  if (label === "UNKNOWN") return;
  if (!(totalChf >= LANE_MIN_ALL_IN_CHF)) return;
  const key = `${label}:${totalChf.toFixed(2)}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ label, rawLabel, totalChf, eta });
}

/**
 * Date-only shipping rows without Standard/Express words.
 * en-GB: "3 Nov – 12 Nov\nCHF 122.13"
 * fr-CH: "2 nov. – 11 nov.\n127,50 CHF"  ← was false-OOS killer
 */
function parseDateTierLanes(text: string): StockxLaneCard[] {
  const dateRows: Array<{ eta: string; totalChf: number }> = [];
  const monthTok = String.raw`[A-Za-zÀ-ÿ]{3,12}\.?`;
  const dateSpan = String.raw`((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)?\s*\d{1,2}\s+${monthTok}(?:\s*[–—-]\s*\d{1,2}\s+${monthTok})?)`;
  const patterns = [
    new RegExp(String.raw`${dateSpan}\s*\n?\s*CHF\s*${MONEY_RE}`, "gi"),
    new RegExp(String.raw`${dateSpan}\s*\n?\s*${MONEY_RE}\s*CHF`, "gi"),
    // Same card, up to ~60 chars of noise between date span and price
    new RegExp(String.raw`${dateSpan}[\s\S]{0,60}?CHF\s*${MONEY_RE}`, "gi"),
    new RegExp(String.raw`${dateSpan}[\s\S]{0,60}?${MONEY_RE}\s*CHF`, "gi"),
  ];
  for (const dateRe of patterns) {
    for (const m of text.matchAll(dateRe)) {
      const totalChf = moneyToNumber(m[2]);
      if (totalChf == null || totalChf < LANE_MIN_ALL_IN_CHF) continue;
      dateRows.push({ eta: String(m[1] || "").replace(/\s+/g, " ").trim(), totalChf });
    }
  }
  // Dedup by price (keep first eta)
  const byPrice = new Map<string, { eta: string; totalChf: number }>();
  for (const row of dateRows) {
    const k = row.totalChf.toFixed(2);
    if (!byPrice.has(k)) byPrice.set(k, row);
  }
  const tiers = [...byPrice.values()].sort((a, b) => a.totalChf - b.totalChf);
  const out: StockxLaneCard[] = [];
  const seen = new Set<string>();
  if (tiers.length >= 1) {
    pushLane(out, seen, "Standard", tiers[0]!.totalChf, tiers[0]!.eta);
  }
  if (tiers.length >= 2) {
    // Mid tier ≈ Express/Xpress; last alone if only 2
    const exp = tiers.length >= 3 ? tiers[1]! : tiers[tiers.length - 1]!;
    pushLane(out, seen, "Express", exp.totalChf, exp.eta);
  }
  if (tiers.length >= 3) {
    const last = tiers[tiers.length - 1]!;
    pushLane(out, seen, "Fastest", last.totalChf, last.eta);
  }
  return out;
}

/**
 * Parse Standard / Express / Xpress / Fastest cards + CHF from checkout body.
 * Supports FR "122,13 CHF", en-GB "CHF 122.13", stacked cards, date-only tiers.
 */
export function parseLaneCardsFromText(text: string): StockxLaneCard[] {
  const out: StockxLaneCard[] = [];
  const seen = new Set<string>();

  // Label then amount (CHF suffix or prefix)
  const namedRe = new RegExp(
    String.raw`\b${LANE_LABEL_RE}\b[\s\S]{0,200}?(?:CHF\s*)?${MONEY_RE}(?:\s*CHF)?`,
    "gi"
  );
  for (const match of text.matchAll(namedRe)) {
    const rawLabel = String(match[1] || "").trim();
    const totalChf = moneyToNumber(match[2]);
    if (totalChf == null || totalChf <= 0) continue;
    const between = String(match[0] || "").slice(rawLabel.length);
    if (new RegExp(String.raw`\b${LANE_LABEL_RE}\b`, "i").test(between)) continue;
    const around = text.slice(Math.max(0, (match.index ?? 0) - 40), (match.index ?? 0) + 200);
    const etaMatch = around.match(
      /(?:Recevez|Arriv|ETA|d['’]ici le|by)\s*([^\n.]{3,40})/i
    );
    pushLane(out, seen, rawLabel, totalChf, etaMatch?.[1]?.trim() || null);
  }

  // Date-only shipping rows (en-GB) — merge without clobbering named labels
  for (const lane of parseDateTierLanes(text)) {
    pushLane(out, seen, lane.rawLabel, lane.totalChf, lane.eta ?? null);
  }

  return out;
}

/** Distinct all-in shipping prices in body (for fail-closed when Express unlabeled). */
export function countDistinctShippingTierInText(
  text: string,
  maxAllInChf: number = MAX_ALL_IN_CHF
): number {
  const prices = new Set<string>();
  const dateRe = new RegExp(String.raw`CHF\s*${MONEY_RE}`, "gi");
  for (const m of text.matchAll(dateRe)) {
    const n = moneyToNumber(m[1]);
    if (n != null && n >= LANE_MIN_ALL_IN_CHF && n <= maxAllInChf) {
      prices.add(n.toFixed(2));
    }
  }
  const suffixRe = new RegExp(String.raw`${MONEY_RE}\s*CHF`, "gi");
  for (const m of text.matchAll(suffixRe)) {
    const n = moneyToNumber(m[1]);
    if (n != null && n >= LANE_MIN_ALL_IN_CHF && n <= maxAllInChf) {
      prices.add(n.toFixed(2));
    }
  }
  return prices.size;
}

/** Product/size chrome without CHF or ask CTA — SPA/CF hydrate incomplete (retryable). */
export function isCheckoutShellWithoutLanes(body: string | null | undefined): boolean {
  const t = String(body || "");
  if (!t.trim()) return true;
  const noAskRe = /aucune demande|no asks?|make an offer|faire une offre/i;
  const hasPriceRe = new RegExp(
    String.raw`(?:CHF\s*${MONEY_RE})|(?:${MONEY_RE}\s*CHF)`,
    "i"
  );
  const hasLaneUi =
    /\b(standard|express|xpress|fastest|expedited|sous[- ]?total|subtotal)\b/i.test(t) ||
    hasPriceRe.test(t);
  if (hasLaneUi || noAskRe.test(t)) return false;
  // Size-selected buy shell / marketing chrome (Stan Smith #7566 skeleton ~200 chars).
  const hasShell =
    /taille\s*:|size\s*:|nouveautés?\s*vérifiées|verified\s*new|\bretour\b|passer au contenu/i.test(
      t
    );
  return hasShell || t.replace(/\s+/g, "").length < 400;
}

/**
 * When lanes parse EMPTY, read raw checkout/PDP body to tell TRUE out-of-stock
 * from a parser miss (buyable, Express-only) or soft hydrate fail. Distinguishes:
 *  - `oos_no_ask`  : body says "aucune demande" / "no asks" / "make an offer" and
 *                    shows NO CHF price → genuinely nobody selling this size.
 *                    Only this one is safe to tell a customer "unavailable".
 *  - `express_only`: a single buyable signal is present (e.g. "il n'en reste que 1",
 *                    "Prix de l'article", Xpress/Express) but STANDARD was not parsed
 *                    → buyable, NOT out of stock (parser miss).
 *  - `proxy_blank` : product/size chrome or truncated shell, no CHF/lanes/ask CTA
 *                    → incomplete hydrate / CF — retry, NOT hard OOS.
 *  - `oos`         : unknown / unparseable (keep the conservative default).
 */
export function classifyEmptyLaneReason(
  body: string | null | undefined
): "oos_no_ask" | "express_only" | "proxy_blank" | "oos" {
  const t = String(body || "");
  const noAskRe = /aucune demande|no asks?|make an offer|faire une offre/i;
  const buyableRe =
    /il n['’]en reste que\s*\d|prix de l['’]article|\b(xpress|express)\b/i;
  // Any CHF money token on the page (prefix or suffix form).
  const hasPriceRe = new RegExp(
    String.raw`(?:CHF\s*${MONEY_RE})|(?:${MONEY_RE}\s*CHF)`,
    "i"
  );
  const hasPrice = hasPriceRe.test(t);

  if (noAskRe.test(t) && !hasPrice) return "oos_no_ask";
  if (buyableRe.test(t) || hasPrice) return "express_only";
  if (isCheckoutShellWithoutLanes(t)) return "proxy_blank";
  return "oos";
}

export type ChooseLaneResult =
  | { ok: true; lane: StockxLaneCard }
  | {
      ok: false;
      reason: Extract<
        StockxNeedsHumanReason,
        "oos" | "multi_price" | "wrong_lane_only" | "cap" | "express_unparsed"
      >;
      lane: null;
    };

/**
 * Pick StockX ask lane. Never returns Express when desired=STANDARD.
 * If desired lane missing under cap → hard (wrong_lane_only / cap / oos).
 */
export function chooseLane(
  desired: StockxDesiredLane,
  lanes: StockxLaneCard[],
  maxAllInChf: number = MAX_ALL_IN_CHF,
  opts?: {
    /** Expedited accepted if <= normal*(1+pct). Default env STOCKX_EXPEDITED_UPGRADE_MAX_PCT. */
    expeditedUpgradeMaxPct?: number;
    /** …or if (expedited-normal) <= delta CHF. Default env STOCKX_EXPEDITED_UPGRADE_MAX_DELTA_CHF. */
    expeditedUpgradeMaxDeltaChf?: number;
    /** STANDARD→faster accepted if faster <= standard*(1+pct). Default env STOCKX_STANDARD_UPGRADE_MAX_PCT. */
    standardUpgradeMaxPct?: number;
    /** …or if (faster-standard) <= delta CHF. Default env STOCKX_STANDARD_UPGRADE_MAX_DELTA_CHF. */
    standardUpgradeMaxDeltaChf?: number;
  }
): ChooseLaneResult {
  if (!lanes.length) return { ok: false, reason: "oos", lane: null };

  const underCap = lanes.filter((l) => l.totalChf <= maxAllInChf);

  if (desired === "EXPRESS") {
    const pct =
      opts?.expeditedUpgradeMaxPct ??
      envNum("STOCKX_EXPEDITED_UPGRADE_MAX_PCT", EXPEDITED_UPGRADE_MAX_PCT_DEFAULT);
    const delta =
      opts?.expeditedUpgradeMaxDeltaChf ??
      envNum("STOCKX_EXPEDITED_UPGRADE_MAX_DELTA_CHF", EXPEDITED_UPGRADE_MAX_DELTA_CHF_DEFAULT);

    const normals = underCap
      .filter((l) => l.label === "EXPRESS")
      .sort((a, b) => a.totalChf - b.totalChf);
    const expedited = underCap
      .filter((l) => l.label === "EXPEDITED")
      .sort((a, b) => a.totalChf - b.totalChf);

    if (!normals.length && !expedited.length) {
      const anyExpress = lanes.filter((l) => isExpressFamily(l.label));
      if (anyExpress.length > 0) return { ok: false, reason: "cap", lane: null };
      const otherUnderCap = underCap.filter((l) => l.label === "STANDARD");
      if (otherUnderCap.length > 0) return { ok: false, reason: "wrong_lane_only", lane: null };
      return { ok: false, reason: "oos", lane: null };
    }

    // Ambiguous only when 2+ DISTINCT normal-express prices (not express vs expedited).
    const normalPrices = new Set(normals.map((l) => l.totalChf.toFixed(2)));
    if (normalPrices.size > 1) return { ok: false, reason: "multi_price", lane: null };

    const chosenNormal = normals[0] ?? null;
    const cheapestExpedited = expedited[0] ?? null;

    if (chosenNormal && cheapestExpedited) {
      const upgrade =
        cheapestExpedited.totalChf <= chosenNormal.totalChf * (1 + pct) ||
        cheapestExpedited.totalChf - chosenNormal.totalChf <= delta;
      return { ok: true, lane: upgrade ? cheapestExpedited : chosenNormal };
    }
    if (chosenNormal) return { ok: true, lane: chosenNormal };
    // Only expedited present → use it.
    return { ok: true, lane: cheapestExpedited! };
  }

  // desired === "STANDARD" — a faster lane is strictly better service for the customer,
  // so UPGRADE to EXPRESS/EXPEDITED when it is ~same price, and when NO standard lane
  // exists take the faster lane rather than refusing (never go slower than standard).
  // Still bounded by the all-in cap here + the margin gate downstream.
  const stdPct =
    opts?.standardUpgradeMaxPct ??
    envNum("STOCKX_STANDARD_UPGRADE_MAX_PCT", STANDARD_UPGRADE_MAX_PCT_DEFAULT);
  const stdDelta =
    opts?.standardUpgradeMaxDeltaChf ??
    envNum("STOCKX_STANDARD_UPGRADE_MAX_DELTA_CHF", STANDARD_UPGRADE_MAX_DELTA_CHF_DEFAULT);

  const standards = underCap
    .filter((l) => l.label === "STANDARD")
    .sort((a, b) => a.totalChf - b.totalChf);
  const fasterUnderCap = underCap
    .filter((l) => isExpressFamily(l.label))
    .sort((a, b) => a.totalChf - b.totalChf);

  if (standards.length === 0) {
    // No standard lane: take the cheapest faster lane under cap (don't refuse the buy).
    if (fasterUnderCap.length > 0) return { ok: true, lane: fasterUnderCap[0]! };
    const standardAny = lanes.filter((l) => l.label === "STANDARD");
    if (standardAny.length > 0) return { ok: false, reason: "cap", lane: null };
    // Nothing standard anywhere, nothing faster under cap → over-cap express or OOS.
    if (lanes.some((l) => isExpressFamily(l.label))) return { ok: false, reason: "cap", lane: null };
    return { ok: false, reason: "oos", lane: null };
  }

  const priceKeys = new Set(standards.map((l) => l.totalChf.toFixed(2)));
  if (priceKeys.size > 1) return { ok: false, reason: "multi_price", lane: null };

  const chosenStd = standards[0]!;
  // Upgrade to a faster lane if it costs about the same (few CHF / small %).
  const cheapestFaster = fasterUnderCap[0] ?? null;
  if (cheapestFaster) {
    const upgrade =
      cheapestFaster.totalChf <= chosenStd.totalChf * (1 + stdPct) ||
      cheapestFaster.totalChf - chosenStd.totalChf <= stdDelta;
    if (upgrade) return { ok: true, lane: cheapestFaster };
  }
  return { ok: true, lane: chosenStd };
}

export type ChooseGalaxusLaneResult =
  | { ok: true; lane: StockxLaneCard; reason: string }
  | {
      ok: false;
      reason: "no_lane_under_cap" | "margin_abort" | "express_unparsed";
      detail: string;
    };

/**
 * Galaxus DD / CSAT lane pick (LIVE prices only):
 * - Express if margin > 5% vs sell
 * - Standard only if Express missing or Express margin dead
 * - Fail closed when ≥2 shipping tiers visible but Express not parsed
 */
export function chooseLaneByCsAtMargin(
  sellChf: number,
  lanes: StockxLaneCard[],
  options?: {
    maxAllInChf?: number;
    minMargin?: number;
    /** Distinct CHF tiers seen in raw checkout text (optional fail-closed signal). */
    shippingTierInText?: number;
  }
): ChooseGalaxusLaneResult {
  const maxAllInChf = options?.maxAllInChf ?? MAX_ALL_IN_CHF;
  const minMargin = options?.minMargin ?? GALAXUS_CSAT_MIN_MARGIN;

  const under = lanes
    .filter(
      (l) =>
        l.totalChf >= LANE_MIN_ALL_IN_CHF &&
        l.totalChf <= maxAllInChf &&
        (isExpressFamily(l.label) || l.label === "STANDARD")
    )
    .sort((a, b) => a.totalChf - b.totalChf);

  if (!under.length) {
    return { ok: false, reason: "no_lane_under_cap", detail: `sell=${sellChf}` };
  }

  // Expedited counts as express-equivalent (cheapest express-family lane).
  const exp = under.filter((l) => isExpressFamily(l.label))[0];
  const std = under.filter((l) => l.label === "STANDARD")[0];
  const tiers =
    options?.shippingTierInText ??
    new Set(under.map((l) => l.totalChf.toFixed(2))).size;

  // Fail closed: multi-tier UI but Express never labeled/parsed
  if (!exp && tiers >= 2) {
    return {
      ok: false,
      reason: "express_unparsed",
      detail: `tiers=${tiers} std=${std?.totalChf ?? "n/a"} sell=${sellChf}`,
    };
  }

  if (exp) {
    const expMargin = laneMarginPct(sellChf, exp.totalChf);
    if (expMargin > minMargin) {
      return {
        ok: true,
        lane: exp,
        reason: `EXP margin ${(expMargin * 100).toFixed(1)}%>${(minMargin * 100).toFixed(0)}%`,
      };
    }
  }

  if (std) {
    const stdMargin = laneMarginPct(sellChf, std.totalChf);
    if (stdMargin > minMargin) {
      return {
        ok: true,
        lane: std,
        reason: `STD margin ${(stdMargin * 100).toFixed(1)}%>${(minMargin * 100).toFixed(0)}% (EXP ${
          exp ? `${(laneMarginPct(sellChf, exp.totalChf) * 100).toFixed(1)}%` : "missing"
        })`,
      };
    }
  }

  return {
    ok: false,
    reason: "margin_abort",
    detail: `exp=${exp?.totalChf ?? "n/a"} std=${std?.totalChf ?? "n/a"} sell=${sellChf}`,
  };
}

/** Shopify auto path: sale ≥ total (not Galaxus 5% CSAT). */
export function marginOk(saleChf: number | null, totalChf: number | null): boolean {
  if (saleChf == null || totalChf == null) return false;
  return saleChf + 0.001 >= totalChf;
}
