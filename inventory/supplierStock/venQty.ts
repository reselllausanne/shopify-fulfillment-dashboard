/**
 * VEN (Venova / Shopware 5) publish qty proof.
 * - buyableSofort + pageObservedThisRun + trusted stockSource → 1 quantityUnknown
 * - stockSource "sQuantity_max" is NOT trusted (Shopware caps inflate qty)
 * - !buyableSofort / no page obs / unknown → 0 (never invent 100 or mass-write 1)
 */

export type VenStockSource =
  | "stock_quantity_number"
  | "sQuantity_max"
  | "default_stock"
  | "schema_not_instock"
  | "not_sofort_verfuegbar"
  | "sofort_but_no_exact_qty"
  | string;

export type VenPublishInput = {
  buyableSofort?: boolean;
  pageObservedThisRun?: boolean;
  stockSource?: VenStockSource | null;
  rawQty?: number | null;
};

export type VenPublishDecision = {
  sourceQty: number | null;
  proposedQty: number;
  reason: string;
  hasPositiveProof: boolean;
};

const TRUSTED_SOURCES = new Set(["stock_quantity_number", "nur_noch_n_stueck"]);

export function decideVenPublishedQty(input: VenPublishInput): VenPublishDecision {
  if (!input.pageObservedThisRun) {
    return {
      sourceQty: null,
      proposedQty: 0,
      reason: "no_page_obs_this_run",
      hasPositiveProof: false,
    };
  }
  if (!input.buyableSofort) {
    return {
      sourceQty: null,
      proposedQty: 0,
      reason: "not_sofort_verfuegbar",
      hasPositiveProof: false,
    };
  }
  const source = String(input.stockSource ?? "").trim();
  if (!source) {
    return {
      sourceQty: null,
      proposedQty: 0,
      reason: "no_stock_source",
      hasPositiveProof: false,
    };
  }
  if (source === "sQuantity_max") {
    return {
      sourceQty: input.rawQty ?? null,
      proposedQty: 0,
      reason: "sQuantity_max_untrusted",
      hasPositiveProof: false,
    };
  }
  if (source === "default_stock") {
    return {
      sourceQty: null,
      proposedQty: 0,
      reason: "default_stock_no_proof",
      hasPositiveProof: false,
    };
  }
  if (!TRUSTED_SOURCES.has(source)) {
    return {
      sourceQty: input.rawQty ?? null,
      proposedQty: 0,
      reason: `untrusted_source:${source}`,
      hasPositiveProof: false,
    };
  }
  // Trusted page proof — publish at most 1 (quantityUnknown; VEN pages rarely expose exact >1).
  return {
    sourceQty: input.rawQty ?? null,
    proposedQty: 1,
    reason: `page_proof:${source}`,
    hasPositiveProof: true,
  };
}
