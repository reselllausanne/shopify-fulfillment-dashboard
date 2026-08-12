/**
 * Shopify location registry + roles.
 *
 * Shopify is the master for PHYSICAL stock. The DB/marketplace side reads this
 * config + the ShopifyVariantLocationStock mirror to compute effective
 * availability (Σ physical + dropship) and to know which location fulfills.
 *
 * Selling priority (physical first, dropship last), per business rule:
 *   Bussigny (1) -> Antica Bottega (2) -> The Lab Concept Store (3) -> COLD BIEN (4) -> dropship (99)
 *
 * Location IDs are stable in Shopify; override via env if they ever change.
 */

export type LocationSourceType = "physical" | "online";

export type LocationConfig = {
  id: string;
  name: string;
  sourceType: LocationSourceType;
  /** Lower = sold first. */
  priority: number;
};

function loc(envKey: string, fallbackId: string, name: string, sourceType: LocationSourceType, priority: number): LocationConfig {
  const id = (process.env[envKey] ?? "").trim() || fallbackId;
  return { id, name, sourceType, priority };
}

const CHEMIN_ONLINE = loc(
  "SHOPIFY_LOC_ONLINE",
  "gid://shopify/Location/72553660705",
  "Chemin de Bas-de-Plan 6",
  "online",
  99
);

export const LOCATIONS: LocationConfig[] = [
  loc("SHOPIFY_LOC_BUSSIGNY", "gid://shopify/Location/111267971458", "Warehouse Bussigny", "physical", 1),
  loc("SHOPIFY_LOC_ANTICA", "gid://shopify/Location/111267217794", "Antica Bottegas", "physical", 2),
  loc("SHOPIFY_LOC_LAB", "gid://shopify/Location/111267250562", "THE LAB CONCEPT STORE", "physical", 3),
  loc("SHOPIFY_LOC_COLD_BIEN", "gid://shopify/Location/111272100226", "COLD BIEN", "physical", 4),
  // Supplier pool (shared group stock) — sellable online, NOT the dropship/Website pool.
  loc("SHOPIFY_LOC_MONEY_KICKZ", "gid://shopify/Location/111274951042", "Money Kickz Supplier", "online", 50),
  CHEMIN_ONLINE,
];

/** Money Kickz / JMoney Kickz supplier location (env override). */
export function moneyKickzLocationId(): string {
  return (
    (process.env.SHOPIFY_LOC_MONEY_KICKZ ?? "").trim() ||
    "gid://shopify/Location/111274951042"
  );
}

/** DB manualNote marker for supplier fixed retail (must survive post-sale unlock). */
export const JMONEY_PRICE_LOCK_NOTE = "jmoney-kicks:price-lock";

export function isJmoneyPriceLockNote(note: string | null | undefined): boolean {
  return /jmoney-kicks\s*:\s*price-lock|jmoney-kicks|money\s*kickz\s*price\s*lock/i.test(
    String(note ?? "")
  );
}

export const PHYSICAL_LOCATIONS = LOCATIONS.filter((l) => l.sourceType === "physical");

/**
 * Dropship / Website stock pool (Chemin). Must NOT be Money Kickz — that is a
 * separate supplier location. Restock zeros THIS location when physical qty rises.
 */
export const ONLINE_LOCATION: LocationConfig = CHEMIN_ONLINE;

/**
 * Physical locations whose owned stock participates in the liquidation /
 * soldes 48h lane (drives manualLock, delivery_48h + soldes collection). Antica is a
 * physical location but not part of liquidation. Chemin (online) is dropship
 * and never eligible.
 */
export const LIQUIDATION_LOCATION_IDS: string[] = [
  loc("SHOPIFY_LOC_BUSSIGNY", "gid://shopify/Location/111267971458", "Warehouse Bussigny", "physical", 1).id,
  loc("SHOPIFY_LOC_LAB", "gid://shopify/Location/111267250562", "THE LAB CONCEPT STORE", "physical", 3).id,
  loc("SHOPIFY_LOC_COLD_BIEN", "gid://shopify/Location/111272100226", "COLD BIEN", "physical", 4).id,
];

const LIQUIDATION_LOCATION_ID_SET = new Set(LIQUIDATION_LOCATION_IDS);

/** Bussigny / Lab / COLD BIEN — physical restock locations that get liquidation pricing. */
export function isLiquidationPhysicalLocation(locationId: string | null | undefined): boolean {
  const id = String(locationId ?? "").trim();
  return id.length > 0 && LIQUIDATION_LOCATION_ID_SET.has(id);
}

const BY_ID = new Map(LOCATIONS.map((l) => [l.id, l]));

export function getLocationConfig(locationId: string): LocationConfig | null {
  return BY_ID.get(locationId) ?? null;
}
