/**
 * When Place Order confirmation spinner hangs (no order # on page), scrape
 * StockX /buying/orders text and pick the best matching fresh order number.
 * Pure — unit-tested without Playwright.
 *
 * StockX card layout (FR):
 *   title / color / Taille: EU …
 *   03-XXXXXXXX
 *   date
 *   N,NN CHF
 *   status
 * Title/size sit ABOVE the order #; date/CHF/status sit BELOW (≤3 trailer lines).
 * Next SKU title is ABOVE the next order # — never score it into this card.
 */

export type BuyingListRecoverHint = {
  sizeEU?: string | null;
  productName?: string | null;
  /** Prefer order #s that also appear near this all-in CHF (±tolerance). */
  totalChf?: number | null;
  totalToleranceChf?: number;
};

export type BuyingListRecoverHit = {
  orderNumber: string;
  /** Window text used for the match (debug). */
  window: string;
  score: number;
};

const ORDER_NUM_RE = /\b(0[1-3]-[A-Z0-9]{8,})\b/g;
/** Require decimals so "29/10/26 104,00 CHF" never becomes 26104. */
const MONEY_RE = /(\d{1,3}(?:[’']\d{3})*[.,]\d{2}|\d+[.,]\d{2})\s*CHF/gi;

/** Brand / gender / fluff — not distinctive enough to ID a SKU. */
const TITLE_NOISE = new Set([
  "nike",
  "adidas",
  "jordan",
  "air",
  "new",
  "balance",
  "hoka",
  "asics",
  "puma",
  "women",
  "womens",
  "mens",
  "men",
  "premium",
  "prm",
]);

const ABOVE_LINES = 8;
const BELOW_TRAILER_LINES = 3;
const MIN_SCORE = 50;

function normSize(sizeEU: string | null | undefined): string {
  return String(sizeEU ?? "")
    .replace(/^EU\s*/i, "")
    .replace(",", ".")
    .trim();
}

function titleBits(productName: string | null | undefined): string[] {
  return String(productName ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 3 && !TITLE_NOISE.has(w))
    .slice(0, 6);
}

function parseChfNear(window: string): number | null {
  MONEY_RE.lastIndex = 0;
  const m = MONEY_RE.exec(window);
  if (!m?.[1]) return null;
  const n = Number(String(m[1]).replace(/[’']/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function sizeMatches(text: string, sizeNeedle: string): boolean {
  const w = text.toLowerCase();
  return (
    w.includes(`eu ${sizeNeedle}`) ||
    w.includes(`taille: eu ${sizeNeedle}`) ||
    w.includes(`taille eu ${sizeNeedle}`)
  );
}

/**
 * Rank order numbers in a buying-list page dump.
 * Prefers size + distinctive title overlap on ABOVE; optional CHF on BELOW;
 * earlier list order (StockX shows newest first) as a tie-break.
 */
export function recoverStockxOrderNumberFromBuyingListText(
  body: string,
  hint: BuyingListRecoverHint
): BuyingListRecoverHit | null {
  const text = String(body || "");
  if (!text.trim()) return null;

  const sizeNeedle = normSize(hint.sizeEU);
  const bits = titleBits(hint.productName);
  const wantChf =
    hint.totalChf != null && Number.isFinite(hint.totalChf) ? Number(hint.totalChf) : null;
  const tol = hint.totalToleranceChf ?? 3;
  const minTitleHits = Math.min(2, bits.length);

  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const nums = [...text.matchAll(ORDER_NUM_RE)].map((m) => m[1]!);
  const uniq: string[] = [];
  for (const n of nums) {
    if (!uniq.includes(n)) uniq.push(n);
  }
  if (!uniq.length) return null;

  let best: BuyingListRecoverHit | null = null;

  for (let rank = 0; rank < uniq.length; rank += 1) {
    const orderNumber = uniq[rank]!;
    const i = lines.findIndex((l) => l.includes(orderNumber));
    if (i < 0) continue;

    const aboveLines = lines.slice(Math.max(0, i - ABOVE_LINES), i);
    const belowLines = lines.slice(i + 1, i + 1 + BELOW_TRAILER_LINES);
    const above = aboveLines.join(" ");
    const below = belowLines.join(" ");
    const window = [...aboveLines, lines[i]!, ...belowLines].join(" ");
    const aboveLc = above.toLowerCase();

    // Hard gates — size-only / brand-only must never steal another card.
    if (sizeNeedle && !sizeMatches(above, sizeNeedle)) continue;
    if (!sizeNeedle) continue;

    const titleHits = bits.filter((b) => aboveLc.includes(b)).length;
    if (titleHits < minTitleHits) continue;

    let chfDist: number | null = null;
    if (wantChf != null) {
      const near = parseChfNear(below);
      if (near == null || Math.abs(near - wantChf) > tol) continue;
      chfDist = Math.abs(near - wantChf);
    }

    let score = 0;
    // Newer orders appear first on StockX buying list.
    score += Math.max(0, 40 - rank);
    score += 50; // size gate passed
    score += titleHits * 18;

    if (chfDist != null) {
      score += 35; // CHF gate passed
      // Closer CHF beats newer-rank tie when two same-SKU cards both in tol.
      score += Math.max(0, 20 - Math.round(chfDist * 15));
    }

    if (score < MIN_SCORE) continue;

    if (!best || score > best.score) {
      best = { orderNumber, window: window.slice(0, 280), score };
    }
  }

  return best;
}
