/**
 * VEN (Venova / Shopware 5) publish qty proof.
 * - "stock--quantity-number N" / "Nur noch N Stück" → halfCeil(N)
 * - Sofort verfügbar + no exact qty → 0 (do NOT publish, review)
 * - Schema OutOfStock / not Sofort / Liefertermin unbekannt → 0
 * - sQuantity select max is NOT a stock proof (Shopware caps at inventory-independent limit).
 *   Only use if requireExactSelectMax is explicitly on.
 * - Never invent 100 / never mass-write 1 without page proof.
 */
import { halfCeil } from "./halfCeil";

export type VenStockParse = {
  sourceQty: number | null;
  sofortVerfuegbar: boolean;
  schemaInStock: boolean;
  hasPositiveProof: boolean;
  reason: string;
};

export type VenPublishDecision = {
  sourceQty: number | null;
  proposedQty: number;
  reason: string;
  hasPositiveProof: boolean;
};

export function parseVenStock(input: {
  schemaInStock?: boolean;
  sofortVerfuegbar?: boolean;
  stockQuantityNumber?: number | null;
  liefertermUnbekannt?: boolean;
}): VenStockParse {
  if (input.liefertermUnbekannt) {
    return {
      sourceQty: null,
      sofortVerfuegbar: false,
      schemaInStock: false,
      hasPositiveProof: false,
      reason: "liefertermin_unbekannt",
    };
  }
  if (input.schemaInStock === false) {
    return {
      sourceQty: 0,
      sofortVerfuegbar: false,
      schemaInStock: false,
      hasPositiveProof: false,
      reason: "schema_not_instock",
    };
  }
  if (input.sofortVerfuegbar === false) {
    return {
      sourceQty: null,
      sofortVerfuegbar: false,
      schemaInStock: true,
      hasPositiveProof: false,
      reason: "not_sofort_verfuegbar",
    };
  }

  const qty = input.stockQuantityNumber == null ? null : Math.max(0, Math.floor(input.stockQuantityNumber));
  if (qty == null) {
    return {
      sourceQty: null,
      sofortVerfuegbar: true,
      schemaInStock: true,
      hasPositiveProof: false,
      reason: "sofort_but_no_exact_qty",
    };
  }
  if (qty <= 0) {
    return {
      sourceQty: 0,
      sofortVerfuegbar: true,
      schemaInStock: true,
      hasPositiveProof: false,
      reason: "zero_qty",
    };
  }
  return {
    sourceQty: qty,
    sofortVerfuegbar: true,
    schemaInStock: true,
    hasPositiveProof: true,
    reason: "stock_quantity_number",
  };
}

export function decideVenPublishedQty(parse: VenStockParse): VenPublishDecision {
  if (!parse.hasPositiveProof || parse.sourceQty == null || parse.sourceQty <= 0) {
    return {
      sourceQty: parse.sourceQty,
      proposedQty: 0,
      reason: parse.reason,
      hasPositiveProof: false,
    };
  }
  const proposed = halfCeil(parse.sourceQty);
  return {
    sourceQty: parse.sourceQty,
    proposedQty: proposed,
    reason: `halfCeil:${parse.sourceQty}`,
    hasPositiveProof: proposed > 0,
  };
}
