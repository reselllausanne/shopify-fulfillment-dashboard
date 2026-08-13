/**
 * The custom_label_3 vocabulary that drives product routing. Kept in a dependency free
 * module so the Ads mutation layer and the Merchant layer share one definition.
 */
export const EXPLORER_ACTIVE_LABEL = "explorer_active";
export const LONG_TAIL_ALL_LABEL = "long_tail_all";

/** Labels owned by the routing machine. Any other value belongs to the core campaign. */
export const ROUTED_LABELS = [EXPLORER_ACTIVE_LABEL, LONG_TAIL_ALL_LABEL] as const;

export const CUSTOM_LABEL_3_INDEX = "INDEX3";
