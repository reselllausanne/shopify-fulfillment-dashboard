/**
 * Maintainable Galaxus feed integrity / exclusion rules.
 *
 * Each rule returns a stable machine reason for delta reports.
 * Dimension rules live in one explicit list — edit here, not scattered regexes.
 */

export type FeedIntegrityExcludeReason =
  | "REI_NEON_PRODUCT"
  | "REI_DIMENSION_OVER_120CM"
  | "WAGO_PACK_NOT_UNIT"
  | "POKEMON_BOOSTER_DISPLAY_MISMATCH"
  | "QTY_PACK_INFLATION";

export type FeedIntegrityHit = {
  omit: boolean;
  reason?: FeedIntegrityExcludeReason;
  detail?: string;
};

/** Max longest edge (metres) for Reichelt unit-saleable items. */
export const REICHELT_MAX_UNIT_DIMENSION_M = 1.2;

/**
 * Explicit dimensional exclusion rules (Reichelt).
 * `extractMetres` returns the longest edge in metres when the pattern matches.
 */
export const REICHELT_DIMENSION_EXCLUSION_RULES: ReadonlyArray<{
  id: string;
  reason: FeedIntegrityExcludeReason;
  description: string;
  test: (text: string) => number | null;
}> = [
  {
    id: "neon_or_led_tube_length",
    reason: "REI_DIMENSION_OVER_120CM",
    description: "Neon / LED tubes and rods longer than 1.20 m (unit sale)",
    test: (text) => {
      if (!/\b(neon|néon|led[- ]?r[oö]hre|led[- ]?tube|leuchtstoff|fluorescent)\b/i.test(text)) {
        return null;
      }
      return extractLongestDimensionMetres(text);
    },
  },
  {
    id: "any_unit_dimension_over_120cm",
    reason: "REI_DIMENSION_OVER_120CM",
    description: "Any Reichelt unit product with a parsed edge > 1.20 m",
    test: (text) => extractLongestDimensionMetres(text),
  },
];

const NEON_TITLE_RE =
  /\b(neon\b|néon\b|neonröhre|neonr[oö]hre|neon[- ]?tube|n[eé]on[- ]?lampe)\b/i;

const WAGO_PACK_RE =
  /\b(wago)\b.*\b(\d{2,4})\s*(st[üu]ck|pcs|pieces?|er[- ]?pack|pack|ve)\b|\b(\d{2,4})\s*(st[üu]ck|pcs|er[- ]?pack).*\b(wago)\b/i;

const POKEMON_BOOSTER_RE =
  /\b(booster\s*pack|booster\s*single|single\s*booster|1er\s*booster|booster\s*carte)\b/i;
const POKEMON_DISPLAY_RE =
  /\b(booster\s*display|display\s*box|booster\s*box|36\s*booster|18\s*booster|etb|elite\s*trainer)\b/i;

/** Structured "Dimensions : A x B x C mm|cm|m" → longest edge in metres. */
export function extractStructuredDimensionMetres(text: string): number | null {
  const t = String(text ?? "");
  let maxM: number | null = null;
  const consider = (metres: number) => {
    if (!(metres > 0) || !Number.isFinite(metres)) return;
    if (maxM == null || metres > maxM) maxM = metres;
  };

  const re =
    /dimensions?\s*:\s*([\d.,]+)\s*[x×\*]\s*([\d.,]+)\s*[x×\*]\s*([\d.,]+)\s*(mm|cm|m)\b/gi;
  for (const m of t.matchAll(re)) {
    const unit = String(m[4] ?? "").toLowerCase();
    const nums = [m[1], m[2], m[3]].map((s) => Number(String(s).replace(",", ".")));
    for (const n of nums) {
      if (!(n > 0) || !Number.isFinite(n)) continue;
      if (unit === "mm") consider(n / 1000);
      else if (unit === "cm") consider(n / 100);
      else if (unit === "m") consider(n);
    }
  }
  return maxM;
}

/**
 * Parse longest edge from titles like "1200 mm", "1,5 m", "150 cm",
 * plus structured "Dimensions : A x B x C mm".
 * Returns metres, or null when no dimension found.
 */
export function extractLongestDimensionMetres(text: string): number | null {
  const t = String(text ?? "");
  let maxM = extractStructuredDimensionMetres(t);

  const consider = (metres: number) => {
    if (!(metres > 0) || !Number.isFinite(metres)) return;
    if (maxM == null || metres > maxM) maxM = metres;
  };

  for (const m of t.matchAll(/\b(\d{3,5})\s*mm\b/gi)) {
    let mm = Number(m[1]);
    // Reichelt FR sometimes emits 12000 for 1200 mm
    if (mm >= 6000 && mm <= 20000 && mm % 10 === 0) {
      const fixed = mm / 10;
      if (fixed >= 300 && fixed <= 2000) mm = fixed;
    }
    consider(mm / 1000);
  }
  for (const m of t.matchAll(/\b(\d{2,4}(?:[.,]\d+)?)\s*cm\b/gi)) {
    consider(Number(String(m[1]).replace(",", ".")) / 100);
  }
  for (const m of t.matchAll(/\b(\d+(?:[.,]\d+)?)\s*m(?:ètre|eter|eters)?(?![a-z])/gi)) {
    const raw = Number(String(m[1]).replace(",", "."));
    // Avoid matching the leading "m" of "mm" (handled above).
    if (raw >= 0.3 && raw <= 20) consider(raw);
  }
  return maxM;
}

function parseReicheltDescriptionText(manualNote: unknown): string | null {
  if (!manualNote || typeof manualNote !== "string") return null;
  try {
    const parsed = JSON.parse(manualNote);
    const text = String(parsed?.descriptionText ?? "").trim();
    return text || null;
  } catch {
    return null;
  }
}

/**
 * Prefer structured dimensions from Reichelt manualNote.descriptionText,
 * then free-text parse of description, then title/brand/extraText fallback.
 */
export function resolveReicheltLongestDimensionMetres(input: {
  title?: string | null;
  brand?: string | null;
  extraText?: string | null;
  manualNote?: string | null;
}): number | null {
  const descriptionText = parseReicheltDescriptionText(input.manualNote);
  if (descriptionText) {
    const structured = extractStructuredDimensionMetres(descriptionText);
    if (structured != null) return structured;
    const fromDesc = extractLongestDimensionMetres(descriptionText);
    if (fromDesc != null) return fromDesc;
  }

  const fallback = [input.title, input.brand, input.extraText].filter(Boolean).join(" ").trim();
  if (!fallback) return null;
  const structured = extractStructuredDimensionMetres(fallback);
  if (structured != null) return structured;
  return extractLongestDimensionMetres(fallback);
}

export function shouldOmitReicheltByIntegrity(input: {
  supplierKey?: string | null;
  title?: string | null;
  brand?: string | null;
  extraText?: string | null;
  manualNote?: string | null;
}): FeedIntegrityHit {
  const supplier = String(input.supplierKey ?? "").trim().toLowerCase();
  if (supplier !== "rei" && supplier !== "reichelt") return { omit: false };

  const descriptionText = parseReicheltDescriptionText(input.manualNote);
  const text = [input.title, input.brand, input.extraText, descriptionText]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (!text) return { omit: false };

  const metres = resolveReicheltLongestDimensionMetres(input);

  // Neon: exclude when length unknown OR proven > 1.20 m.
  if (NEON_TITLE_RE.test(text)) {
    if (metres == null || metres > REICHELT_MAX_UNIT_DIMENSION_M) {
      return {
        omit: true,
        reason:
          metres != null && metres > REICHELT_MAX_UNIT_DIMENSION_M
            ? "REI_DIMENSION_OVER_120CM"
            : "REI_NEON_PRODUCT",
        detail:
          metres != null
            ? `neon length≈${metres.toFixed(2)}m`
            : "neon product (no safe unit length)",
      };
    }
  }

  // Non-neon: never exclude when dimension unknown — only when proven > 1.20 m.
  if (metres != null && metres > REICHELT_MAX_UNIT_DIMENSION_M) {
    return {
      omit: true,
      reason: "REI_DIMENSION_OVER_120CM",
      detail: `longestEdge=${metres.toFixed(2)}m > ${REICHELT_MAX_UNIT_DIMENSION_M}m`,
    };
  }

  return { omit: false };
}

export function shouldOmitWagoPackNotUnit(input: {
  title?: string | null;
  brand?: string | null;
  supplierSku?: string | null;
}): FeedIntegrityHit {
  const text = [input.title, input.brand, input.supplierSku].filter(Boolean).join(" ");
  if (!/\bwago\b/i.test(text)) return { omit: false };
  const pack = text.match(WAGO_PACK_RE);
  if (!pack) return { omit: false };
  const qty = Number(pack[2] || pack[4] || 0);
  if (qty >= 10) {
    return {
      omit: true,
      reason: "WAGO_PACK_NOT_UNIT",
      detail: `WAGO pack qty=${qty} — unit connectors only`,
    };
  }
  return { omit: false };
}

/**
 * Detect booster title linked / classified as display (or reverse) — GTIN mixups.
 */
export function detectPokemonBoosterDisplayMismatch(input: {
  title?: string | null;
  mappedTitle?: string | null;
  productType?: string | null;
}): FeedIntegrityHit {
  const title = String(input.title ?? "");
  const mapped = String(input.mappedTitle ?? "");
  const type = String(input.productType ?? "");
  const left = `${title} ${type}`;
  const right = mapped;

  const titleBooster = POKEMON_BOOSTER_RE.test(left) && !POKEMON_DISPLAY_RE.test(left);
  const titleDisplay = POKEMON_DISPLAY_RE.test(left);
  const mappedBooster = POKEMON_BOOSTER_RE.test(right) && !POKEMON_DISPLAY_RE.test(right);
  const mappedDisplay = POKEMON_DISPLAY_RE.test(right);

  if ((titleBooster && mappedDisplay) || (titleDisplay && mappedBooster)) {
    return {
      omit: true,
      reason: "POKEMON_BOOSTER_DISPLAY_MISMATCH",
      detail: "booster↔display title mismatch",
    };
  }
  return { omit: false };
}

/**
 * Internal qty 1 must never publish as 100 (pack inflation / bad MOQ mirror).
 * Published qty is clamped to the internal source of truth.
 */
export function sanitizePublishedQuantity(input: {
  internalQty: number;
  publishedQty: number;
  maxPublished?: number;
}): { qty: number; clamped: boolean; reason?: FeedIntegrityExcludeReason } {
  const internal = Math.max(0, Math.floor(Number(input.internalQty) || 0));
  let published = Math.max(0, Math.floor(Number(input.publishedQty) || 0));
  const maxPublished = input.maxPublished ?? 12;
  let clamped = false;

  if (internal === 1 && published > 1) {
    return { qty: 1, clamped: true, reason: "QTY_PACK_INFLATION" };
  }
  if (published > internal && internal > 0) {
    published = internal;
    clamped = true;
  }
  if (published > maxPublished) {
    published = maxPublished;
    clamped = true;
  }
  return { qty: published, clamped };
}

export function evaluateFeedIntegrityOmit(input: {
  supplierKey?: string | null;
  title?: string | null;
  brand?: string | null;
  supplierSku?: string | null;
  mappedTitle?: string | null;
  productType?: string | null;
  extraText?: string | null;
  manualNote?: string | null;
}): FeedIntegrityHit {
  const rei = shouldOmitReicheltByIntegrity(input);
  if (rei.omit) return rei;
  const wago = shouldOmitWagoPackNotUnit(input);
  if (wago.omit) return wago;
  const poke = detectPokemonBoosterDisplayMismatch(input);
  if (poke.omit) return poke;
  return { omit: false };
}
