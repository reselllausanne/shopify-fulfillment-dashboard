/**
 * Durable Galaxus policy: WEL Pokémon is never sent in any feed
 * (stock / price / master / specs), including new scrapes.
 *
 * Applied in `accumulateBestCandidates` (live export + snapshot rebuild)
 * and again in `runFeedUpload` so a stale snapshot cannot reintroduce rows.
 */
import { prisma } from "@/app/lib/prisma";
import { withTransientDbRetry } from "@/galaxus/exports/transientDbRetry";

const POKEMON_RE = /pok[eé]mon/;

export function isWelSupplierKey(input: {
  supplierKey?: string | null;
  providerKey?: string | null;
  supplierVariantId?: string | null;
}): boolean {
  const keys = [input.supplierKey, input.providerKey, input.supplierVariantId]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean);
  return keys.some((key) => key === "wel" || key.startsWith("wel_") || key.startsWith("wel:"));
}

/** WEL title/brand match for Pokémon omit. */
export function isWelCardOmitTitle(name: string, brand: string): boolean {
  const text = `${name} ${brand}`.toLowerCase();
  return POKEMON_RE.test(text);
}

export function shouldOmitWelPokemonFromGalaxusFeed(input: {
  supplierKey?: string | null;
  providerKey?: string | null;
  supplierVariantId?: string | null;
  title?: string | null;
  brand?: string | null;
  extraText?: string | null;
}): boolean {
  if (!isWelSupplierKey(input)) return false;
  return isWelCardOmitTitle(`${input.title ?? ""} ${input.extraText ?? ""}`, input.brand ?? "");
}

export async function loadWelCardOmitProviderKeys(): Promise<Set<string>> {
  // Full scan over SupplierVariant (no index serves the ILIKE); under nightly load
  // the default statement_timeout killed master/specs rebuilds (Nov 4). Scope a
  // longer timeout to this query only and retry transient failures.
  const rows = await withTransientDbRetry("wel-card-omit-keys", () =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '600s'`);
      return tx.$queryRawUnsafe<
        Array<{ providerKey: string | null; supplierProductName: string | null; supplierBrand: string | null }>
      >(
        `SELECT "providerKey", "supplierProductName", "supplierBrand"
         FROM "SupplierVariant"
         WHERE "providerKey" ILIKE 'WEL\\_%'
           AND (
             COALESCE("supplierProductName",'') ~* 'pok.?mon'
             OR COALESCE("supplierBrand",'') ~* 'pok.?mon'
           )`
      );
    })
  );
  const out = new Set<string>();
  for (const row of rows) {
    const key = String(row.providerKey ?? "").trim();
    if (!key) continue;
    if (
      shouldOmitWelPokemonFromGalaxusFeed({
        providerKey: key,
        title: row.supplierProductName,
        brand: row.supplierBrand,
      })
    ) {
      out.add(key);
    }
  }
  return out;
}
