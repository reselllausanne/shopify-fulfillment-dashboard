/**
 * When Place Order confirmation spinner hangs (no order # on page), scrape
 * StockX /buying/orders text and pick the best matching fresh order number.
 * Pure — unit-tested without Playwright.
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
const MONEY_RE = /(\d{1,3}(?:[’'\s]\d{3})*(?:[.,]\d{2})?)\s*CHF/gi;

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
    .filter((w) => w.length > 3)
    .slice(0, 4);
}

function parseChfNear(window: string): number | null {
  MONEY_RE.lastIndex = 0;
  const m = MONEY_RE.exec(window);
  if (!m?.[1]) return null;
  const n = Number(String(m[1]).replace(/[’'\s]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Rank order numbers in a buying-list page dump.
 * Prefers size + title overlap; optional CHF proximity; earlier list order
 * (StockX shows newest first) as a tie-break via descending index bonus.
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
    const window = lines.slice(Math.max(0, i - 8), i + 4).join(" ");
    const w = window.toLowerCase();

    let score = 0;
    // Newer orders appear first on StockX buying list.
    score += Math.max(0, 40 - rank);

    if (sizeNeedle) {
      if (w.includes(`eu ${sizeNeedle}`) || w.includes(`taille: eu ${sizeNeedle}`)) {
        score += 50;
      } else if (w.includes(sizeNeedle)) {
        score += 25;
      } else {
        score -= 20;
      }
    }

    const titleHits = bits.filter((b) => w.includes(b)).length;
    score += titleHits * 18;
    if (bits.length && titleHits === 0) score -= 15;

    if (wantChf != null) {
      const near = parseChfNear(window);
      if (near != null && Math.abs(near - wantChf) <= tol) score += 35;
      else if (near != null) score -= 5;
    }

    if (!best || score > best.score) {
      best = { orderNumber, window: window.slice(0, 280), score };
    }
  }

  // Require a minimum signal — size or title — so we don't grab a random top row.
  if (!best) return null;
  if (sizeNeedle || bits.length) {
    const w = best.window.toLowerCase();
    const sizeOk =
      !sizeNeedle ||
      w.includes(`eu ${sizeNeedle}`) ||
      w.includes(sizeNeedle);
    const titleOk = !bits.length || bits.some((b) => w.includes(b));
    if (!sizeOk || !titleOk) return null;
  }
  return best;
}
