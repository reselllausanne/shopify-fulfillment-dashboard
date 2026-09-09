/**
 * STX brand policy for Galaxus feed (post Tali call, 2026-09-09).
 *
 * Buckets:
 *  - FOCUS       : Tali's focus-brand list. Never dropped by the >500 rule.
 *  - LUXURY_KEEP : haute couture + art toys where 500+ CHF is normal.
 *                  Never dropped by the >500 rule.
 *  - MAINSTREAM  : normal sportswear / streetwear. Any row > CHF 500 is gated.
 *  - unknown     : default MAINSTREAM (safer to hide than to publish a wrong price).
 *
 * The global hard cap (CHF 10_000) applies to ALL buckets, no exception —
 * kills the obvious StockX dead-ask outliers (e.g. Nike Mercurial @ 66k, Supreme tee @ 533k).
 *
 * These lists are the single source of truth and are consumed by:
 *   - galaxus/exports/stxFeedGate.ts (row-level guard + DB provider-key loader)
 *   - scripts/stx-detect-aberrant.ts (semi-automated aberrant detector)
 */

export type StxBrandBucket = "FOCUS" | "LUXURY_KEEP" | "MAINSTREAM";

/** Global sanity cap. Any STX row at or above this CHF price is omitted. */
export const STX_HARD_CAP_CHF = 10_000;

/** Non-focus brands where > CHF 500 is legitimate; keep them. */
const LUXURY_KEEP_BRANDS: readonly string[] = [
  // haute couture / luxury
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
  // technical outerwear where high avg is normal
  "moncler",
  "canada goose",
  "arc'teryx",
  "arcteryx",
  // art toys / collectibles kept per Tali (2026-09-09)
  "bearbrick",
  "be@rbrick",
  "kaws",
  "travis scott",
];

/** Tali's focus-brand list (aliases normalized). Never dropped by >500 rule. */
const FOCUS_BRANDS: readonly string[] = [
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
];

const LUXURY_SET = new Set(LUXURY_KEEP_BRANDS);
const FOCUS_SET = new Set(FOCUS_BRANDS);

/** Lowercase + trim + collapse whitespace, strip stray punctuation. */
export function normalizeStxBrand(brand: string | null | undefined): string {
  if (!brand) return "";
  return String(brand).trim().toLowerCase().replace(/\s+/g, " ");
}

export function classifyStxBrand(brand: string | null | undefined): StxBrandBucket {
  const norm = normalizeStxBrand(brand);
  if (!norm) return "MAINSTREAM";
  if (FOCUS_SET.has(norm)) return "FOCUS";
  if (LUXURY_SET.has(norm)) return "LUXURY_KEEP";
  return "MAINSTREAM";
}

/** Exposed for admin UIs / debugging. */
export function listStxBrandBuckets(): {
  focus: readonly string[];
  luxuryKeep: readonly string[];
} {
  return { focus: FOCUS_BRANDS, luxuryKeep: LUXURY_KEEP_BRANDS };
}
