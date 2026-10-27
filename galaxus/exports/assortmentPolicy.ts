/**
 * Galaxus assortment policy (requested by Galaxus category management, Oct 2026):
 *
 * - electronics: storage media + IT components only (Galaxus, 2026-10-07): PC component /
 *   storage categories, storage / PC-part keywords, and storage / component brands, from
 *   any supplier. Other electronics (phones, audio, TV, lamps, appliances, drones…) stay.
 *   Kept on purpose (strong sellers): Nvidia, DDR5 RAM, SO-DIMM, Raspberry Pi + accessories.
 * - bulky_shipping: long items that are expensive to ship — fluorescent / LED tubes
 *   ("néon"), and strips / profiles / rails / rods of 1 m or more.
 * - shoe_over_cap: footwear with consumer price > 350 CHF (> 300 CHF for low-retail
 *   running / outdoor / casual brands: a 300+ Hoka / Salomon / On is a thin ask, not
 *   a market price). Scope defaults to Tali's focus brands (stxBrandBuckets) with no
 *   collab exemption; env switches to all brands (GALAXUS_SHOE_CAP_SCOPE=all) or
 *   re-enables the collab exemption (GALAXUS_SHOE_CAP_COLLAB_EXEMPT=1).
 * - size_price_outlier: STX size priced ≥ 1.5× the median of the product's in-feed
 *   sizes (one Salomon size at 350 while the rest sit at 150 → SAV). Needs the
 *   feed-wide index from buildStxSizePriceMedianIndex. GALAXUS_STX_SIZE_OUTLIER_RATIO=0 disables.
 * - rei_not_allowlisted: REI rows outside reiGalaxusAllowlist (GALAXUS_REI_ALLOWLIST=0 disables).
 * - plush (Galaxus / Tali, 2026-10-27): soft toys / stuffed animals (Jellycat, "Plush"
 *   titles). Always blocked — fashion-only alone was not enough (STX defaulted them to
 *   sneakers). LEGO / trading cards / hard art toys (Bearbrick) stay allowed.
 * - non_fashion (Galaxus, 2026-10-13): only "Mode > …" categories + the sport / bag types on
 *   Galaxus's fashion list. Exempt: LEGO, trading cards, WEL, REI allowlist.
 *   GALAXUS_FASHION_ONLY=0 disables.
 * - price_outlier: consumer price above GALAXUS_MAX_RETAIL_CHF (default 300, every supplier).
 *   REI allowlist exempt (curated prior sales — Jetson / GB10 / etc. sit above the fashion cap).
 *   LEGO kind is NOT price-cap exempt (Monday 2026-10-26 rollback closed the weekend Klimt hole).
 *   GALAXUS_PRICE_OUTLIER_FILTER=1 also blocks STX asks far above brand retail.
 * - Per-SKU fashion / supplier-disabled holes: galaxusAssortmentExceptions.ts (Tali mail dump).
 *
 * Master + offer skip blocked rows; stock feed pushes QuantityOnStock=0 to delist.
 * Kill switch: GALAXUS_ASSORTMENT_POLICY=0.
 */
import { classifyGalaxusProductKind, isFootwearKind } from "@/galaxus/exports/productClassification";
import { galaxusCategoryPathForKind, type GalaxusProductKind } from "@/galaxus/exports/galaxusCategoryPaths";
import { classifyStxBrand, normalizeStxBrand } from "@/galaxus/exports/stxBrandBuckets";
import { bwzShipChfFromManualNote, isBwzUnshippableNote } from "@/app/lib/bwzParcel";
import { isGalaxusReiAllowlistEnabled, isReiGalaxusAllowlisted } from "@/galaxus/exports/reiGalaxusAllowlist";
import { galaxusCategoryBlocklistCategory, isGalaxusManuallyBlocked } from "@/galaxus/exports/galaxusManualBlocklist";
import { isGalaxusNerApparelOnlyEnabled, isNerApparelOrShoe } from "@/galaxus/exports/nerApparelOnly";
import {
  galaxusCategoryBlockExemptProviderKeys,
  galaxusDisabledSupplierExemptProviderKeys,
  galaxusFashionExemptProviderKeys,
} from "@/galaxus/exports/galaxusAssortmentExceptions";

export type GalaxusAssortmentBlockReason =
  | "electronics"
  | "shoe_over_cap"
  | "size_price_outlier"
  | "price_outlier"
  | "bulky_shipping"
  | "gift_card"
  | "rei_not_allowlisted"
  | "plush"
  | "non_fashion"
  | "manual_block"
  | "food"
  | "category_block"
  | "supplier_disabled"
  | "ner_not_apparel";

export type GalaxusAssortmentInput = {
  providerKey?: string | null;
  supplierVariantId?: string | null;
  supplierKey?: string | null;
  gtin?: string | null;
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
  /** SupplierVariant.manualNote — BWZ stores parcel class / ship CHF here. */
  manualNote?: string | null;
  /** Median consumer price of the product's in-feed STX sizes (buildStxSizePriceMedianIndex). */
  productSizeMedianChf?: number | null;
};

const PRICE_OUTLIER_SUPPLIER_KEYS = new Set(["stx"]);

const IT_COMPONENT_PATH_RE =
  /^IT \+ Multimedia > (?:PC Komponenten|Peripherie > Speicher|Netzwerk > Netzwerkspeicher)\b/;

/** Regex classifier mislabels bike / sport gear here (RockShox "Charger", "Massi IOS"). */
const CLASSIFIER_ELECTRONICS_SKIP_SUPPLIERS = new Set(["ner"]);

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
    "pc[- ]?geh[aä]use",
    "festplattengeh[aä]use",
    "cpu[- ]?k[uü]hler",
    "wasserk[uü]hlung",
  ].join("|"),
  "i"
);
const IT_COMPONENT_CASE_RE = /\b\d+\s?GB\b[^,]*\bRAM\b|\bRAM\b[^,]*\b\d+\s?GB\b|\bNAS\b/;

const IT_COMPONENT_KEEP_RE = /raspberry|\brpi\b|nvidia|\bddr5\b|so-?dimm|\bcsx\b/i;

const TUBE_LAMP_RE =
  /\btube led\b|\bled[- ]?tube\b|led[- ]?r[oö]hre|leuchtstoff(?:r[oö]hre|lampe)|\btube fluo|\bn[eé]on (?:tube|lamp|lampe|r[oö]hre)\b|\btube n[eé]on\b|\bT[58]\b[^,]*\b(?:led|tube|r[oö]hre)\b/i;
const LONG_ITEM_RE =
  /\b(?:strip|ruban|lichtband|rail|tige|barre|baguette)\b|profil|schiene|streifen|stange|rohr|(?<!steckdosen)leiste/i;
const LENGTH_1M_PLUS_RE = /(?<![\d.,])(?:[1-9]\d?(?:[.,]\d+)?\s?m|[1-9]\d{3,}\s?mm)\b/i;

/** Sport-tree product types on Galaxus's fashion list (Solutions Manzinali.xlsx) + bags. */
const FASHION_EXTRA_LEAVES = new Set([
  "Laufschuhe",
  "Wanderschuhe",
  "Outdoorjacken",
  "Outdoorhose",
  "Sportshirt",
  "Funktionsshirt",
  "Funktionsunterhose",
  "Gamaschen",
  "Sportsocken",
  "Velojacke",
  "Velotrikot",
  "Sport-BH",
  "Velohosen",
  "Sturmhaube + Halsschlauch",
  "Rucksack",
  "Tasche",
  "Bauchtasche",
]);
/** Non-fashion kept on purpose: LEGO, trading cards (Pokémon), collectible consoles / controllers. */
const FASHION_EXEMPT_KINDS = new Set<GalaxusProductKind>(["lego", "tradingcard", "console", "controller"]);
/** Non-fashion keep holes — ledger in galaxusAssortmentExceptions.ts. */
const FASHION_EXEMPT_PROVIDER_KEYS = galaxusFashionExemptProviderKeys();
/** WEL kept whole; REI is already narrowed by reiGalaxusAllowlist. */
const FASHION_EXEMPT_SUPPLIERS = new Set(["wel", "rei"]);
/** BWZ (etc.) delist holes — same ledger. */
const DISABLED_SUPPLIER_EXEMPT_PROVIDER_KEYS = galaxusDisabledSupplierExemptProviderKeys();
/** Category cleanup blocklist holes — same ledger. */
const CATEGORY_BLOCK_EXEMPT_PROVIDER_KEYS = galaxusCategoryBlockExemptProviderKeys();
const FASHION_UNKNOWN_KIND_SUPPLIERS = new Set(["stx", "ner", "the", "gld"]);
const APPAREL_SIZE_RE = /^(?:[2-5]?X{0,3}[SL]|XS|M|\d{2,3}(?:\/\d{2,3})?\s*cm)$/i;
const APPAREL_TEXT_RE =
  /\b(t-?shirts?|tees?|shirts?|hoodies?|sweat\w*|pullover|crewneck|beanies?|m[uü]tze|caps?|hats?|slides?|jackets?|jacke|hosen?|cordhose|pants|shorts|jeans|socks?|socken|leggings?|tights|dress|kleid|body|strampler)\b/i;

const GIFT_CARD_RE = /gutschein|geschenkkarte|gift ?card|carte[- ]cadeau|bon[- ]cadeau|e-?voucher/i;

/** Sports nutrition / freeze-dried meals (mostly NER, French titles). */
const FOOD_TEXT_RE =
  /[ée]nerg[ée]tiques?|\b(?:gels?|poudres?|pastilles|comprim[ée]s|g[ée]lules|tablettes?)\s+(?:de r[ée]cup|r[ée]cup|isotoniques?|hypotoniques?|prot[ée]in|d'effort|d'hydratation|hydratante?s?|[ée]lectrolytes?|de sel|sal[ée]e?s?|sportive)|\bboissons?\b|[ée]lectrolytes?\b|\bprot[ée]ines?\b|\bwhey\b|isotonique|maltr?odextrine|\bbcaa\b|cr[ée]atine|p[aâ]tes? de fruits?|lyophilis[ée]|d[ée]shydrat[ée]|multivitamin|spiruline|barres? (?:c[ée]r[ée]ales|prot|[ée]nerg)|compotes?|caf[ée]ine|\bchews\b|shot bloks|bonbons/i;
const FOOD_NOT_RE =
  /\b(bidons?|flasques?|gourdes?|ceintures?|porte-?dossard|chaussures?|sacs?|gilets?|shorts?|sweats?|t-?shirts?|maillots?|vestes?|casquettes?|harnais|gants?|selles?|ruban)\b/i;
const FOOD_BRANDS = new Set([
  "226ers", "decathlon nutrition", "overstims", "powerbar", "tā energy", "ta energy", "goldnutrition", "meltonic",
  "baouw", "santa madre", "näak", "naak", "apurna", "nduranz", "chimpanzee", "isostar", "styrkr",
  "precision fuel & hydration", "andros sport", "maurten", "gu", "clif bar", "pillar", "hydratis", "hydrascore",
  "neversecond", "high5", "science in sport", "sis", "enervit", "tailwind", "nutrixxion", "sponser", "winforce",
  "squeezy", "mulebar", "voyager", "firepot", "mx3",
]);

function isFoodItem(input: GalaxusAssortmentInput, supplierKey: string): boolean {
  const title = String(input.title ?? "");
  if (FOOD_NOT_RE.test(title)) return false;
  if (FOOD_TEXT_RE.test(title)) return true;
  // Brand match NER-only: StockX "GU" is the Uniqlo apparel label.
  return supplierKey === "ner" && FOOD_BRANDS.has(String(input.brand ?? "").trim().toLowerCase());
}

/** Soft toys — belt-and-braces when classifier kind is not yet plush (stale path / alias). */
const PLUSH_SOFT_TOY_RE =
  /\b(plush(?:ie)?s?|soft ?toys?|stuffed (?:animal|toy)|kuscheltiere?|stofftiere?|peluches?|doudous?)\b/i;
const PLUSH_SOFT_TOY_BRANDS = new Set(["jellycat"]);

function isPlushSoftToy(input: GalaxusAssortmentInput): boolean {
  if (PLUSH_SOFT_TOY_BRANDS.has(normalizeStxBrand(input.brand))) return true;
  const text = `${input.title ?? ""} ${input.supplierProductType ?? ""}`;
  return PLUSH_SOFT_TOY_RE.test(text);
}

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
  "asrock",
  "be quiet!",
  "noctua",
  "g.skill",
  "adata",
  "pny",
  "verbatim",
]);

const FOOTWEAR_TEXT_RE =
  /\b(sneakers?|shoes?|chaussures?|schuhe?|trainers?|boots?|sandals?|sandales?|slippers?|clogs?|dunk|jordan|yeezy|air ?max|air ?force|af1|cortez|vomero|pegasus|p-6000|samba|gazelle|superstar|asics|gel-\w+|new ?balance|salomon|xt-6|hoka|on running|birkenstock|ugg|crocs|converse|chuck taylor|timberland|foamposite|kobe|lebron)\b/i;

const FOCUS_SHOE_BRAND_TITLE_RE =
  /\b(nike|jordan|asics|new balance|hoka|salomon|saucony|puma|ugg|brooks|converse|mizuno|birkenstock|crocs|autry|on running)\b/i;

/** Brands whose retail rarely exceeds ~200 CHF: keep the lower shoe cap. */
const LOW_CAP_SHOE_BRANDS = new Set([
  "hoka",
  "hoka one one",
  "salomon",
  "on",
  "on running",
  "asics",
  "saucony",
  "brooks",
  "mizuno",
  "puma",
  "converse",
  "crocs",
  "ugg",
  "birkenstock",
]);
const LOW_CAP_SHOE_TITLE_RE =
  /\b(hoka|salomon|on running|asics|saucony|brooks|mizuno|puma|converse|crocs|ugg|birkenstock)\b/i;

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
  return readNumberEnv("GALAXUS_SHOE_MAX_RETAIL_CHF", 350);
}

/** Cap for low-retail brands (LOW_CAP_SHOE_BRANDS). Env: GALAXUS_SHOE_LOW_CAP_MAX_RETAIL_CHF. */
export function galaxusShoeLowCapMaxRetailChf(): number {
  return readNumberEnv("GALAXUS_SHOE_LOW_CAP_MAX_RETAIL_CHF", 300);
}

/** Brand field wins; title only when brand is empty (NER) so "Nike x Converse" stays Nike. */
export function isLowCapShoeBrand(input: { title?: string | null; brand?: string | null }): boolean {
  const brand = normalizeStxBrand(input.brand);
  if (brand) return LOW_CAP_SHOE_BRANDS.has(brand);
  return LOW_CAP_SHOE_TITLE_RE.test(String(input.title ?? ""));
}

export function galaxusShoeMaxRetailChfFor(input: { title?: string | null; brand?: string | null }): number {
  return isLowCapShoeBrand(input)
    ? Math.min(galaxusShoeLowCapMaxRetailChf(), galaxusShoeMaxRetailChf())
    : galaxusShoeMaxRetailChf();
}

/** Size / product-median ratio that blocks an STX size. 0 disables. Env: GALAXUS_STX_SIZE_OUTLIER_RATIO. */
export function galaxusStxSizeOutlierRatio(): number {
  const n = Number.parseFloat(String(process.env.GALAXUS_STX_SIZE_OUTLIER_RATIO ?? "1.5"));
  return Number.isFinite(n) && n >= 0 ? n : 1.5;
}

/** Fewer in-feed sizes than this → median is not a reliable reference. */
const SIZE_OUTLIER_MIN_SIZES = 3;

function stxSizeProductKey(candidate: any): string | null {
  const variant = candidate?.variant ?? {};
  const supplierKey = resolveAssortmentSupplierKey({
    supplierKey: candidate?.mapping?.supplierKey ?? null,
    supplierVariantId: variant?.supplierVariantId ?? null,
    providerKey: candidate?.providerKey ?? null,
  });
  if (supplierKey !== "stx") return null;
  const sku = String(variant?.supplierSku ?? "").trim().toLowerCase();
  return sku ? sku : null;
}

function candidateSrp(candidate: any): number | null {
  const n = Number(candidate?.variant?.suggestedRetailPriceInclVat);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Median SRP per STX product (supplierSku = product-level SKU) over in-stock feed candidates.
 * Products with fewer than SIZE_OUTLIER_MIN_SIZES priced sizes are left out.
 */
export function buildStxSizePriceMedianIndex(candidates: readonly any[]): Map<string, number> {
  const pricesByProduct = new Map<string, number[]>();
  for (const candidate of candidates) {
    const key = stxSizeProductKey(candidate);
    const srp = candidateSrp(candidate);
    if (!key || srp == null) continue;
    if (!(Number(candidate?.variant?.stock ?? 0) > 0)) continue;
    const list = pricesByProduct.get(key) ?? [];
    list.push(srp);
    pricesByProduct.set(key, list);
  }
  const index = new Map<string, number>();
  for (const [key, prices] of pricesByProduct) {
    if (prices.length < SIZE_OUTLIER_MIN_SIZES) continue;
    prices.sort((a, b) => a - b);
    const mid = Math.floor(prices.length / 2);
    index.set(key, prices.length % 2 === 0 ? (prices[mid - 1]! + prices[mid]!) / 2 : prices[mid]!);
  }
  return index;
}

export function isGalaxusPriceOutlierFilterEnabled(): boolean {
  const raw = String(process.env.GALAXUS_PRICE_OUTLIER_FILTER ?? "0").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(raw);
}

/**
 * BWZ rows without a parcel class are priced with CHF 2 ship; above this feed price
 * (ex VAT) they are likely big / heavy, so block. Env: GALAXUS_BWZ_UNKNOWN_PARCEL_MAX_CHF.
 */
export function galaxusBwzUnknownParcelMaxChf(): number {
  return readNumberEnv("GALAXUS_BWZ_UNKNOWN_PARCEL_MAX_CHF", 100);
}

/** Absolute consumer price cap for any item (CHF incl VAT). Env: GALAXUS_MAX_RETAIL_CHF. */
export function galaxusMaxRetailChf(): number {
  return readNumberEnv("GALAXUS_MAX_RETAIL_CHF", 300);
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
  if (IT_COMPONENT_KEEP_RE.test(`${input.title ?? ""} ${input.brand ?? ""}`)) return false;
  if (IT_COMPONENT_BRANDS.has(normalizeStxBrand(input.brand))) return true;
  const title = String(input.title ?? "");
  return IT_COMPONENT_TEXT_RE.test(title) || IT_COMPONENT_CASE_RE.test(title);
}

export function isBulkyShippingItem(input: { title?: string | null }): boolean {
  const title = String(input.title ?? "");
  if (TUBE_LAMP_RE.test(title)) return true;
  return LONG_ITEM_RE.test(title) && LENGTH_1M_PLUS_RE.test(title);
}

function isBwzShippingUnsafe(input: GalaxusAssortmentInput): boolean {
  if (isBwzUnshippableNote(input.manualNote)) return true;
  if (bwzShipChfFromManualNote(input.manualNote) != null) return false;
  const price = Number(input.purchasePriceExVatChf);
  return Number.isFinite(price) && price > galaxusBwzUnknownParcelMaxChf();
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

/** Suppliers fully delisted from Galaxus. GALAXUS_DISABLED_SUPPLIERS overrides (comma list, "" = none). */
export function galaxusDisabledSuppliers(): Set<string> {
  const raw = process.env.GALAXUS_DISABLED_SUPPLIERS;
  const list = raw === undefined ? "bwz" : raw;
  return new Set(
    list
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isGalaxusFashionOnlyEnabled(): boolean {
  const raw = String(process.env.GALAXUS_FASHION_ONLY ?? "1").trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(raw);
}

/** Shoe / apparel size or clothing word overrides keyword misclassification ("Pool Slide" → pool_robot). */
function hasFashionEvidence(input: GalaxusAssortmentInput): boolean {
  const size = String(input.sizeRaw ?? "").trim();
  if (SHOE_SIZE_RE.test(size) || APPAREL_SIZE_RE.test(size)) return true;
  const text = `${input.title ?? ""} ${input.brand ?? ""}`;
  return APPAREL_TEXT_RE.test(text) || FOOTWEAR_TEXT_RE.test(text);
}

export function isGalaxusFashionKept(
  kind: GalaxusProductKind,
  supplierKey: string,
  input: GalaxusAssortmentInput = {}
): boolean {
  if (FASHION_EXEMPT_SUPPLIERS.has(supplierKey)) return true;
  if (FASHION_EXEMPT_KINDS.has(kind)) return true;
  if (FASHION_EXEMPT_PROVIDER_KEYS.has(String(input.providerKey ?? "").trim().toUpperCase())) return true;
  if (hasFashionEvidence(input)) return true;
  // Unclassified falls back to the Sneakers path — only trustworthy for sneaker suppliers.
  if (kind === "unknown") return FASHION_UNKNOWN_KIND_SUPPLIERS.has(supplierKey);
  const path = galaxusCategoryPathForKind(kind, supplierKey);
  if (path.startsWith("Mode >")) return true;
  return FASHION_EXTRA_LEAVES.has(path.split(">").pop()!.trim());
}

export function galaxusAssortmentBlockReason(
  input: GalaxusAssortmentInput
): GalaxusAssortmentBlockReason | null {
  if (!isGalaxusAssortmentPolicyEnabled()) return null;
  if (isGalaxusManuallyBlocked(input.providerKey)) return "manual_block";
  const providerKeyNorm = String(input.providerKey ?? "")
    .trim()
    .toUpperCase();
  if (
    galaxusCategoryBlocklistCategory(input.providerKey) &&
    !CATEGORY_BLOCK_EXEMPT_PROVIDER_KEYS.has(providerKeyNorm)
  ) {
    return "category_block";
  }
  const supplierKey = resolveAssortmentSupplierKey(input);
  if (
    galaxusDisabledSuppliers().has(supplierKey) &&
    !DISABLED_SUPPLIER_EXEMPT_PROVIDER_KEYS.has(providerKeyNorm)
  ) {
    return "supplier_disabled";
  }
  if (supplierKey === "ner" && isGalaxusNerApparelOnlyEnabled() && !isNerApparelOrShoe(input)) {
    return "ner_not_apparel";
  }
  if (
    supplierKey === "rei" &&
    isGalaxusReiAllowlistEnabled() &&
    !isReiGalaxusAllowlisted(input.providerKey) &&
    !isReiGalaxusAllowlisted(input.gtin ? `REI_${String(input.gtin).trim()}` : null)
  ) {
    return "rei_not_allowlisted";
  }

  const kind = classifyGalaxusProductKind({
    title: input.title,
    brand: input.brand,
    sizeRaw: input.sizeRaw,
    supplierKey,
    supplierProductType: input.supplierProductType,
  });
  const hasShoeSize = SHOE_SIZE_RE.test(String(input.sizeRaw ?? "").trim());
  const keptItItem = IT_COMPONENT_KEEP_RE.test(`${input.title ?? ""} ${input.brand ?? ""}`);
  if (
    !hasShoeSize &&
    !keptItItem &&
    !CLASSIFIER_ELECTRONICS_SKIP_SUPPLIERS.has(supplierKey) &&
    IT_COMPONENT_PATH_RE.test(galaxusCategoryPathForKind(kind, supplierKey))
  ) {
    return "electronics";
  }
  if (!hasShoeSize && isItComponent(input)) return "electronics";
  if (!hasShoeSize && isBulkyShippingItem(input)) return "bulky_shipping";
  if (GIFT_CARD_RE.test(`${input.title ?? ""} ${input.supplierProductType ?? ""}`)) return "gift_card";
  if (supplierKey === "bwz" && isBwzShippingUnsafe(input)) return "bulky_shipping";
  if (supplierKey !== "wel" && isFoodItem(input, supplierKey)) return "food";
  // Soft toys: always delist (independent of GALAXUS_FASHION_ONLY).
  if (kind === "plush" || isPlushSoftToy(input)) return "plush";
  if (isGalaxusFashionOnlyEnabled() && !isGalaxusFashionKept(kind, supplierKey, input)) return "non_fashion";

  const consumer = estimateGalaxusConsumerPriceChf(input);
  if (consumer != null) {
    const reiAllowlisted =
      supplierKey === "rei" &&
      isGalaxusReiAllowlistEnabled() &&
      (isReiGalaxusAllowlisted(input.providerKey) ||
        isReiGalaxusAllowlisted(input.gtin ? `REI_${String(input.gtin).trim()}` : null));
    // Fashion-oriented absolute cap; REI allowlist (NVIDIA Jetson / GB10 / prior sellers) only.
    if (!reiAllowlisted && consumer > galaxusMaxRetailChf()) {
      return "price_outlier";
    }
    // Optional extra: thin StockX asks far above brand retail.
    if (isGalaxusPriceOutlierFilterEnabled() && PRICE_OUTLIER_SUPPLIER_KEYS.has(supplierKey)) {
      const retail = Number(input.brandRetailPrice);
      if (Number.isFinite(retail) && retail > 0 && consumer > retail * galaxusMaxRetailMultiple()) {
        return "price_outlier";
      }
    }
    if (
      consumer > galaxusShoeMaxRetailChfFor(input) &&
      isFootwearKind(kind) &&
      hasFootwearEvidence(input) &&
      isShoeCapInScope(input)
    ) {
      return "shoe_over_cap";
    }
    const ratio = galaxusStxSizeOutlierRatio();
    const median = Number(input.productSizeMedianChf);
    if (supplierKey === "stx" && ratio > 0 && Number.isFinite(median) && median > 0 && consumer >= median * ratio) {
      return "size_price_outlier";
    }
  }
  return null;
}

export type GalaxusAssortmentStats = Record<GalaxusAssortmentBlockReason, number>;

export function createGalaxusAssortmentStats(): GalaxusAssortmentStats {
  return {
    electronics: 0,
    shoe_over_cap: 0,
    size_price_outlier: 0,
    price_outlier: 0,
    bulky_shipping: 0,
    gift_card: 0,
    rei_not_allowlisted: 0,
    plush: 0,
    non_fashion: 0,
    manual_block: 0,
    food: 0,
    category_block: 0,
    supplier_disabled: 0,
    ner_not_apparel: 0,
  };
}

export function galaxusAssortmentStatsHeaderValue(stats: GalaxusAssortmentStats): string {
  return `electronics=${stats.electronics};shoe_over_cap=${stats.shoe_over_cap};size_price_outlier=${stats.size_price_outlier};price_outlier=${stats.price_outlier};bulky_shipping=${stats.bulky_shipping};gift_card=${stats.gift_card};rei_not_allowlisted=${stats.rei_not_allowlisted};plush=${stats.plush};non_fashion=${stats.non_fashion};manual_block=${stats.manual_block};food=${stats.food};category_block=${stats.category_block};supplier_disabled=${stats.supplier_disabled};ner_not_apparel=${stats.ner_not_apparel}`;
}

/** Feed-candidate adapter shared by master / offer / stock routes. */
export function galaxusAssortmentBlockReasonForCandidate(
  candidate: any,
  stxSizeMedianIndex?: ReadonlyMap<string, number> | null
): GalaxusAssortmentBlockReason | null {
  const sizeKey = stxSizeMedianIndex ? stxSizeProductKey(candidate) : null;
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
    gtin: candidate?.gtin ?? variant?.gtin ?? null,
    title: variant?.supplierProductName ?? product?.name ?? null,
    brand: variant?.supplierBrand ?? product?.brand ?? null,
    sizeRaw: variant?.sizeRaw ?? null,
    supplierProductType: variant?.supplierProductType ?? null,
    suggestedRetailInclVatChf: toNum(variant?.suggestedRetailPriceInclVat),
    purchasePriceExVatChf: toNum(variant?.manualLock ? variant?.manualPrice : null) ?? toNum(candidate?.sellPriceExVat),
    brandRetailPrice: toNum(product?.retailPrice),
    manualNote: variant?.manualNote ?? null,
    productSizeMedianChf: sizeKey ? stxSizeMedianIndex!.get(sizeKey) ?? null : null,
  });
}
