/**
 * FantasyWelt (FAN) stock proof — page qty only, never default 5.
 *
 * Formulas (Theo 2026-09-19):
 * - normal: halfCeil(N) = ceil(N / 2), with N=1 → 1
 * - SALE:   max(0, ceil((N - 2) / 2))
 * - "10+": page never exposes exact qty — store sourceQty=10, publish 10−2=8
 *   (safety buffer only; NOT halfCeil/SALE on the capped 10)
 * - VORBESTELLBAR / 0 Stk / Cloudflare / unavailable → no positive proof (proposed 0)
 */

export type FanStockParse = {
  /** Exact page qty when known (10+ → 10). */
  sourceQty: number | null;
  /** Raw label from page, e.g. "3 Stk. auf Lager". */
  stockLabel: string | null;
  isTenPlus: boolean;
  isSale: boolean;
  isPreorder: boolean;
  isSofort: boolean;
  isCloudflare: boolean;
  /** Positive buyable proof with numeric qty. */
  hasPositiveProof: boolean;
  reason: string;
};

export type FanPublishDecision = {
  sourceQty: number | null;
  proposedQty: number;
  reason: string;
  hasPositiveProof: boolean;
  isSale: boolean;
  isTenPlus: boolean;
  stockLabel: string | null;
};

/** halfCeil: 0→0, 1→1, 2→1, 3→2, 10→5 */
export function fanHalfCeil(n: number): number {
  const qty = Math.max(0, Math.floor(Number(n) || 0));
  if (qty <= 0) return 0;
  return Math.ceil(qty / 2);
}

/** SALE: max(0, ceil((N - 2) / 2)) */
export function fanSalePublishQty(n: number): number {
  const qty = Math.max(0, Math.floor(Number(n) || 0));
  return Math.max(0, Math.ceil((qty - 2) / 2));
}

export function isFantasyweltSaleUrl(url: string | null | undefined): boolean {
  const u = String(url ?? "");
  return /\/SALE-/i.test(u) || /%SALE%/i.test(u) || /\bSALE\b/i.test(u);
}

export function parseFanStkAufLager(text: string | null | undefined): {
  qty: number | null;
  isTenPlus: boolean;
  label: string | null;
} {
  const plain = String(text ?? "").replace(/\s+/g, " ");
  const tenPlus = plain.match(/10\+\s*Stk\.\s*auf\s*Lager/i);
  if (tenPlus) {
    return { qty: 10, isTenPlus: true, label: tenPlus[0] };
  }
  const exact = plain.match(/(\d+)\s*Stk\.\s*auf\s*Lager/i);
  if (exact) {
    const n = Number(exact[1]);
    if (Number.isFinite(n) && n >= 0) {
      return { qty: n, isTenPlus: false, label: exact[0] };
    }
  }
  return { qty: null, isTenPlus: false, label: null };
}

export function parseFanStockFromPage(input: {
  htmlOrText: string;
  productUrl?: string | null;
  cloudflare?: boolean;
}): FanStockParse {
  if (input.cloudflare) {
    return {
      sourceQty: null,
      stockLabel: null,
      isTenPlus: false,
      isSale: isFantasyweltSaleUrl(input.productUrl),
      isPreorder: false,
      isSofort: false,
      isCloudflare: true,
      hasPositiveProof: false,
      reason: "cloudflare_no_proof",
    };
  }

  const plain = String(input.htmlOrText ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
  const isSale = isFantasyweltSaleUrl(input.productUrl) || /%SALE%/i.test(plain);
  const isPreorder =
    /VORBESTELLBAR/i.test(plain) ||
    /Vorbestell/i.test(plain) ||
    /Warten auf aktualisierten Erscheinungstermin/i.test(plain);
  const isSofort = /SOFORT\s+VERFÜGBAR/i.test(plain);
  const parsed = parseFanStkAufLager(plain);

  if (isPreorder) {
    return {
      sourceQty: parsed.qty,
      stockLabel: parsed.label,
      isTenPlus: parsed.isTenPlus,
      isSale,
      isPreorder: true,
      isSofort: false,
      isCloudflare: false,
      hasPositiveProof: false,
      reason: "preorder_vorbestellbar",
    };
  }

  if (parsed.qty === 0) {
    return {
      sourceQty: 0,
      stockLabel: parsed.label,
      isTenPlus: false,
      isSale,
      isPreorder: false,
      isSofort,
      isCloudflare: false,
      hasPositiveProof: false,
      reason: "zero_stk_auf_lager",
    };
  }

  if (parsed.qty == null) {
    return {
      sourceQty: null,
      stockLabel: null,
      isTenPlus: false,
      isSale,
      isPreorder: false,
      isSofort,
      isCloudflare: false,
      hasPositiveProof: false,
      reason: "no_stk_qty_on_page",
    };
  }

  if (!isSofort && !/auf\s+Lager/i.test(plain)) {
    return {
      sourceQty: parsed.qty,
      stockLabel: parsed.label,
      isTenPlus: parsed.isTenPlus,
      isSale,
      isPreorder: false,
      isSofort: false,
      isCloudflare: false,
      hasPositiveProof: false,
      reason: "not_sofort_verfuegbar",
    };
  }

  return {
    sourceQty: parsed.qty,
    stockLabel: parsed.label,
    isTenPlus: parsed.isTenPlus,
    isSale,
    isPreorder: false,
    isSofort: true,
    isCloudflare: false,
    hasPositiveProof: true,
    reason: parsed.isTenPlus ? "ten_plus_as_10" : "stk_auf_lager",
  };
}

export function decideFanPublishedQty(parse: FanStockParse): FanPublishDecision {
  if (!parse.hasPositiveProof || parse.sourceQty == null || parse.sourceQty <= 0) {
    return {
      sourceQty: parse.sourceQty,
      proposedQty: 0,
      reason: parse.reason,
      hasPositiveProof: false,
      isSale: parse.isSale,
      isTenPlus: parse.isTenPlus,
      stockLabel: parse.stockLabel,
    };
  }

  // 10+ is a cap label, not exact N — only −2 safety, never halfCeil/SALE on 10.
  if (parse.isTenPlus) {
    const proposed = Math.max(0, parse.sourceQty - 2);
    return {
      sourceQty: parse.sourceQty,
      proposedQty: proposed,
      reason: `ten_plus_minus_2:${parse.sourceQty}`,
      hasPositiveProof: proposed > 0,
      isSale: parse.isSale,
      isTenPlus: true,
      stockLabel: parse.stockLabel,
    };
  }

  const proposed = parse.isSale
    ? fanSalePublishQty(parse.sourceQty)
    : fanHalfCeil(parse.sourceQty);

  return {
    sourceQty: parse.sourceQty,
    proposedQty: proposed,
    reason: parse.isSale
      ? `sale_max0_ceil_n_minus_2_over_2:${parse.sourceQty}`
      : `halfCeil:${parse.sourceQty}`,
    hasPositiveProof: proposed > 0,
    isSale: parse.isSale,
    isTenPlus: parse.isTenPlus,
    stockLabel: parse.stockLabel,
  };
}

export function decideFanPublishedQtyFromPage(input: {
  htmlOrText: string;
  productUrl?: string | null;
  cloudflare?: boolean;
}): FanPublishDecision {
  return decideFanPublishedQty(parseFanStockFromPage(input));
}
