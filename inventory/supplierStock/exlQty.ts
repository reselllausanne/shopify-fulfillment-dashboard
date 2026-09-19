/**
 * EXL (Ex Libris) publish qty proof.
 * EXL listings expose no exact stock number — proof is delivery text.
 * - "2-3 Werktage" / "2-4 Werktage" / "sofort lieferbar" → proposed 1 (quantityUnknown)
 * - "Derzeit vergriffen" / "nicht lieferbar" / preorder → 0
 * - Empty scrape / no page proof → 0 (never default 5)
 */

export type ExlAvailability =
  | "in_stock_short_lead"
  | "in_stock_immediate"
  | "preorder"
  | "unavailable"
  | "unknown";

export type ExlStockParse = {
  availability: ExlAvailability;
  deliveryLabel: string | null;
  hasPositiveProof: boolean;
  reason: string;
};

export type ExlPublishDecision = {
  proposedQty: number;
  quantityUnknown: boolean;
  reason: string;
  hasPositiveProof: boolean;
  availability: ExlAvailability;
};

export function parseExlAvailability(input: {
  stockLabel?: string | null; // "in_stock", "out_of_stock", "preorder", "in_stock_unquantified"
  availabilityText?: string | null;
}): ExlStockParse {
  const text = String(input.availabilityText ?? "").toLowerCase();
  const label = String(input.stockLabel ?? "").toLowerCase();

  if (
    label === "out_of_stock" ||
    /vergriffen|nicht\s+lieferbar|ausverkauft|nicht\s+verfügbar/.test(text)
  ) {
    return {
      availability: "unavailable",
      deliveryLabel: input.availabilityText ?? null,
      hasPositiveProof: false,
      reason: "unavailable",
    };
  }
  if (label === "preorder" || /vorbestell|pre-?order/.test(text)) {
    return {
      availability: "preorder",
      deliveryLabel: input.availabilityText ?? null,
      hasPositiveProof: false,
      reason: "preorder",
    };
  }

  const shortLead = /2[-–]\s*[34]\s*Werktage/i.test(text) || /1[-–]\s*3\s*Werktage/i.test(text);
  const immediate = /sofort\s+lieferbar/i.test(text);

  if (shortLead) {
    return {
      availability: "in_stock_short_lead",
      deliveryLabel: input.availabilityText ?? null,
      hasPositiveProof: true,
      reason: "delivery_2_3_werktage",
    };
  }
  if (immediate) {
    return {
      availability: "in_stock_immediate",
      deliveryLabel: input.availabilityText ?? null,
      hasPositiveProof: true,
      reason: "sofort_lieferbar",
    };
  }
  if (label === "in_stock" || label === "in_stock_unquantified") {
    // Green tile without exact delivery text — treat as short-lead proof.
    return {
      availability: "in_stock_short_lead",
      deliveryLabel: input.availabilityText ?? null,
      hasPositiveProof: true,
      reason: "green_in_stock_unquantified",
    };
  }

  return {
    availability: "unknown",
    deliveryLabel: input.availabilityText ?? null,
    hasPositiveProof: false,
    reason: "no_page_proof",
  };
}

export function decideExlPublishedQty(parse: ExlStockParse): ExlPublishDecision {
  if (!parse.hasPositiveProof) {
    return {
      proposedQty: 0,
      quantityUnknown: false,
      reason: parse.reason,
      hasPositiveProof: false,
      availability: parse.availability,
    };
  }
  return {
    proposedQty: 1,
    quantityUnknown: true,
    reason: parse.reason,
    hasPositiveProof: true,
    availability: parse.availability,
  };
}
