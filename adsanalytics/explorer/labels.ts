/**
 * The custom_label_3 vocabulary that drives product routing. Kept in a dependency free
 * module so the Ads mutation layer and the Merchant layer share one definition.
 */
export const EXPLORER_ACTIVE_LABEL = "explorer_active";
export const EXPLORER_ACTIVE_ADIDAS_LABEL = "explorer_active_adidas";
export const EXPLORER_ACTIVE_NIKE_LABEL = "explorer_active_nike";
export const EXPLORER_ACTIVE_JORDAN_LABEL = "explorer_active_jordan";
export const LONG_TAIL_ALL_LABEL = "long_tail_all";

/** Every explorer_active_* variant. Used to detect "product is in some Explorer batch". */
export const EXPLORER_LABELS = [
  EXPLORER_ACTIVE_LABEL,
  EXPLORER_ACTIVE_ADIDAS_LABEL,
  EXPLORER_ACTIVE_NIKE_LABEL,
  EXPLORER_ACTIVE_JORDAN_LABEL,
] as const;

/** Labels owned by the routing machine. Any other value belongs to a core campaign. */
export const ROUTED_LABELS = [
  ...EXPLORER_LABELS,
  LONG_TAIL_ALL_LABEL,
] as const;

/** Map a brand name to its Explorer label. Falls back to the generic label. */
export function explorerLabelForBrand(brand?: string | null): string {
  const normalized = (brand ?? "").trim().toLowerCase();
  if (normalized === "adidas") return EXPLORER_ACTIVE_ADIDAS_LABEL;
  if (normalized === "nike") return EXPLORER_ACTIVE_NIKE_LABEL;
  if (normalized === "jordan") return EXPLORER_ACTIVE_JORDAN_LABEL;
  return EXPLORER_ACTIVE_LABEL;
}

export const CUSTOM_LABEL_3_INDEX = "INDEX3";
