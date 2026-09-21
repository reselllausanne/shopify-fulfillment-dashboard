/**
 * Pokémon catalog is publishable only on StockX (`stx`).
 * Every other supplier: never sellable on Galaxus or Decathlon.
 * Classification uses brand, product type, categories, then normalized title/URL.
 * `stx` is never excluded.
 */

const POKEMON_RE = /pok[eé]mon/i;
const POKEMON_COMPACT_RE = /\bpokemon\b/i;

const BRAND_RE =
  /pok[eé]mon|the pokemon company|pokemon company|nintendo.*pokemon|pokemon tcg/i;

const PRODUCT_SIGNATURE_RE =
  /\b(booster|display|elite trainer|etb|build(?:\s|&|-)*battle|tin|deck|theme deck|bundle|box|pack|blister|sleeves|portfolio|binder|playmat|upc|collection|carte|karten|boosterpack)\b/i;

export type PokemonClassifyInput = {
  supplierKey?: string | null;
  providerKey?: string | null;
  supplierVariantId?: string | null;
  title?: string | null;
  brand?: string | null;
  productType?: string | null;
  categories?: Array<string | null | undefined> | null;
  url?: string | null;
  sku?: string | null;
};

export type PokemonClassifyResult = {
  /** True when this row must not be published (non-STX Pokémon). */
  excluded: boolean;
  /** stx rows are never excluded. */
  supplierKey: string | null;
  reason: string;
  confidence: "sure" | "uncertain" | "not_pokemon";
};

export function resolveCatalogSupplierKey(input: PokemonClassifyInput): string | null {
  const direct = String(input.supplierKey ?? "").trim().toLowerCase();
  if (direct) return direct;
  for (const raw of [input.providerKey, input.supplierVariantId]) {
    const text = String(raw ?? "").trim().toLowerCase();
    if (!text) continue;
    const key = text.includes(":")
      ? text.split(":")[0]
      : text.includes("_")
        ? text.split("_")[0]
        : text;
    if (key) return key;
  }
  return null;
}

export function isStockxSupplierKey(input: PokemonClassifyInput): boolean {
  return resolveCatalogSupplierKey(input) === "stx";
}

function normalizeBlob(parts: Array<string | null | undefined>): string {
  return parts
    .map((p) =>
      String(p ?? "")
        .normalize("NFKD")
        .replace(/\u0301/g, "")
        .replace(/é/gi, "e")
        .toLowerCase()
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function mentionsPokemon(text: string): boolean {
  return POKEMON_RE.test(text) || POKEMON_COMPACT_RE.test(text);
}

export function classifyPokemonCatalog(input: PokemonClassifyInput): PokemonClassifyResult {
  const supplierKey = resolveCatalogSupplierKey(input);
  if (supplierKey === "stx") {
    return {
      excluded: false,
      supplierKey,
      reason: "stx_pokemon_allowed",
      confidence: "not_pokemon",
    };
  }

  const brand = normalizeBlob([input.brand]);
  const typeAndCats = normalizeBlob([
    input.productType,
    ...(input.categories ?? []),
  ]);
  const titleUrlSku = normalizeBlob([input.title, input.url, input.sku]);

  if (brand && (BRAND_RE.test(brand) || mentionsPokemon(brand))) {
    return {
      excluded: true,
      supplierKey,
      reason: "brand_pokemon",
      confidence: "sure",
    };
  }
  if (typeAndCats && mentionsPokemon(typeAndCats)) {
    return {
      excluded: true,
      supplierKey,
      reason: "category_or_product_type_pokemon",
      confidence: "sure",
    };
  }
  if (titleUrlSku && mentionsPokemon(titleUrlSku) && PRODUCT_SIGNATURE_RE.test(titleUrlSku)) {
    return {
      excluded: true,
      supplierKey,
      reason: "title_product_signature",
      confidence: "sure",
    };
  }
  if (titleUrlSku && mentionsPokemon(titleUrlSku)) {
    return {
      excluded: true,
      supplierKey,
      reason: "title_pokemon_unspecified_form",
      confidence: "uncertain",
    };
  }
  return {
    excluded: false,
    supplierKey,
    reason: "not_pokemon",
    confidence: "not_pokemon",
  };
}

/** Feed / scrape gate. Uncertain title hits are still excluded (non-STX). */
export function shouldExcludeNonStxPokemon(input: PokemonClassifyInput): boolean {
  return classifyPokemonCatalog(input).excluded;
}
