export const MAX_ALL_IN_CHF = 250;

export type StockxDesiredLane = "STANDARD" | "EXPRESS";

export type StockxLaneLabel = "STANDARD" | "EXPRESS" | "UNKNOWN";

export type StockxLaneCard = {
  label: StockxLaneLabel;
  rawLabel: string;
  totalChf: number;
  eta?: string | null;
};

/** Why auto-buy stopped and ops must act. */
export type StockxNeedsHumanReason =
  | "oos"
  | "oos_no_ask"
  | "express_only"
  | "multi_price"
  | "wrong_lane_only"
  | "express_unparsed"
  | "cap"
  | "size_us_map"
  | "price_moved"
  | "bot_fail"
  | "setup"
  | "margin"
  | "slug"
  | "already_matched"
  | "physical_stock"
  | "pickup"
  | "prebuy_dedupe";

export type StockxAutoOutcomeKind = "easy_buy" | "needs_human" | "skipped";

export type StockxNeedsHumanPayload = {
  shopifyOrderName: string;
  shopifyOrderId: string | null;
  shopifyLineItemId: string | null;
  title: string;
  sku: string;
  saleChf: number | null;
  slug: string | null;
  productUrl: string | null;
  buyUrl: string | null;
  sizeEU: string;
  sizeUS: string | null;
  desiredLane: StockxDesiredLane;
  lanes: StockxLaneCard[];
  recommended: StockxLaneCard | null;
  reason: StockxNeedsHumanReason;
  detail?: string | null;
  /** Filename under `.data/` on VPS (ops: open admin StockX checkout / VNC). */
  screenshotRel?: string | null;
};

/** French ops copy for email / admin UI. */
export const STOCKX_NEEDS_HUMAN_REASON_FR: Record<StockxNeedsHumanReason, string> = {
  oos: "Rupture / aucune lane parsée (cause inconnue)",
  oos_no_ask: "Vraie rupture — aucune demande / aucun vendeur à cette taille",
  express_only: "Achetable (prix unique / Xpress) mais STANDARD non parsé — PAS en rupture",
  multi_price: "Plusieurs prix pour la lane demandée — choix ambigu",
  wrong_lane_only: "Seule l'autre lane (Express vs Standard) est dispo sous plafond",
  express_unparsed:
    "Plusieurs prix livraison visibles mais Express non parsé — abort (fail closed)",
  cap: "Prix all-in au-dessus du plafond 250 CHF",
  size_us_map: "Taille EU/US non sélectionnable",
  price_moved: "Prix changé entre lane et écran Passer commande",
  bot_fail: "Échec bot (bouton / parsing / numéro commande)",
  setup: "Setup / commande Shopify introuvable",
  margin: "Marge négative (vente < total StockX)",
  slug: "Slug StockX introuvable pour ce SKU",
  already_matched: "Déjà matché (StockX lié)",
  physical_stock: "Stock physique magasin — skip auto",
  pickup: "Retrait magasin — skip auto",
  prebuy_dedupe:
    "Pré-achat: Gmail (StockX/GOAT) ou achat StockX non lié — pas de nouvel achat",
};
