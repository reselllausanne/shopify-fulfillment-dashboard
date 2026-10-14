import categoryBlocklist from "@/galaxus/exports/galaxusCategoryBlocklist.json";

/** Rows removed from Galaxus by hand (ProviderKey, any supplier). */
const GALAXUS_MANUAL_BLOCKLIST = new Set<string>([
  // Takashi Murakami Flower Plush 30 cm Rainbow/Yellow/White (Galaxus 75458067, 2026-10-14)
  "STX_4560157584359",
  "STX_4580796822667",
]);

/**
 * Category cleanup snapshot (2026-10-14 review): ProviderKeys grouped by category
 * (home/kitchen, bike drivetrain without sales, forks/shocks/bearings, camping,
 * lubes/cleaners, plush priced > 3x retail; round 2: tyres, wheels, bike tools/pumps/locks/racks,
 * StockX toys/books/balls). New catalog rows are not covered.
 */
const GALAXUS_CATEGORY_BLOCKLIST = new Map<string, string>(
  Object.entries(categoryBlocklist as Record<string, string[]>).flatMap(([category, keys]) =>
    keys.map((key) => [key.toUpperCase(), category] as [string, string])
  )
);

export function isGalaxusManuallyBlocked(providerKey: string | null | undefined): boolean {
  return GALAXUS_MANUAL_BLOCKLIST.has(String(providerKey ?? "").trim().toUpperCase());
}

export function galaxusCategoryBlocklistCategory(providerKey: string | null | undefined): string | null {
  return GALAXUS_CATEGORY_BLOCKLIST.get(String(providerKey ?? "").trim().toUpperCase()) ?? null;
}
