import type { GalaxusProductKind } from "@/galaxus/exports/galaxusCategoryPaths";

function sanitizeText(value?: string | null): string {
  if (!value) return "";
  return String(value).replace(/[™®©]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * WellPlayed.ch Shopify `product_type` → Galaxus kind.
 * Live catalog sample (products.json, Jul 2026):
 *   Board Games, Card Games, Roleplaying Games, Miniature Games,
 *   Sleeve, Accessories, Dices, PlayMats, Paints, Puzzle, Inlay, Ticket
 */
const WEL_SHOPIFY_PRODUCT_TYPE_TO_KIND: Record<string, GalaxusProductKind> = {
  "board games": "boardgame",
  "card games": "cardgame",
  "roleplaying games": "rpg",
  "miniature games": "miniature",
  sleeve: "game_accessory",
  accessories: "game_accessory",
  inlay: "game_accessory",
  paints: "game_accessory",
  dices: "dice",
  playmats: "playmat",
  puzzle: "puzzle",
  ticket: "boardgame",
};

/** Accessory / dice / sleeve brands on WellPlayed — never board games. */
const WEL_ACCESSORY_BRANDS = new Set([
  "gamegenic",
  "arcane tinmen",
  "ultra pro",
  "dragon shield",
  "chessex",
  "feldherr",
  "laserox",
  "folded space",
  "glassstaff",
  "bcw",
  "ultimate guard",
  "kmc",
  "mayday games",
]);

const WEL_TCG_BRANDS = new Set([
  "the pokémon company international",
  "pokémon",
  "pokemon",
  "wizards of the coast",
  "grand archive tcg",
  "flesh and blood",
]);

const WEL_MINIATURE_BRANDS = new Set([
  "games workshop ltd.",
  "games workshop",
  "mantic games",
  "atomic mass games",
  "cool mini or not",
]);

const TCG_TITLE_RE =
  /\b(tcg|trading card|booster box|booster display|elite trainer|blister|booster pack|card game|sammelkartenspiel|pokémon|pokemon)\b/i;
const BOARDGAME_TITLE_RE =
  /\b(board game|gesellschaftsspiel|brettspiel|expansion|big box|starter set|base game)\b/i;
const ACCESSORY_TITLE_RE =
  /\b(sleeve|sleeves|deck box|binder|playmat|play mat|token|dice|würfel|insert|inlay|organizer|foam tray|deck box|tuckbox|card holder|cardport|storage)\b/i;
const MINIATURE_TITLE_RE = /\b(warhammer|miniature|miniatures|paint set|citadel colour)\b/i;
const PUZZLE_TITLE_RE = /\b(puzzle|legespiel)\b/i;
const BAG_TITLE_RE = /\b(carrying bag|board game bag|bag mini|bag maxi|soft crate|game haul)\b/i;
const STICKER_TITLE_RE = /\bsticker\b/i;

export function classifyWelProductKind(input: {
  title?: string | null;
  brand?: string | null;
  supplierProductType?: string | null;
}): GalaxusProductKind {
  const shopifyType = sanitizeText(input.supplierProductType).toLowerCase();
  if (shopifyType && WEL_SHOPIFY_PRODUCT_TYPE_TO_KIND[shopifyType]) {
    return WEL_SHOPIFY_PRODUCT_TYPE_TO_KIND[shopifyType];
  }

  const brand = sanitizeText(input.brand).toLowerCase();
  const title = sanitizeText(input.title).toLowerCase();
  const text = `${title} ${brand}`.trim();
  if (!text) return "boardgame";

  if (brand && WEL_ACCESSORY_BRANDS.has(brand)) {
    if (/\bdice\b|würfel|chessex/i.test(text)) return "dice";
    if (/playmat|play mat|mat\b/i.test(text)) return "playmat";
    if (/bag|crate|insert|inlay|organizer|tray/i.test(text)) return "game_accessory";
    return "game_accessory";
  }
  if (brand && WEL_TCG_BRANDS.has(brand)) return "tradingcard";
  if (brand && WEL_MINIATURE_BRANDS.has(brand)) return "miniature";

  if (TCG_TITLE_RE.test(text)) return "tradingcard";
  if (STICKER_TITLE_RE.test(text)) return "sticker";
  if (BAG_TITLE_RE.test(text)) return "bag";
  if (PUZZLE_TITLE_RE.test(text)) return "puzzle";
  if (MINIATURE_TITLE_RE.test(text)) return "miniature";
  if (ACCESSORY_TITLE_RE.test(text)) {
    if (/\bdice\b|würfel/i.test(text)) return "dice";
    if (/playmat|play mat/i.test(text)) return "playmat";
    return "game_accessory";
  }
  if (BOARDGAME_TITLE_RE.test(text)) return "boardgame";

  // WellPlayed default: tabletop retail, not footwear.
  return "boardgame";
}
