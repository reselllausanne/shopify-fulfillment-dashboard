/**
 * Global publish enforcement switch.
 *
 * Absent / not "1" → OBSERVATION_ONLY_NOT_ENFORCED
 *   - reports, review queue, alerts active
 *   - marketplace quantities UNCHANGED
 *
 * SUPPLIER_STOCK_PUBLISH_ENFORCED=1 → apply policies for real
 */

export const OBSERVATION_ONLY_NOT_ENFORCED = "OBSERVATION_ONLY_NOT_ENFORCED";

export function isSupplierStockPublishEnforced(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): boolean {
  return String(env.SUPPLIER_STOCK_PUBLISH_ENFORCED ?? "").trim() === "1";
}

export function getSupplierStockEnforceMode(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): {
  enforced: boolean;
  mode: "enforced" | "observation_only";
  banner: string | null;
} {
  const enforced = isSupplierStockPublishEnforced(env);
  return {
    enforced,
    mode: enforced ? "enforced" : "observation_only",
    banner: enforced ? null : OBSERVATION_ONLY_NOT_ENFORCED,
  };
}

/** True when applyRun may mutate SupplierVariant.stock / zero catalogs. */
export function mayMutateMarketplaceStock(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): boolean {
  return isSupplierStockPublishEnforced(env);
}
