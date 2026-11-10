import typeBlocklist from "@/galaxus/exports/galaxusProductTypeBlocklist.json";
import typeSynonyms from "@/galaxus/exports/galaxusProductTypeBlocklistSynonyms.json";

/**
 * Galaxus Product types (German leaves from Partner Portal / SM xlsx
 * "Product type to remove - SM.xlsx", 2026-11-10) that must leave the feed.
 *
 * Match against supplierProductType + Galaxus category-path segments.
 * Synonyms expand Excel names that do not equal our path leaves 1:1.
 */

function normalizeProductType(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[+&]/g, " ")
    .replace(/[^a-z0-9äöüß]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const BLOCKED_TYPES = (typeBlocklist as string[])
  .map((t) => String(t).trim())
  .filter(Boolean);

const BLOCKED_NORM = new Set(BLOCKED_TYPES.map(normalizeProductType));

/** Extra needles per Excel type (path / supplierProductType). */
const SYNONYM_NEEDLES: string[] = Object.entries(
  typeSynonyms as Record<string, string[]>
).flatMap(([type, needles]) => [type, ...(needles ?? [])]);

const ALL_NEEDLES_NORM = new Set(
  [...BLOCKED_TYPES, ...SYNONYM_NEEDLES].map(normalizeProductType).filter(Boolean)
);

function pathSegments(categoryPath: string | null | undefined): string[] {
  return String(categoryPath ?? "")
    .split(">")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * True when supplierProductType or a Galaxus category-path segment matches a
 * blocked product type (exact normalized) or a synonym needle (exact normalized).
 * Also matches title when an Excel type / synonym appears as a whole phrase
 * (covers Smartwatch etc. that map to fashion-kept path leaves like Uhren).
 */
export function matchesGalaxusProductTypeBlocklist(input: {
  supplierProductType?: string | null;
  categoryPath?: string | null;
  title?: string | null;
}): string | null {
  const candidates = [
    input.supplierProductType,
    ...pathSegments(input.categoryPath),
  ]
    .map(normalizeProductType)
    .filter(Boolean);

  for (const c of candidates) {
    if (BLOCKED_NORM.has(c) || ALL_NEEDLES_NORM.has(c)) {
      // Prefer canonical Excel name when possible.
      const hit = BLOCKED_TYPES.find((t) => normalizeProductType(t) === c);
      return hit ?? c;
    }
  }

  // Title phrase match only for long / multi-word Excel types (avoid "Game", "Maus", "LEGO" collabs).
  const titleNorm = normalizeProductType(input.title);
  if (titleNorm) {
    for (const type of BLOCKED_TYPES) {
      const n = normalizeProductType(type);
      const multi = n.includes(" ");
      if (!multi && n.length < 10) continue;
      if (
        titleNorm === n ||
        titleNorm.includes(` ${n} `) ||
        titleNorm.startsWith(`${n} `) ||
        titleNorm.endsWith(` ${n}`)
      ) {
        return type;
      }
    }
  }
  return null;
}

export function galaxusProductTypeBlocklistSize(): number {
  return BLOCKED_TYPES.length;
}
