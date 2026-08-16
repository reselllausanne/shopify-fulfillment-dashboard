/**
 * Locations Shopify où le stock est physique (déjà expensé via achat / retour).
 * Pour ces locations, la vente doit générer un OrderMatch(cost=0, matchType=physical_fulfillment)
 * automatique à la réception du webhook orders/paid.
 *
 * Ces coûts ont déjà été comptabilisés côté PersonalExpense (achat StockX antérieur,
 * retour marketplace, achat local) — on ne doit pas les recompter.
 *
 * Locations exclues intentionnellement:
 * - "Money Kickz Supplier" → dropship supplier avec COGS stocké dans inventoryItem.cost
 *   (voir upsertMetafieldCostMatches / autoMatchOnPaidOrder pour la lane metafield-cost)
 * - "Website stock" / "Chemin de Bas-de-Plan 6" → dropship online pool (GOAT/StockX
 *   unmatched). Cost=0 y est FAUX — StockX auto-match doit poser le vrai COG une fois
 *   la commande fournisseur reçue. Bug fix 2026-08-16.
 */

const PHYSICAL_FULFILLMENT_LOCATION_NAMES_LC = new Set(
  [
    "the lab concept store",
    "antica bottegas",
    "antica bottega",
    "warehouse bussigny",
    "cold bien",
    "rare bienne",
    "lausanne",
  ].map((n) => n.toLowerCase())
);

/**
 * Nom d'une location Shopify → est-elle un site physique dont le stock est déjà expensé?
 * Insensible à la casse et aux espaces terminaux.
 */
export function isPhysicalFulfillmentLocationName(
  name: string | null | undefined
): boolean {
  const key = String(name ?? "").trim().toLowerCase();
  if (!key) return false;
  return PHYSICAL_FULFILLMENT_LOCATION_NAMES_LC.has(key);
}

/** Nom canonique (pour storage) — retourne le nom original si pas de canonicalisation. */
export function canonicalPhysicalLocationName(name: string | null | undefined): string {
  return String(name ?? "").trim();
}

export const MONEY_KICKZ_LOCATION_NAME_MATCHERS = [/money\s*kickz/i, /jmoney/i];

export function isMoneyKickzLocationName(name: string | null | undefined): boolean {
  const key = String(name ?? "");
  return MONEY_KICKZ_LOCATION_NAME_MATCHERS.some((rx) => rx.test(key));
}
