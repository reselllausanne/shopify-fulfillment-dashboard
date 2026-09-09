/**
 * STX feed gate — zero-schema policy filter for the Galaxus feed.
 *
 * Two layers, matching the existing WEL Pokémon precedent:
 *
 *  1. Row-level guard in `accumulateBestCandidates` (galaxus/exports/gtinSelection.ts)
 *     drops STX rows during the live rebuild path so the snapshot never ingests them.
 *
 *  2. ProviderKey set in `runFeedUpload` (galaxus/ops/runFeedUpload.ts) filters
 *     already-generated CSVs so a stale snapshot cannot leak gated rows back into
 *     the feed after policy changes.
 *
 * Rules (STX only, ignored for every other supplier):
 *  - HARD_CAP           : price ≥ STX_HARD_CAP_CHF (10 000) → omit, all buckets.
 *  - NONFOCUS_OVER_500  : price > 500 AND bucket == MAINSTREAM → omit.
 *                         Bucket LUXURY_KEEP / FOCUS are exempt.
 *  - ABERRANT_OVERRIDE  : providerKey listed in `stxAberrantOverrides.json`.
 *                         Semi-automated, hand-curated after running the detector.
 */

import { prisma } from "@/app/lib/prisma";
import { parseSupplierKeyFromVariantId } from "@/galaxus/exports/supplierKey";
import {
  classifyStxBrand,
  STX_HARD_CAP_CHF,
} from "@/galaxus/exports/stxBrandBuckets";
import aberrantOverrides from "@/galaxus/exports/stxAberrantOverrides.json";

export const STX_NONFOCUS_MAX_CHF = 500;

export type StxFeedGateReason =
  | "HARD_CAP_10K"
  | "NONFOCUS_OVER_500"
  | "ABERRANT_OVERRIDE";

type OverridesFile = {
  entries?: Array<{ providerKey?: string | null; reason?: string | null }>;
};

function loadAberrantOverrideSet(): Set<string> {
  const file = aberrantOverrides as OverridesFile;
  const set = new Set<string>();
  for (const entry of file.entries ?? []) {
    const key = String(entry?.providerKey ?? "").trim();
    if (key) set.add(key);
  }
  return set;
}

/** Cached at module load — JSON is committed, changes require a redeploy. */
const ABERRANT_OVERRIDE_KEYS: ReadonlySet<string> = loadAberrantOverrideSet();

export function isStxSupplierKey(input: {
  supplierKey?: string | null;
  providerKey?: string | null;
  supplierVariantId?: string | null;
}): boolean {
  const rawSupplier = String(input.supplierKey ?? "").trim().toLowerCase();
  if (rawSupplier === "stx") return true;

  const fromVariant = parseSupplierKeyFromVariantId(input.supplierVariantId ?? null);
  if (fromVariant === "stx") return true;

  const provider = String(input.providerKey ?? "").trim().toUpperCase();
  return provider.startsWith("STX_");
}

/**
 * Row-level decision. Called during live feed rebuild for every STX candidate.
 * Non-STX rows return { omit: false } unconditionally.
 */
export function shouldOmitStxFromGalaxusFeed(input: {
  supplierKey?: string | null;
  providerKey?: string | null;
  supplierVariantId?: string | null;
  supplierBrand?: string | null;
  price?: number | string | null;
}): { omit: boolean; reason?: StxFeedGateReason } {
  if (!isStxSupplierKey(input)) return { omit: false };

  const providerKey = String(input.providerKey ?? "").trim();
  if (providerKey && ABERRANT_OVERRIDE_KEYS.has(providerKey)) {
    return { omit: true, reason: "ABERRANT_OVERRIDE" };
  }

  const priceNum =
    typeof input.price === "number"
      ? input.price
      : Number(String(input.price ?? "").replace(/,/g, ""));

  if (Number.isFinite(priceNum) && priceNum >= STX_HARD_CAP_CHF) {
    return { omit: true, reason: "HARD_CAP_10K" };
  }

  if (
    Number.isFinite(priceNum) &&
    priceNum > STX_NONFOCUS_MAX_CHF &&
    classifyStxBrand(input.supplierBrand) === "MAINSTREAM"
  ) {
    return { omit: true, reason: "NONFOCUS_OVER_500" };
  }

  return { omit: false };
}

/**
 * Feed-upload safety net. Returns the union of providerKeys that must be filtered
 * out of any CSV before upload — belt-and-braces for stale snapshots that predate
 * the row-level guard.
 *
 * Runs one DB scan; the query uses the `providerKey` index and filters in Postgres.
 */
export async function loadStxFeedGateProviderKeys(): Promise<Set<string>> {
  const rows = await prisma.$queryRawUnsafe<Array<{ providerKey: string | null }>>(
    `
    SELECT "providerKey"
    FROM "SupplierVariant"
    WHERE "providerKey" ILIKE 'STX\\_%'
      AND (
        price >= $1
        OR (
          price > $2
          AND LOWER(COALESCE("supplierBrand", '')) NOT IN (${MAINSTREAM_EXEMPT_SQL_LIST})
        )
      )
    `,
    STX_HARD_CAP_CHF,
    STX_NONFOCUS_MAX_CHF
  );

  const set = new Set<string>();
  for (const row of rows) {
    const key = String(row.providerKey ?? "").trim();
    if (!key) continue;
    set.add(key);
  }
  for (const key of ABERRANT_OVERRIDE_KEYS) set.add(key);
  return set;
}

/**
 * SQL fragment mirroring FOCUS + LUXURY_KEEP buckets (i.e. brands that are
 * exempt from the >500 rule). Kept inline so the DB filter matches
 * `classifyStxBrand` exactly. Case-normalized (LOWER).
 *
 * Only used by `loadStxFeedGateProviderKeys`.
 */
const MAINSTREAM_EXEMPT_BRANDS_LOWER: readonly string[] = [
  // FOCUS
  "nike",
  "jordan",
  "asics",
  "asics sportstyle",
  "new balance",
  "on",
  "on running",
  "birkenstock",
  "hoka one one",
  "hoka",
  "nvidia",
  "lego",
  "salomon",
  "crocs",
  "the pokémon company",
  "the pokemon company",
  "pokemon",
  "pokémon",
  "saucony",
  "puma",
  "ugg",
  "brooks",
  "brooks running",
  "autry",
  "converse",
  "mizuno",
  "creality",
  // LUXURY_KEEP
  "gucci",
  "dior",
  "balenciaga",
  "amiri",
  "prada",
  "givenchy",
  "ferragamo",
  "salvatore ferragamo",
  "rick owens",
  "golden goose",
  "maison margiela",
  "mm6 maison margiela",
  "alexander mcqueen",
  "lanvin",
  "chanel",
  "christian louboutin",
  "chrome hearts",
  "bottega veneta",
  "saint laurent",
  "yves saint laurent",
  "valentino",
  "fendi",
  "dolce & gabbana",
  "dolce and gabbana",
  "versace",
  "burberry",
  "off-white",
  "off white",
  "louis vuitton",
  "hermes",
  "hermès",
  "celine",
  "céline",
  "loewe",
  "bally",
  "brunello cucinelli",
  "moschino",
  "acne studios",
  "jil sander",
  "raf simons",
  "maison mihara yasuhiro",
  "mihara yasuhiro",
  "aime leon dore",
  "aimé leon doré",
  "moncler",
  "canada goose",
  "arc'teryx",
  "arcteryx",
  "bearbrick",
  "be@rbrick",
  "kaws",
  "travis scott",
];

const MAINSTREAM_EXEMPT_SQL_LIST = MAINSTREAM_EXEMPT_BRANDS_LOWER
  .map((b) => `'${b.replace(/'/g, "''")}'`)
  .join(",");
