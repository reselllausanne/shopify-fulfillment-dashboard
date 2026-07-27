/**
 * Supplier-variant key guards for physical restock / Bussigny / STX marketplace.
 *
 * NER (partner catalog) rows are read-only from this flow — always create or use
 * an stx_ alternative instead of writing NER SupplierVariant data.
 */

export function supplierKeyFromVariantId(supplierVariantId: string | null | undefined): string {
  const id = String(supplierVariantId ?? "").trim();
  if (!id) return "";
  const colon = id.indexOf(":");
  const underscore = id.indexOf("_");
  if (colon > 0 && (underscore < 0 || colon < underscore)) {
    return id.slice(0, colon).toLowerCase();
  }
  if (underscore > 0) return id.slice(0, underscore).toLowerCase();
  return id.toLowerCase();
}

export function isNerSupplierVariantId(supplierVariantId: string | null | undefined): boolean {
  return supplierKeyFromVariantId(supplierVariantId) === "ner";
}

export function isStxSupplierVariantId(supplierVariantId: string | null | undefined): boolean {
  return supplierKeyFromVariantId(supplierVariantId) === "stx";
}

/** Partner-owned catalog rows that physical restock must never mutate. */
export function isPartnerCatalogSupplierVariantId(
  supplierVariantId: string | null | undefined
): boolean {
  return isNerSupplierVariantId(supplierVariantId);
}

export const STX_SUPPLIER_VARIANT_WHERE = {
  supplierVariantId: { startsWith: "stx_" as const },
};

export const NOT_NER_SUPPLIER_VARIANT_WHERE = {
  NOT: [{ supplierVariantId: { startsWith: "ner:" } }, { supplierVariantId: { startsWith: "ner_" } }],
};
