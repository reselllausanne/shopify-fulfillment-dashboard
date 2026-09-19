/**
 * HAW (Hawk) publish qty proof.
 * - "Lagerbestand N" / "Stück an Lager N" → halfCeil(N)
 * - OutOfStock / discontinued / SoldOut → 0
 * - external stock label / no local proof → 0 (never default 5)
 */
import { halfCeil } from "./halfCeil";

export type HawStockParse = {
  sourceQty: number | null;
  stockLabel: string | null;
  availability: "in_stock" | "out_of_stock" | "external" | "unknown";
  hasPositiveProof: boolean;
  reason: string;
};

export type HawPublishDecision = {
  sourceQty: number | null;
  proposedQty: number;
  reason: string;
  hasPositiveProof: boolean;
  stockLabel: string | null;
};

export function parseHawStkAnLager(text: string | null | undefined): {
  qty: number | null;
  label: string | null;
} {
  const plain = String(text ?? "").replace(/\s+/g, " ");
  const m =
    plain.match(/Lagerbestand\s*:?\s*(\d+)/i) ||
    plain.match(/Stück\s*an\s*Lager\s*:?\s*(\d+)/i);
  if (!m) return { qty: null, label: null };
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0) return { qty: null, label: null };
  return { qty: n, label: m[0] };
}

export function parseHawStockFromPage(input: {
  htmlOrText: string;
  availability?: string | null; // schema.org availability
}): HawStockParse {
  const avail = String(input.availability ?? "").toLowerCase();
  if (
    avail.includes("outofstock") ||
    avail.includes("soldout") ||
    avail.includes("discontinued")
  ) {
    return {
      sourceQty: 0,
      stockLabel: null,
      availability: "out_of_stock",
      hasPositiveProof: false,
      reason: "schema_out_of_stock",
    };
  }

  const plain = String(input.htmlOrText ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
  const external = /nicht\s+am\s+Lager|Zentrallager|externes?\s+Lager|beim\s+Lieferanten/i.test(plain);
  const parsed = parseHawStkAnLager(plain);

  if (external && parsed.qty == null) {
    return {
      sourceQty: null,
      stockLabel: null,
      availability: "external",
      hasPositiveProof: false,
      reason: "external_stock_no_local_proof",
    };
  }

  if (parsed.qty == null) {
    return {
      sourceQty: null,
      stockLabel: null,
      availability: avail.includes("instock") ? "unknown" : "unknown",
      hasPositiveProof: false,
      reason: "no_qty_on_page",
    };
  }

  if (parsed.qty <= 0) {
    return {
      sourceQty: 0,
      stockLabel: parsed.label,
      availability: "out_of_stock",
      hasPositiveProof: false,
      reason: "zero_qty",
    };
  }

  const instock = avail.includes("instock") || !avail;
  return {
    sourceQty: parsed.qty,
    stockLabel: parsed.label,
    availability: instock ? "in_stock" : "unknown",
    hasPositiveProof: instock,
    reason: instock ? "lagerbestand_n" : "qty_without_instock_signal",
  };
}

export function decideHawPublishedQty(parse: HawStockParse): HawPublishDecision {
  if (!parse.hasPositiveProof || parse.sourceQty == null || parse.sourceQty <= 0) {
    return {
      sourceQty: parse.sourceQty,
      proposedQty: 0,
      reason: parse.reason,
      hasPositiveProof: false,
      stockLabel: parse.stockLabel,
    };
  }
  const proposed = halfCeil(parse.sourceQty);
  return {
    sourceQty: parse.sourceQty,
    proposedQty: proposed,
    reason: `halfCeil:${parse.sourceQty}`,
    hasPositiveProof: proposed > 0,
    stockLabel: parse.stockLabel,
  };
}

export function decideHawPublishedQtyFromPage(input: {
  htmlOrText: string;
  availability?: string | null;
}): HawPublishDecision {
  return decideHawPublishedQty(parseHawStockFromPage(input));
}
