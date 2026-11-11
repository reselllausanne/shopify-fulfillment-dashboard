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
  // Served by partial index SupplierVariant_wel_providerKey_idx (same ILIKE predicate; ~9k rows).
  // - Under nightly load the default statement_timeout killed master/specs rebuilds (Nov 4).
  // - Prisma interactive transaction has a 5s default timeout which also killed it (Nov 5).
  // Fix: use a plain connection with SET statement_timeout via a raw session-level command.
  // $executeRawUnsafe is session-scoped (not transaction), so the subsequent query inherits it.
  const rows = await withTransientDbRetry("wel-card-omit-keys", async () => {
    await prisma.$executeRawUnsafe(`SET statement_timeout = '600s'`);
    const result = await prisma.$queryRawUnsafe<
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
    // Reset timeout so the connection is clean when returned to the pool.
    await prisma.$executeRawUnsafe(`RESET statement_timeout`).catch(() => {});
    return result;
  });
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
