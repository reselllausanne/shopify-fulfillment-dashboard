/**
 * HAW (Hawk) publish qty proof.
 * - "Lagerbestand N" / "Stück an Lager N" → halfCeil(N)
 * - schema OutOfStock / discontinued / SoldOut → 0
 * - external stock label ("beim Lieferanten", "Zentrallager", "externes Lager", "Stockage externe") → 0
 * - missing qty → 0 (never default 5)
 */
import { halfCeil } from "./halfCeil";

export type HawPublishInput = {
  htmlOrText: string;
  inStockSchema?: boolean;
  availability?: string | null;
};

export type HawPublishDecision = {
  sourceQty: number | null;
  proposedQty: number;
  reason: string;
  hasPositiveProof: boolean;
  stockLabel: string | null;
};

function parseSchema(input: HawPublishInput): boolean {
  if (typeof input.inStockSchema === "boolean") return input.inStockSchema;
  const raw = String(input.availability ?? "").toLowerCase();
  if (!raw) return true; // no schema → don't block; qty parse still gates
  if (raw.includes("outofstock") || raw.includes("soldout") || raw.includes("discontinued")) {
    return false;
  }
  return raw.includes("instock");
}

function parseStkAnLager(text: string): { qty: number | null; label: string | null } {
  const plain = text.replace(/\s+/g, " ");
  const m =
    plain.match(/Lagerbestand\s*:?\s*(\d+)/i) ||
    plain.match(/Stück\s*an\s*Lager\s*:?\s*(\d+)/i);
  if (!m) return { qty: null, label: null };
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0) return { qty: null, label: null };
  return { qty: n, label: m[0] };
}

function isExternalStock(text: string): boolean {
  return /nicht\s+am\s+Lager|Zentrallager|externes?\s+Lager|beim\s+Lieferanten|Stockage\s+externe/i.test(
    text
  );
}

/** One-call decision — takes raw page text + optional schema flag. */
export function decideHawPublishedQty(input: HawPublishInput): HawPublishDecision {
  if (!parseSchema(input)) {
    return {
      sourceQty: 0,
      proposedQty: 0,
      reason: "schema_out_of_stock",
      hasPositiveProof: false,
      stockLabel: null,
    };
  }

  const plain = String(input.htmlOrText ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

  const parsed = parseStkAnLager(plain);

  if (isExternalStock(plain) && parsed.qty == null) {
    return {
      sourceQty: null,
      proposedQty: 0,
      reason: "external_stock_no_local_proof",
      hasPositiveProof: false,
      stockLabel: null,
    };
  }

  if (parsed.qty == null) {
    return {
      sourceQty: null,
      proposedQty: 0,
      reason: "no_lagerbestand_qty",
      hasPositiveProof: false,
      stockLabel: null,
    };
  }

  if (parsed.qty <= 0) {
    return {
      sourceQty: 0,
      proposedQty: 0,
      reason: "zero_qty",
      hasPositiveProof: false,
      stockLabel: parsed.label,
    };
  }

  const proposed = halfCeil(parsed.qty);
  return {
    sourceQty: parsed.qty,
    proposedQty: proposed,
    reason: `halfCeil:${parsed.qty}`,
    hasPositiveProof: proposed > 0,
    stockLabel: parsed.label,
  };
}

/** Alias for scraper wrappers that pass the raw page + availability URL. */
export const decideHawPublishedQtyFromPage = decideHawPublishedQty;
