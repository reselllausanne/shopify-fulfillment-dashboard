/**
 * Fuzzy search normalization: fold accents, drop case/punctuation/dashes,
 * tokenize for fragment matching (e.g. "Goubey 32-15" ↔ "32 15").
 */

const ACCENT_RE = /[\u0300-\u036f]/g;

export function foldSearchText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(ACCENT_RE, "")
    .toLowerCase();
}

/** Strip everything except letters/digits; keep as continuous haystack. */
export function compactSearchKey(value: unknown): string {
  return foldSearchText(value).replace(/[^a-z0-9]+/g, "");
}

/** Tokens after removing punctuation / collapsing whitespace. */
export function searchTokens(value: unknown): string[] {
  const folded = foldSearchText(value)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!folded) return [];
  return folded.split(/\s+/).filter(Boolean);
}

export type SearchMatchKind = "exact" | "token" | "partial" | "none";

export type SearchFieldHit = {
  field: string;
  kind: SearchMatchKind;
  value: string;
};

export type RankedSearchHit<T> = {
  item: T;
  score: number;
  reasons: SearchFieldHit[];
};

/**
 * Score how well `query` matches concatenated field values.
 * Exact compact match > all tokens present > partial substring.
 */
export function scoreSearchFields(
  query: unknown,
  fields: Array<{ field: string; value: unknown }>
): { score: number; reasons: SearchFieldHit[] } {
  const qTokens = searchTokens(query);
  const qCompact = compactSearchKey(query);
  if (!qCompact && qTokens.length === 0) {
    return { score: 0, reasons: [] };
  }

  const reasons: SearchFieldHit[] = [];
  let best = 0;

  for (const { field, value } of fields) {
    const raw = String(value ?? "").trim();
    if (!raw) continue;
    const compact = compactSearchKey(raw);
    const tokens = searchTokens(raw);

    if (qCompact && compact === qCompact) {
      reasons.push({ field, kind: "exact", value: raw });
      best = Math.max(best, 1000);
      continue;
    }

    if (qTokens.length > 0 && qTokens.every((t) => tokens.some((x) => x.includes(t) || t.includes(x)))) {
      const allExact = qTokens.every((t) => tokens.includes(t));
      const kind: SearchMatchKind = allExact ? "token" : "partial";
      const score = allExact ? 700 + qTokens.length * 10 : 400 + qTokens.length * 5;
      reasons.push({ field, kind, value: raw });
      best = Math.max(best, score);
      continue;
    }

    if (qCompact && compact.includes(qCompact)) {
      reasons.push({ field, kind: "partial", value: raw });
      best = Math.max(best, 250);
      continue;
    }

    if (qTokens.some((t) => compact.includes(t))) {
      reasons.push({ field, kind: "partial", value: raw });
      best = Math.max(best, 150);
    }
  }

  return { score: best, reasons };
}

export function rankBySearch<T>(
  query: unknown,
  items: T[],
  getFields: (item: T) => Array<{ field: string; value: unknown }>
): RankedSearchHit<T>[] {
  const ranked: RankedSearchHit<T>[] = [];
  for (const item of items) {
    const { score, reasons } = scoreSearchFields(query, getFields(item));
    if (score <= 0) continue;
    ranked.push({ item, score, reasons });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

/** True when haystack matches query under normalize+token rules. */
export function matchesNormalizedSearch(query: unknown, haystack: unknown): boolean {
  return scoreSearchFields(query, [{ field: "value", value: haystack }]).score > 0;
}
