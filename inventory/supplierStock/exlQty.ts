/**
 * EXL (Ex Libris) publish qty proof.
 * EXL listings expose no exact stock number — proof is delivery text.
 * - "2-3 Werktage" / "2-4 Werktage" / "sofort lieferbar" / green in_stock label → 1 quantityUnknown
 * - "Derzeit vergriffen" / preorder / unavailable → 0
 * - scrapeValid=false / no page proof → 0 (never default 5)
 */

export type ExlPublishInput = {
  stockLabel?: string | null;
  availabilityText?: string | null;
  /** Scrape emitted 0 tiles / empty catalog — not a valid stock signal. */
  scrapeValid?: boolean;
};

export type ExlPublishDecision = {
  sourceQty: number | null;
  proposedQty: number;
  reason: string;
  hasPositiveProof: boolean;
  quantityUnknown: boolean;
};

function textReason(input: ExlPublishInput): {
  proof: boolean;
  reason: string;
} {
  const text = String(input.availabilityText ?? "").toLowerCase();
  const label = String(input.stockLabel ?? "").toLowerCase();
  if (
    label === "out_of_stock" ||
    /vergriffen|nicht\s+lieferbar|ausverkauft|nicht\s+verfügbar/.test(text)
  ) {
    return { proof: false, reason: "unavailable" };
  }
  if (label === "preorder" || /vorbestell|pre-?order/.test(text)) {
    return { proof: false, reason: "preorder" };
  }
  if (/2[-–]\s*[34]\s*Werktage|1[-–]\s*3\s*Werktage/i.test(text)) {
    return { proof: true, reason: "delivery_2_3_werktage" };
  }
  if (/sofort\s+lieferbar/i.test(text)) {
    return { proof: true, reason: "sofort_lieferbar" };
  }
  if (label === "in_stock" || label === "in_stock_unquantified") {
    return { proof: true, reason: "green_in_stock_unquantified" };
  }
  return { proof: false, reason: "no_page_proof" };
}

/** Normalize tile fields into decideExlPublishedQty input. */
export function parseExlAvailability(input: {
  stockLabel?: string | null;
  availabilityText?: string | null;
  scrapeValid?: boolean;
}): ExlPublishInput {
  return {
    stockLabel: input.stockLabel,
    availabilityText: input.availabilityText,
    scrapeValid: input.scrapeValid,
  };
}

export function decideExlPublishedQty(input: ExlPublishInput): ExlPublishDecision {
  if (input.scrapeValid === false) {
    return {
      sourceQty: null,
      proposedQty: 0,
      reason: "scrape_invalid_no_proof",
      hasPositiveProof: false,
      quantityUnknown: false,
    };
  }
  const t = textReason(input);
  if (!t.proof) {
    return {
      sourceQty: null,
      proposedQty: 0,
      reason: t.reason,
      hasPositiveProof: false,
      quantityUnknown: false,
    };
  }
  return {
    sourceQty: null,
    proposedQty: 1,
    reason: t.reason,
    hasPositiveProof: true,
    quantityUnknown: true,
  };
}
