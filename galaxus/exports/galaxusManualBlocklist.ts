/** Rows removed from Galaxus by hand (ProviderKey, any supplier). */
const GALAXUS_MANUAL_BLOCKLIST = new Set<string>([
  // Takashi Murakami Flower Plush 30 cm Rainbow/Yellow/White (Galaxus 75458067, 2026-10-14)
  "STX_4560157584359",
  "STX_4580796822667",
]);

export function isGalaxusManuallyBlocked(providerKey: string | null | undefined): boolean {
  return GALAXUS_MANUAL_BLOCKLIST.has(String(providerKey ?? "").trim().toUpperCase());
}
