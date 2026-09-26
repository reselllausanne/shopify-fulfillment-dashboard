/**
 * TUS GTIN resolution for multi-language Woo variations.
 *
 * Storefront JSON-LD is often a ProductGroup with ONE shared gtin (default lang).
 * hasVariant entries have SKU/URL but usually no per-lang gtin → DE barcode would
 * incorrectly attach to EN/FR names. Guard: only trust group gtin for the owner SKU;
 * otherwise cross-fill from WEL when title+lang uniquely match.
 */
import { isValidGtin } from "@/galaxus/exports/feedValidation";

function normalizeGtinDigits(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits || /^0+$/.test(digits)) return null;
  if (!isValidGtin(digits)) return null;
  return digits;
}

export type UncommonCardLang = "DE" | "EN" | "FR" | "JP" | "IT" | "ES";

export type UncommonLdVariant = {
  sku: string | null;
  url: string | null;
  name: string | null;
  gtin: string | null;
};

export type UncommonProductGroupLd = {
  sku: string | null;
  gtin: string | null;
  variants: UncommonLdVariant[];
};

export type UncommonGtinResolveCtx = {
  sku: string;
  permalink: string;
  variationLabel: string | null;
  productName: string;
};

export type UncommonGtinResolved = {
  gtin: string;
  source: string;
};

export type UncommonGtinAmbiguity = UncommonGtinResolveCtx & {
  reason: "product_group_shared_gtin";
  groupSku: string | null;
  groupGtin: string | null;
  lang: UncommonCardLang | null;
  baseName: string;
};

export type UncommonGtinResolveResult =
  | { ok: true; resolved: UncommonGtinResolved }
  | { ok: false; ambiguity: UncommonGtinAmbiguity }
  | { ok: false; ambiguity: null };

export type WelGtinIndexEntry = {
  gtin: string;
  lang: UncommonCardLang;
  tokens: Set<string>;
  norm: string;
};

const LANG_FROM_WORD: Record<string, UncommonCardLang> = {
  deutsch: "DE",
  german: "DE",
  de: "DE",
  englisch: "EN",
  english: "EN",
  en: "EN",
  franzoesisch: "FR",
  franzosisch: "FR",
  französisch: "FR",
  french: "FR",
  fr: "FR",
  japanisch: "JP",
  japanese: "JP",
  jp: "JP",
  italienisch: "IT",
  italian: "IT",
  it: "IT",
  spanisch: "ES",
  spanish: "ES",
  es: "ES",
};

export function parseUncommonCardLang(input: {
  sku?: string | null;
  permalink?: string | null;
  variationLabel?: string | null;
  productName?: string | null;
}): UncommonCardLang | null {
  const variation = String(input.variationLabel || "");
  const name = String(input.productName || "");
  const blob = `${variation} ${name}`;

  const sprache = blob.match(/sprache\s*:\s*([a-zäöü]+)/i);
  if (sprache) {
    const key = sprache[1]!.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");
    if (LANG_FROM_WORD[key]) return LANG_FROM_WORD[key]!;
  }

  const permalink = String(input.permalink || "");
  const attr = permalink.match(/attribute_pa_sprache=([a-z0-9_-]+)/i);
  if (attr) {
    const key = attr[1]!.toLowerCase().replace(/-/g, "");
    if (LANG_FROM_WORD[key]) return LANG_FROM_WORD[key]!;
  }

  const sku = String(input.sku || "");
  const skuLang = sku.match(/(?:^|[._-])(DE|EN|FR|JP|IT|ES)(?:$|[._-])/i);
  if (skuLang) return skuLang[1]!.toUpperCase() as UncommonCardLang;

  const paren = blob.match(/\((DE|EN|FR|JP|IT|ES)\)\s*$/i);
  if (paren) return paren[1]!.toUpperCase() as UncommonCardLang;

  return null;
}

export function uncommonBaseProductName(name: string): string {
  return String(name || "")
    .replace(/\s*[—–-]\s*Sprache:\s*[^—–-]+/gi, "")
    .replace(/\s*[—–-]\s*Version:\s*[^—–-]+/gi, "")
    .replace(/\s*[—–-]\s*Option:\s*[^—–-]+/gi, "")
    .replace(/\s*[—–-]\s*Variante:\s*[^—–-]+/gi, "")
    .replace(/\s*\((DE|EN|FR|JP|IT|ES)\)\s*$/i, "")
    .trim();
}

export function normalizeUncommonTitleForMatch(name: string): string {
  return uncommonBaseProductName(name)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function uncommonTitleTokens(name: string): Set<string> {
  const stop = new Set([
    "the",
    "and",
    "und",
    "der",
    "die",
    "das",
    "ein",
    "eine",
    "a",
    "an",
    "of",
    "for",
    "mit",
    "von",
    "de",
    "la",
    "le",
    "les",
  ]);
  return new Set(
    normalizeUncommonTitleForMatch(name)
      .split(" ")
      .filter((t) => t.length > 2 && !stop.has(t))
  );
}

function tokenJaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function sharedLongTokenCount(a: Set<string>, b: Set<string>, minLen = 5): number {
  let n = 0;
  for (const t of a) if (t.length >= minLen && b.has(t)) n++;
  return n;
}

function readGtinFields(obj: Record<string, unknown>): string | null {
  const raw =
    (typeof obj.gtin13 === "string" && obj.gtin13) ||
    (typeof obj.gtin14 === "string" && obj.gtin14) ||
    (typeof obj.gtin === "string" && obj.gtin) ||
    null;
  return normalizeGtinDigits(raw);
}

function asObjectArray(value: unknown): Record<string, unknown>[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
}

function parseLdNodes(html: string): Record<string, unknown>[] {
  const blocks = [
    ...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
  ];
  const nodes: Record<string, unknown>[] = [];
  for (const match of blocks) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      const data = JSON.parse(raw) as unknown;
      if (Array.isArray(data)) {
        for (const n of data) if (n && typeof n === "object") nodes.push(n as Record<string, unknown>);
      } else if (data && typeof data === "object") {
        const obj = data as Record<string, unknown>;
        if (Array.isArray(obj["@graph"])) {
          for (const n of obj["@graph"] as unknown[]) {
            if (n && typeof n === "object") nodes.push(n as Record<string, unknown>);
          }
        } else {
          nodes.push(obj);
        }
      }
    } catch {
      /* next */
    }
  }
  return nodes;
}

function isType(obj: Record<string, unknown>, want: string): boolean {
  const type = obj["@type"];
  if (type === want) return true;
  return Array.isArray(type) && type.includes(want);
}

export function parseUncommonProductGroupFromHtml(html: string): UncommonProductGroupLd | null {
  for (const node of parseLdNodes(html)) {
    if (!isType(node, "ProductGroup")) continue;
    const variants: UncommonLdVariant[] = [];
    for (const v of asObjectArray(node.hasVariant)) {
      variants.push({
        sku: typeof v.sku === "string" ? v.sku.trim() : null,
        url: typeof v.url === "string" ? v.url.trim() : null,
        name: typeof v.name === "string" ? v.name.trim() : null,
        gtin: readGtinFields(v),
      });
    }
    return {
      sku: typeof node.sku === "string" ? node.sku.trim() : null,
      gtin: readGtinFields(node),
      variants,
    };
  }
  return null;
}

function matchLdVariant(
  group: UncommonProductGroupLd,
  ctx: UncommonGtinResolveCtx
): UncommonLdVariant | null {
  const sku = String(ctx.sku || "").trim();
  if (sku) {
    const bySku = group.variants.find((v) => v.sku && v.sku === sku);
    if (bySku) return bySku;
  }
  const permalink = String(ctx.permalink || "").toLowerCase();
  const attr = permalink.match(/attribute_pa_sprache=([a-z0-9_-]+)/i)?.[1]?.toLowerCase();
  if (attr) {
    const byUrl = group.variants.find((v) => (v.url || "").toLowerCase().includes(`sprache=${attr}`));
    if (byUrl) return byUrl;
  }
  return null;
}

function extractSimpleGtinFromHtml(html: string): UncommonGtinResolved | null {
  for (const node of parseLdNodes(html)) {
    if (isType(node, "ProductGroup")) continue;
    if (!isType(node, "Product") && !node.gtin && !node.gtin13 && !node.gtin14) continue;
    const gtin = readGtinFields(node);
    if (gtin) {
      return { gtin, source: gtin.length === 13 ? "gtin13" : "gtin" };
    }
  }
  const m =
    html.match(/"gtin13"\s*:\s*"(\d{8,14})"/i) ||
    html.match(/"gtin"\s*:\s*"(\d{8,14})"/i) ||
    html.match(/itemprop=["']gtin13["'][^>]*content=["'](\d{8,14})["']/i);
  const gtin = normalizeGtinDigits(m?.[1] ?? null);
  return gtin ? { gtin, source: gtin.length === 13 ? "gtin13" : "gtin" } : null;
}

/**
 * Resolve GTIN for a TUS leaf (simple or variation).
 * Returns ambiguity when ProductGroup shares one GTIN across language variants
 * and this leaf is not the group owner.
 */
export function resolveUncommonGtinFromHtml(
  html: string,
  ctx: UncommonGtinResolveCtx
): UncommonGtinResolveResult {
  const group = parseUncommonProductGroupFromHtml(html);
  const lang = parseUncommonCardLang(ctx);
  const baseName = uncommonBaseProductName(ctx.productName || ctx.variationLabel || "");

  if (group) {
    const matched = matchLdVariant(group, ctx);
    if (matched?.gtin) {
      return { ok: true, resolved: { gtin: matched.gtin, source: "variant_ld_gtin" } };
    }

    const sku = String(ctx.sku || "").trim();
    const isOwner = !!(group.sku && sku && group.sku === sku);
    const langVariantCount = group.variants.filter((v) => {
      if (!v.url && !v.name) return false;
      return /sprache=/i.test(v.url || "") || /deutsch|englisch|franz|japan/i.test(v.name || "");
    }).length;
    const multiLang = langVariantCount > 1 || group.variants.length > 1;

    if (group.gtin && (isOwner || !multiLang)) {
      return {
        ok: true,
        resolved: {
          gtin: group.gtin,
          source: isOwner ? "group_owner_gtin" : "group_single_gtin",
        },
      };
    }

    if (group.gtin && multiLang && !isOwner) {
      return {
        ok: false,
        ambiguity: {
          ...ctx,
          reason: "product_group_shared_gtin",
          groupSku: group.sku,
          groupGtin: group.gtin,
          lang,
          baseName,
        },
      };
    }
  }

  const simple = extractSimpleGtinFromHtml(html);
  if (simple) return { ok: true, resolved: simple };
  return { ok: false, ambiguity: null };
}

export function parseWelCardLang(name: string): UncommonCardLang | null {
  const m = String(name || "").match(/\((DE|EN|FR|JP|IT|ES)\)\s*$/i);
  return m ? (m[1]!.toUpperCase() as UncommonCardLang) : null;
}

export function buildWelGtinIndex(
  rows: Array<{ gtin: string; name: string | null }>
): WelGtinIndexEntry[] {
  const out: WelGtinIndexEntry[] = [];
  for (const row of rows) {
    const gtin = String(row.gtin || "").replace(/\D/g, "");
    if (!gtin || !isValidGtin(gtin)) continue;
    const lang = parseWelCardLang(row.name || "");
    if (!lang) continue;
    const norm = normalizeUncommonTitleForMatch(row.name || "");
    if (!norm) continue;
    out.push({ gtin, lang, tokens: uncommonTitleTokens(row.name || ""), norm });
  }
  return out;
}

/** Strict unique WEL match for ambiguous TUS language variants. */
export function matchWelGtinForUncommon(
  ambiguity: UncommonGtinAmbiguity,
  welIndex: WelGtinIndexEntry[]
): UncommonGtinResolved | null {
  if (!ambiguity.lang || !ambiguity.baseName) return null;
  const tusTokens = uncommonTitleTokens(ambiguity.baseName);
  if (tusTokens.size < 2) return null;

  const scored = welIndex
    .filter((w) => w.lang === ambiguity.lang)
    .map((w) => ({
      gtin: w.gtin,
      score: tokenJaccard(tusTokens, w.tokens),
      sharedLong: sharedLongTokenCount(tusTokens, w.tokens),
    }))
    .filter((c) => c.score >= 0.5 && c.sharedLong >= 1)
    .sort((a, b) => b.score - a.score || b.sharedLong - a.sharedLong);

  if (!scored.length) return null;
  const best = scored[0]!;
  const second = scored[1];
  if (second && best.score - second.score < 0.12 && best.gtin !== second.gtin) {
    return null; // not unique enough
  }
  // Never accept the shared ProductGroup GTIN as a "fix" for a non-owner lang.
  if (ambiguity.groupGtin && best.gtin === ambiguity.groupGtin) return null;
  return { gtin: best.gtin, source: "wel_lang_match" };
}

/** Parent PDP without language attribute — unsafe for Sprache-tagged catalog rows. */
export function isUncommonParentUrlWithoutLangAttr(url: string | null | undefined): boolean {
  const u = String(url || "");
  if (!u) return false;
  if (/attribute_pa_sprache=/i.test(u)) return false;
  return /\/product\//i.test(u);
}
