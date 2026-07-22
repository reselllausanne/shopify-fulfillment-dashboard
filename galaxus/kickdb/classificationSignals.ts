/**
 * Extract deterministic classification signals from a KickDB / StockX raw
 * product payload (`KickDBProduct.rawJson`).
 *
 * Same shape main.py `derive_taxonomy_category` uses:
 *   - breadcrumbs: [{ level, alias, value }, ...]
 *   - product_type: "sneakers" | "streetwear" | ...
 *   - category / secondary_category (rare, kept for parity)
 *
 * These signals feed `classifyGalaxusProductKind` in
 * `galaxus/exports/productClassification.ts` and drive both the German Galaxus
 * category path and the size-spec key (Shoe size vs Clothing size).
 */

export type KickdbClassificationSignals = {
  breadcrumbValues: string[];
  breadcrumbAliases: string[];
  productType: string | null;
  category: string | null;
  secondaryCategory: string | null;
};

const EMPTY: KickdbClassificationSignals = {
  breadcrumbValues: [],
  breadcrumbAliases: [],
  productType: null,
  category: null,
  secondaryCategory: null,
};

function safeString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

/**
 * Read `rawJson.breadcrumbs` (StockX shape) and return values + aliases
 * ordered by level ASC (level 1 first). Level 3 is most specific; the
 * classifier iterates aliases in reverse.
 */
export function extractKickdbClassificationSignals(
  rawJson: unknown
): KickdbClassificationSignals {
  if (!rawJson || typeof rawJson !== "object") return EMPTY;
  const raw = rawJson as Record<string, unknown>;
  const breadcrumbs = Array.isArray(raw.breadcrumbs) ? raw.breadcrumbs : [];

  const sorted = breadcrumbs
    .filter((b): b is Record<string, unknown> => !!b && typeof b === "object")
    .map((b) => ({
      level: Number(b.level ?? 0) || 0,
      alias: safeString(b.alias),
      value: safeString(b.value),
    }))
    .sort((a, b) => a.level - b.level);

  return {
    breadcrumbValues: sorted.map((b) => b.value).filter((v): v is string => !!v),
    breadcrumbAliases: sorted.map((b) => b.alias).filter((a): a is string => !!a),
    productType: safeString(raw.product_type) ?? safeString(raw.productType),
    category: safeString(raw.category),
    secondaryCategory: safeString(raw.secondary_category) ?? safeString(raw.secondaryCategory),
  };
}
