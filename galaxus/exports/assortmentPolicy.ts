/**
 * Galaxus assortment policy (requested by Galaxus category management, Oct 2026):
 *
 * - electronics: storage media + IT components (Galaxus, 2026-10-07) and, wider, any
 *   electronic item: REI supplier, IT/electrical category, or storage / PC-part
 *   keywords and brands from any supplier.
 * - shoe_over_cap: footwear with consumer price > 300 CHF. Scope defaults to Tali's
 *   focus brands (stxBrandBuckets) with no collab exemption; env switches to all
 *   brands (GALAXUS_SHOE_CAP_SCOPE=all) or re-enables the collab exemption
 *   (GALAXUS_SHOE_CAP_COLLAB_EXEMPT=1).
 * - price_outlier: absurd StockX resale prices (thin asks) — absolute cap or
 *   far above brand retail. Applies to every StockX category (LEGO / collectibles included).
 *
 * Master + offer skip blocked rows; stock feed pushes QuantityOnStock=0 to delist.
 * Kill switch: GALAXUS_ASSORTMENT_POLICY=0.
 */
import { classifyGalaxusProductKind, isFootwearKind } from "@/galaxus/exports/productClassification";
import { galaxusCategoryPathForKind } from "@/galaxus/exports/galaxusCategoryPaths";
import { classifyStxBrand, normalizeStxBrand } from "@/galaxus/exports/stxBrandBuckets";

export type GalaxusAssortmentBlockReason = "electronics" | "shoe_over_cap" | "price_outlier";

export type GalaxusAssortmentInput = {
  providerKey?: string | null;
  supplierVariantId?: string | null;
  supplierKey?: string | null;
  title?: string | null;
  brand?: string | null;
  sizeRaw?: string | null;
  supplierProductType?: string | null;
  /** Galaxus SuggestedRetailPriceInclVat_CHF when we send one (STX). */
  suggestedRetailInclVatChf?: number | null;
  /** Feed purchase price ex VAT (CHF). Used to estimate consumer price when no SRP. */
  purchasePriceExVatChf?: number | null;
  /** Brand retail price (KickDB, USD). */
  brandRetailPrice?: number | null;
};

const ELECTRONICS_SUPPLIER_KEYS = new Set(["rei"]);
const PRICE_OUTLIER_SUPPLIER_KEYS = new Set(["stx"]);

const ELECTRONICS_PATH_RE =
  /^IT \+ Multimedia|Elektr|Leuchtmittel|Lampen \+ Leuchten|Smart Home|Haushaltgeräte|Poolroboter|Drohne|E-Scooter|Ladestation/i;

/** Storage media + PC components by title, for suppliers whose classifier does not know them. */
const IT_COMPONENT_TEXT_RE = new RegExp(
  [
    "\\bssd\\b",
    "\\bhdd\\b",
    "\\bnvme\\b",
    "\\bm\\.2\\b",
    "festplatte",
    "disque dur",
    "hard drive",
    "usb[- ]?stick",
    "cl[eé] usb",
    "speicherkarte",
    "memory card",
    "carte m[eé]moire",
    "micro ?sd(?:hc|xc)?\\b",
    "\\bsd(?:hc|xc)\\b",
    "compactflash",
    "\\bddr[2-5]\\b",
    "so-?dimm",
    "arbeitsspeicher",
    "grafikkarte",
    "graphics card",
    "carte graphique",
    "geforce",
    "radeon",
    "\\brtx ?\\d{4}\\b",
    "\\bgtx ?\\d{3,4}\\b",
    "prozessor",
    "processeur",
    "\\bcpu\\b",
    "ryzen",
    "core i[3579]\\b",
    "mainboard",
    "motherboard",
    "carte m[eè]re",
    "netzteil",
    "\\bpsu\\b",
    "docking ?station",
    "usb[- ]?hub",
    "raspberry pi",
    "arduino",
    "netzwerkkabel",
    "ethernet",
    "patchkabel",
  ].join("|"),
  "i"
);
const IT_COMPONENT_CASE_RE = /\bRAM\b|\bNAS\b/;

const IT_COMPONENT_BRANDS = new Set([
  "sandisk",
  "kingston",
  "crucial",
  "western digital",
  "wd",
  "seagate",
  "lexar",
  "transcend",
  "synology",
  "qnap",
  "intel",
  "amd",
  "nvidia",
  "msi",
  "asrock",
  "gigabyte",
  "be quiet!",
  "noctua",
  "corsair",
  "g.skill",
  "adata",
  "pny",
  "verbatim",
  "creality",
]);

const FOOTWEAR_TEXT_RE =
  /\b(sneakers?|shoes?|chaussures?|schuhe?|trainers?|boots?|sandals?|sandales?|slippers?|clogs?|dunk|jordan|yeezy|air ?max|air ?force|af1|cortez|vomero|pegasus|p-6000|samba|gazelle|superstar|asics|gel-\w+|new ?balance|salomon|xt-6|hoka|on running|birkenstock|ugg|crocs|converse|chuck taylor|timberland|foamposite|kobe|lebron)\b/i;

const FOCUS_SHOE_BRAND_TITLE_RE =
  /\b(nike|jordan|asics|new balance|hoka|salomon|saucony|puma|ugg|brooks|converse|mizuno|birkenstock|crocs|autry|on running)\b/i;

const SHOE_SIZE_RE = /^(?:(?:EU|US|UK)\s*)?(?:[MWYC]\s*)?\d{1,2}(?:[.,]\d)?(?:\s*[12]\/3)?\s*[CYW]?$/i;

/** Collabs / hype lines allowed above the shoe cap. Lowercase match on title + brand. */
const SHOE_COLLAB_RE = new RegExp(
  [
    "off[- ]?white",
    "travis scott",
    "cactus jack",
    "fragment",
    "sacai",
    "union",
    "a ma mani[eè]re",
    "st[uü]ssy",
    "supreme",
    "kaws",
    "wotherspoon",
    "comme des gar[cç]ons",
    "\\bcdg\\b",
    "j ?balvin",
    "bad bunny",
    "fear of god",
    "ambush",
    "patta",
    "parra",
    "concepts",
    "kith",
    "undefeated",
    "atmos",
    "\\bclot\\b",
    "social status",
    "salehe",
    "aim[eé] leon dore",
    "jjjjound",
    "dior",
    "louis vuitton",
    "tom sachs",
    "bodega",
    "palace",
    "\\bbape\\b",
    "a bathing ape",
    "levi'?s",
    "nigo",
    "sb dunk",
    "dunk low sb",
    "friends and family",
    "\\bstrangelove\\b",
    "ben ?& ?jerry",
    "chunky dunky",
    "playstation",
    "eminem",
    "drake",
    "nocta",
    "trophy room",
    "eric emanuel",
    "doernbecher",
    "\\bpe\\b",
    "sample",
    "jacquemus",
    "wales bonner",
    "grace wales",
    "pharrell",
    "humanrace",
    "jerry lorenzo",
    "maison margiela",
    "\\bmm6\\b",
    "rick owens",
    "balenciaga",
  ].join("|"),
  "i"
);

function readNumberEnv(name: string, fallback: number): number {
  const n = Number.parseFloat(String(process.env[name] ?? ""));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function isGalaxusAssortmentPolicyEnabled(): boolean {
  const raw = String(process.env.GALAXUS_ASSORTMENT_POLICY ?? "1").trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(raw);
}

/** Footwear consumer price cap (CHF incl VAT). Env: GALAXUS_SHOE_MAX_RETAIL_CHF. */
export function galaxusShoeMaxRetailChf(): number {
  return readNumberEnv("GALAXUS_SHOE_MAX_RETAIL_CHF", 300);
}

/** Absolute consumer price cap for any item. Env: GALAXUS_MAX_RETAIL_CHF. */
export function galaxusMaxRetailChf(): number {
  return readNumberEnv("GALAXUS_MAX_RETAIL_CHF", 5000);
}

/** Max consumer price / brand retail multiple. Env: GALAXUS_MAX_RETAIL_MULTIPLE. */
export function galaxusMaxRetailMultiple(): number {
  return readNumberEnv("GALAXUS_MAX_RETAIL_MULTIPLE", 20);
}

/** Galaxus consumer price ≈ purchase ex VAT × this (median SRP / net price on sold lines). */
export function galaxusEstimatedRetailMarkup(): number {
  return readNumberEnv("GALAXUS_ESTIMATED_RETAIL_MARKUP", 1.4);
}

export function resolveAssortmentSupplierKey(input: GalaxusAssortmentInput): string {
  const explicit = String(input.supplierKey ?? "").trim().toLowerCase();
  if (explicit) return explicit;
  const sv = String(input.supplierVariantId ?? "").trim().toLowerCase();
  const fromSv = sv.split(/[_:]/)[0];
  if (fromSv) return fromSv;
  return String(input.providerKey ?? "").trim().split("_")[0].toLowerCase();
}

export function estimateGalaxusConsumerPriceChf(input: GalaxusAssortmentInput): number | null {
  const srp = Number(input.suggestedRetailInclVatChf);
  if (Number.isFinite(srp) && srp > 0) return srp;
  const buy = Number(input.purchasePriceExVatChf);
  if (Number.isFinite(buy) && buy > 0) return buy * galaxusEstimatedRetailMarkup();
  return null;
}

export function isShoeCollab(input: { title?: string | null; brand?: string | null }): boolean {
  return SHOE_COLLAB_RE.test(`${input.title ?? ""} ${input.brand ?? ""}`);
}

function hasFootwearEvidence(input: GalaxusAssortmentInput): boolean {
  if (SHOE_SIZE_RE.test(String(input.sizeRaw ?? "").trim())) return true;
  return FOOTWEAR_TEXT_RE.test(`${input.title ?? ""} ${input.brand ?? ""}`);
}

export function isItComponent(input: { title?: string | null; brand?: string | null }): boolean {
  if (IT_COMPONENT_BRANDS.has(normalizeStxBrand(input.brand))) return true;
  const title = String(input.title ?? "");
  return IT_COMPONENT_TEXT_RE.test(title) || IT_COMPONENT_CASE_RE.test(title);
}

/** Focus brand by brand field, or by footwear-brand name in the title (NER titles often lack brand). */
export function isFocusShoeBrand(input: { title?: string | null; brand?: string | null }): boolean {
  if (classifyStxBrand(input.brand) === "FOCUS") return true;
  return FOCUS_SHOE_BRAND_TITLE_RE.test(String(input.title ?? ""));
}

export function galaxusShoeCapScope(): "focus" | "all" {
  return String(process.env.GALAXUS_SHOE_CAP_SCOPE ?? "focus").trim().toLowerCase() === "all" ? "all" : "focus";
}

export function isGalaxusShoeCapCollabExempt(): boolean {
  const raw = String(process.env.GALAXUS_SHOE_CAP_COLLAB_EXEMPT ?? "0").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(raw);
}

function isShoeCapInScope(input: GalaxusAssortmentInput): boolean {
  if (galaxusShoeCapScope() === "focus" && !isFocusShoeBrand(input)) return false;
  if (isGalaxusShoeCapCollabExempt() && isShoeCollab(input)) return false;
  return true;
}

export function galaxusAssortmentBlockReason(
  input: GalaxusAssortmentInput
): GalaxusAssortmentBlockReason | null {
  if (!isGalaxusAssortmentPolicyEnabled()) return null;
  const supplierKey = resolveAssortmentSupplierKey(input);
  if (ELECTRONICS_SUPPLIER_KEYS.has(supplierKey)) return "electronics";

  const kind = classifyGalaxusProductKind({
    title: input.title,
    brand: input.brand,
    sizeRaw: input.sizeRaw,
    supplierKey,
    supplierProductType: input.supplierProductType,
  });
  if (ELECTRONICS_PATH_RE.test(galaxusCategoryPathForKind(kind, supplierKey))) return "electronics";
  if (isItComponent(input)) return "electronics";

  const consumer = estimateGalaxusConsumerPriceChf(input);
  if (consumer != null) {
    // Bugged prices come from thin StockX asks; other suppliers' list prices are real.
    if (PRICE_OUTLIER_SUPPLIER_KEYS.has(supplierKey)) {
      if (consumer > galaxusMaxRetailChf()) return "price_outlier";
      const retail = Number(input.brandRetailPrice);
      if (Number.isFinite(retail) && retail > 0 && consumer > retail * galaxusMaxRetailMultiple()) {
        return "price_outlier";
      }
    }
    if (
      consumer > galaxusShoeMaxRetailChf() &&
      isFootwearKind(kind) &&
      hasFootwearEvidence(input) &&
      isShoeCapInScope(input)
    ) {
      return "shoe_over_cap";
    }
  }
  return null;
}

export type GalaxusAssortmentStats = Record<GalaxusAssortmentBlockReason, number>;

export function createGalaxusAssortmentStats(): GalaxusAssortmentStats {
  return { electronics: 0, shoe_over_cap: 0, price_outlier: 0 };
}

export function galaxusAssortmentStatsHeaderValue(stats: GalaxusAssortmentStats): string {
  return `electronics=${stats.electronics};shoe_over_cap=${stats.shoe_over_cap};price_outlier=${stats.price_outlier}`;
}

/** Feed-candidate adapter shared by master / offer / stock routes. */
export function galaxusAssortmentBlockReasonForCandidate(candidate: any): GalaxusAssortmentBlockReason | null {
  const variant = candidate?.variant ?? {};
  const product = candidate?.product ?? candidate?.mapping?.kickdbVariant?.product ?? null;
  const toNum = (value: unknown) => {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(String(value));
    return Number.isFinite(n) ? n : null;
  };
  return galaxusAssortmentBlockReason({
    providerKey: candidate?.providerKey ?? null,
    supplierVariantId: variant?.supplierVariantId ?? null,
    supplierKey: candidate?.mapping?.supplierKey ?? null,
    title: variant?.supplierProductName ?? product?.name ?? null,
    brand: variant?.supplierBrand ?? product?.brand ?? null,
    sizeRaw: variant?.sizeRaw ?? null,
    supplierProductType: variant?.supplierProductType ?? null,
    suggestedRetailInclVatChf: toNum(variant?.suggestedRetailPriceInclVat),
    purchasePriceExVatChf: toNum(variant?.manualLock ? variant?.manualPrice : null) ?? toNum(candidate?.sellPriceExVat),
    brandRetailPrice: toNum(product?.retailPrice),
  });
}
