// Galaxus product classification.
//
// Category paths below are BEST-EFFORT German Galaxus taxonomy paths. They MUST be
// verified against the official Galaxus category tree export (merchant portal /
// SFTP /ProductData/) before the next product-data upload. Mismatches cause
// "Product Type assignment is missing" / non-conformity errors on Galaxus.
//
// To update: pull the Galaxus category tree CSV, find the node matching each kind,
// and replace the path string in GALAXUS_CATEGORY_PATHS below.

export type GalaxusProductKind =
  | "sneakers"
  | "shorts"
  | "apparel"
  | "phone"
  | "backpack"
  | "bag"
  | "pool_robot"
  | "camera"
  | "tumbler"
  | "watch"
  | "lego"
  | "tradingcard"
  | "cap"
  | "hat"
  | "socks"
  | "trousers"
  | "underwear"
  | "sticker"
  | "skateboard"
  | "charger"
  | "headphone"
  | "console"
  | "controller"
  | "coin"
  | "unknown";

type ClassificationInput = {
  title?: string | null;
  description?: string | null;
  category?: string | null;
  secondaryCategory?: string | null;
  productType?: string | null;
  breadcrumbs?: string[] | null;
  brand?: string | null;
};

function sanitizeText(value?: string | null): string {
  if (!value) return "";
  return String(value).replace(/[™®©]/g, "").replace(/\s+/g, " ").trim();
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, " ");
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max).trim();
}

function normalizeBreadcrumbs(values?: string[] | null): string[] {
  if (!Array.isArray(values)) return [];
  return values.map((item) => sanitizeText(item)).filter(Boolean);
}

function combinedText(input: ClassificationInput): string {
  const breadcrumbText = normalizeBreadcrumbs(input.breadcrumbs).join(" ");
  const parts = [
    sanitizeText(input.title ?? ""),
    sanitizeText(stripHtml(input.description ?? "")),
    sanitizeText(input.category ?? ""),
    sanitizeText(input.secondaryCategory ?? ""),
    sanitizeText(input.productType ?? ""),
    breadcrumbText,
  ];
  return parts.join(" ").toLowerCase();
}

const FOOTWEAR_RE =
  /\b(sneaker|samba|gazelle|campus|superstar|jordan|dunk|air ?max|yeezy|asics|new ?balance|salomon|shoe|shoes|trainer|boot)\b/i;
const SHORTS_RE = /\b(shorts?|sweatshort|sweat short)\b/i;
const APPAREL_RE =
  /\b(hoodie|sweatshirt|crewneck|tee|t-shirt|shirt|pants|jogger|jacket|pullover|sweater|track ?pant|essentials)\b/i;
const BACKPACK_RE = /\b(backpack|rucksack|bookbag|daypack)\b/i;
const BAG_RE = /\b(bag|tote|duffel|duffle|gym ?bag|crossbody|sling ?bag|messenger ?bag|handbag|bum ?bag|fanny ?pack|waist ?bag)\b/i;
const PHONE_RE =
  /\b(phone|smartphone|ios|android|screen ?time|digital detox|nfc|magnet|distraction|app store|google play|the brick|getbrick|phone blocker|unbrick|bricked)\b/i;
const POOL_ROBOT_RE =
  /\b(pool|pool cleaner|pool cleaning|pool robot|poolroboter|poolskimmer|skimmer|robotic pool|swimming pool|piscine|solar ?panel)\b/i;

// New kind regexes. Ordered before FOOTWEAR/APPAREL so non-shoe products on
// footwear-brand titles (e.g. "adidas Samba ... Sweatpants") classify correctly.
const TUMBLER_RE = /\b(tumbler|quencher|thermos|water bottle|hip flask)\b/i;
const CAMERA_RE = /\b(camera|camcorder|powershot|dslr|mirrorless|digicam|action camera)\b/i;
const HEADPHONE_RE = /\b(airpods?|headphones?|earbuds?|earphones?|in-?ear|over-?ear)\b/i;
const CHARGER_RE = /\b(magsafe|power ?bank|charger|charging station|wireless charger)\b/i;
const CONSOLE_RE = /\b(playstation|xbox|nintendo switch|games console|retro console|\bn64\b|\bconsole\b)\b/i;
const CONTROLLER_RE = /\b(dualsense|dualshock|controller|gamepad|joy-?con)\b/i;
const LEGO_RE = /\b(lego set|lego duplo|building block|construction toy)\b/i;
const TRADINGCARD_RE = /\b(trading card|booster box|blaster box|card box|elite trainer box|pokemon|pokémon|tcg)\b/i;
const STICKER_RE = /\bstickers?\b/i;
const SKATEBOARD_RE = /\b(skateboard|skate deck|grip tape)\b/i;
const WATCH_RE = /\b(wristwatch|moonswatch|chronograph|smartwatch|watch)\b/i;
const CAP_RE = /\b(5-?panel|snapback|dad cap|truck ?cap|fitted cap)\b/i;
const HAT_RE = /\b(beanie|toque|bobble hat|bucket hat|fitted hat|hat)\b/i;
const SOCKS_RE = /\b(socks?|no-?show socks)\b/i;
const TROUSERS_RE = /\b(trousers?|jeans|sweatpants|joggers?|cargo pants|chinos?)\b/i;
const UNDERWEAR_RE = /\b(boxer|boxer briefs|underwear|briefs|trunks)\b/i;

// Brands whose StockX catalog is homogeneous (always the same product type).
// Checked first; safe because these brands never list footwear on StockX.
const BRAND_CATEGORY: Record<string, GalaxusProductKind> = {
  stanley: "tumbler",
  sprayground: "backpack",
  canon: "camera",
  swatch: "watch",
  lego: "lego",
  pokemon: "tradingcard",
  "pokémon": "tradingcard",
  topps: "tradingcard",
  analogue: "console",
  "united states mint": "coin",
  "new era": "cap",
};

export function requiresGalaxusSizeSpec(kind: GalaxusProductKind): boolean {
  return kind === "apparel" || kind === "shorts" || kind === "sneakers";
}
export function classifyGalaxusProductKind(input: ClassificationInput): GalaxusProductKind {
  const brand = sanitizeText(input.brand ?? "").toLowerCase();
  if (brand && BRAND_CATEGORY[brand]) return BRAND_CATEGORY[brand];

  const text = combinedText(input);
  if (!text) return "unknown";
  if (SHORTS_RE.test(text)) return "shorts";
  if (BACKPACK_RE.test(text)) return "backpack";
  if (BAG_RE.test(text)) return "bag";
  if (TUMBLER_RE.test(text)) return "tumbler";
  if (CAMERA_RE.test(text)) return "camera";
  if (HEADPHONE_RE.test(text)) return "headphone";
  if (CHARGER_RE.test(text)) return "charger";
  if (CONSOLE_RE.test(text)) return "console";
  if (CONTROLLER_RE.test(text)) return "controller";
  if (LEGO_RE.test(text)) return "lego";
  if (TRADINGCARD_RE.test(text)) return "tradingcard";
  if (STICKER_RE.test(text)) return "sticker";
  if (SKATEBOARD_RE.test(text)) return "skateboard";
  if (WATCH_RE.test(text)) return "watch";
  if (CAP_RE.test(text)) return "cap";
  if (HAT_RE.test(text)) return "hat";
  if (SOCKS_RE.test(text)) return "socks";
  if (TROUSERS_RE.test(text)) return "trousers";
  if (UNDERWEAR_RE.test(text)) return "underwear";
  if (POOL_ROBOT_RE.test(text)) return "pool_robot";
  if (PHONE_RE.test(text)) return "phone";
  if (FOOTWEAR_RE.test(text)) return "sneakers";
  if (APPAREL_RE.test(text)) return "apparel";
  return "unknown";
}

export function isFootwearKind(kind: GalaxusProductKind): boolean {
  return kind === "sneakers";
}

// Best-effort German Galaxus taxonomy paths. VERIFY against the Galaxus category
// tree export before relying on these for a live feed upload.
const GALAXUS_CATEGORY_PATHS: Record<GalaxusProductKind, string> = {
  sneakers: "Mode > Alles in Mode > Schuhe > Sneakers",
  shorts: "Mode > Alles in Mode > Bekleidung > Shorts",
  apparel: "Mode > Alles in Mode > Bekleidung",
  backpack: "Mode > Taschen + Gepäck > Rucksack",
  bag: "Mode > Taschen + Gepäck > Tasche",
  phone: "IT + Multimedia > Smartphones + Tablets > Smartphone Zubehör > Weiteres Smartphone Zubehör",
  pool_robot: "Do it + Garden > Pool + Spa > Pool > Poolroboter",
  camera: "IT + Multimedia > Foto + Video > Kameras",
  tumbler: "Sport + Toys > Wasserflaschen + Thermosflaschen",
  watch: "Mode > Alles in Mode > Uhren",
  lego: "Sport + Toys > LEGO",
  tradingcard: "Sport + Toys > Sammelkarten",
  cap: "Mode > Alles in Mode > Accessoires > Caps + Mützen",
  hat: "Mode > Alles in Mode > Accessoires > Mützen + Hüte",
  socks: "Mode > Alles in Mode > Bekleidung > Socken",
  trousers: "Mode > Alles in Mode > Bekleidung > Hosen",
  underwear: "Mode > Alles in Mode > Bekleidung > Unterwäsche",
  sticker: "Office + Gaming > Bürobedarf + Schule > Etiketten + Aufkleber",
  skateboard: "Sport + Toys > Skateboarding > Decks",
  charger: "IT + Multimedia > Zubehör > Ladegeräte",
  headphone: "IT + Multimedia > Audio > Kopfhörer",
  console: "IT + Multimedia > Gaming > Konsolen",
  controller: "IT + Multimedia > Gaming > Zubehör > Controller",
  coin: "Sammeln + Antiquitäten > Münzen",
  unknown: "Mode > Alles in Mode > Schuhe > Sneakers",
};

export function resolveGalaxusProductCategoryPath(input: ClassificationInput): string {
  const breadcrumbs = normalizeBreadcrumbs(input.breadcrumbs);
  if (breadcrumbs.length > 0) return truncate(breadcrumbs.join(" > "), 200);

  const category = sanitizeText(input.category ?? "");
  const secondary = sanitizeText(input.secondaryCategory ?? "");
  const productType = sanitizeText(input.productType ?? "");
  if (category && secondary) return truncate(`${category} > ${secondary}`, 200);
  if (category) return truncate(category, 200);
  if (productType) return truncate(productType, 200);

  const kind = classifyGalaxusProductKind(input);
  return GALAXUS_CATEGORY_PATHS[kind] ?? GALAXUS_CATEGORY_PATHS.unknown;
}

export function resolveGalaxusDescription(input: {
  description?: string | null;
  title?: string | null;
  brand?: string | null;
  category?: string | null;
  secondaryCategory?: string | null;
  productType?: string | null;
  breadcrumbs?: string[] | null;
}): string {
  const existing = sanitizeText(stripHtml(input.description ?? ""));
  if (existing) return truncate(existing, 4000);

  const title = sanitizeText(input.title ?? "");
  const brand = sanitizeText(input.brand ?? "");
  const kind = classifyGalaxusProductKind({
    title,
    brand,
    category: input.category,
    secondaryCategory: input.secondaryCategory,
    productType: input.productType,
    breadcrumbs: input.breadcrumbs,
  });
  const subject = title || "Product";
  const prefix = brand ? `${subject} by ${brand}` : subject;

  if (kind === "shorts") {
    return `${prefix}. Everyday shorts with comfortable fit and versatile styling.`;
  }
  if (kind === "apparel") {
    return `${prefix}. Casual apparel piece designed for daily wear and comfort.`;
  }
  if (kind === "backpack") {
    return `${prefix}. Functional backpack with durable construction and organized compartments for everyday carry.`;
  }
  if (kind === "bag") {
    return `${prefix}. Versatile bag designed for everyday use with practical storage and durable materials.`;
  }
  if (kind === "phone") {
    return `${prefix}. Smartphone accessory designed to support focus and reduce distractions.`;
  }
  if (kind === "pool_robot") {
    return `${prefix}. Intelligent robotic pool cleaner designed for autonomous surface cleaning with app control and high-capacity debris collection.`;
  }
  if (kind === "camera") {
    return `${prefix}. Digital camera capturing high-resolution photos and video with versatile shooting modes.`;
  }
  if (kind === "tumbler") {
    return `${prefix}. Insulated tumbler with FlowState technology keeping drinks cold for hours, designed for everyday hydration.`;
  }
  if (kind === "watch") {
    return `${prefix}. Wristwatch with distinctive design and reliable timekeeping for everyday wear.`;
  }
  if (kind === "lego") {
    return `${prefix}. LEGO construction set encouraging creative building and imaginative play.`;
  }
  if (kind === "tradingcard") {
    return `${prefix}. Trading card product for collectors, sealed in original packaging.`;
  }
  if (kind === "cap" || kind === "hat") {
    return `${prefix}. Headwear with adjustable fit and durable construction for everyday wear.`;
  }
  if (kind === "socks") {
    return `${prefix}. Socks designed for everyday comfort and durable wear.`;
  }
  if (kind === "trousers") {
    return `${prefix}. Trousers designed for everyday wear with comfortable fit and durable fabric.`;
  }
  if (kind === "underwear") {
    return `${prefix}. Underwear designed for everyday comfort with soft, breathable fabric.`;
  }
  if (kind === "sticker") {
    return `${prefix}. Sticker set for customisation and personal expression.`;
  }
  if (kind === "skateboard") {
    return `${prefix}. Skateboard deck and accessories built for performance and durability.`;
  }
  if (kind === "charger") {
    return `${prefix}. Charging accessory delivering reliable power to compatible devices.`;
  }
  if (kind === "headphone") {
    return `${prefix}. Headphones delivering high-quality audio with comfortable fit for everyday listening.`;
  }
  if (kind === "console") {
    return `${prefix}. Gaming console delivering high-performance gameplay and entertainment.`;
  }
  if (kind === "controller") {
    return `${prefix}. Gaming controller offering precise input and ergonomic comfort.`;
  }
  if (kind === "coin") {
    return `${prefix}. Collectible coin in original mint packaging.`;
  }
  return `${prefix}. Lifestyle sneakers with durable construction and all-day comfort.`;
}
