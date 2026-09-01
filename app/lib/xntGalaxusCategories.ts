import type { GalaxusProductKind } from "@/galaxus/exports/galaxusCategoryPaths";

/**
 * Manufactum / XNT partner catalog → Galaxus kind.
 * Titles mostly FR (some DE/EN). Brand map covers kitchen + maker brands.
 * Order = specific before generic.
 */

const KITCHEN_BRANDS = new Set([
  "stadter",
  "le creuset",
  "seltmann weiden",
  "seltmann",
  "gefu",
  "kuhn rikon",
  "rosle",
  "riess emaille",
  "riess",
  "kahla",
  "leonardo",
  "birkmann",
  "westmark",
  "mepal",
  "asa",
  "triangle",
  "lind dna",
  "cilio",
  "graef (gebr. graef)",
  "graef",
  "victorinox",
  "duralex",
]);

const ELECTRONICS_BRANDS = new Set([
  "goobay",
  "berrybase",
  "adafruit",
  "makeblock",
  "raspberry",
  "arduino",
]);

const FASHION_BRANDS = new Set([
  "acne studios",
  "lanius",
  "armedangels",
  "knowledge cotton apparel",
  "alma & lovis",
  "pike brothers",
  "armor lux",
  "oska",
  "comazo",
  "seldom",
  "frei",
  "novila",
  "christiane strobel",
  "pure pure",
  "haflinger",
  "red wing shoe company",
  "werner schuhe",
  "hack lederware",
  "ludwig schroder",
  "oh oh om ethical sportswear",
  "genesis footwear",
  "rauma ullvarefabrikk",
]);

/** Title / productType rules. First match wins. Haystack is accent-stripped lowercase. */
const XNT_TITLE_RULES: Array<{ pattern: RegExp; kind: GalaxusProductKind }> = [
  // books
  {
    pattern: /\b(livre|buch|bucher|verlag|rezepte|roman|guide|lexikon|kochbuch|handbuch)s?\b/i,
    kind: "book",
  },

  // lighting
  {
    pattern:
      /\b(lampe|leuchte|leuchtmittel|ampoule|birne|gluhbirne|flashlight|taschenlampe|stirnlampe)s?\b/i,
    kind: "home_lamp",
  },

  // electronics / maker
  { pattern: /\b(usb|hdmi|kabel|cable|adapter|steckdose|netzteil)s?\b/i, kind: "usb_cable" },
  {
    pattern:
      /\b(sensor|raspberry|arduino|makeblock|entwicklungsboard|mikrocontroller|microcontroller)s?\b/i,
    kind: "dev_board",
  },
  { pattern: /\b(robot|robotik|robotique)s?\b/i, kind: "robot_accessory" },

  // kitchenware — specific before generic kitchen_tool
  {
    pattern: /\b(verre|trinkglas|whiskyglas|weinglas|champagne|gobelet)s?\b|\bglas\b/i,
    kind: "drinking_glass",
  },
  { pattern: /\b(tasse|becher|mug|kaffeetasse|teetasse)s?\b/i, kind: "mug" },
  { pattern: /\b(assiette|teller|plat)s?\b/i, kind: "plate" },
  { pattern: /\b(bol|schussel|schale|bowl)s?\b/i, kind: "bowl" },
  {
    pattern:
      /\b(couteau|messer|fourchette|gabel|cuillere|loffel|besteck|cutlery|steakmesser)s?\b/i,
    kind: "cutlery",
  },
  {
    pattern:
      /\b(casserole|poele|pfanne|topf|topfe|cocotte|bratpfanne|kochtopf|brater|faitout)s?\b/i,
    kind: "cookware",
  },
  {
    pattern:
      /\b(ustensile|kuchenhelfer|ouvre|moule|backform|schneidebrett|planche|reibe|passoire|spatule|fouet|mixbecher|ausstechform)s?\b/i,
    kind: "kitchen_tool",
  },

  // home textiles
  {
    pattern: /\b(housse|couette|bettwasche|drap|kissenbezug|taie|duvet|laken)s?\b/i,
    kind: "bedding",
  },
  {
    pattern: /\b(serviette|handtuch|torchon|geschirrtuch|badetuch|handtucher)s?\b/i,
    kind: "towel",
  },

  // fashion accessories
  { pattern: /\b(ceinture|gurtel|belt)s?\b/i, kind: "belt" },
  { pattern: /\b(gant|handschuh|glove|mitten)s?\b/i, kind: "gloves" },
  { pattern: /\b(echarpe|schal|foulard|scarf|etole)s?\b|\btuch\b/i, kind: "scarf" },
  {
    pattern: /\b(bonnet|beanie|mutze|casquette|cap|chapeau|hut|panama)s?\b/i,
    kind: "beanie",
  },
  { pattern: /\b(chaussette|socken|socks|strumpf)s?\b/i, kind: "socks" },
  {
    pattern:
      /\b(culotte|slip|soutien[- ]?gorge|boxer|unterhose|underwear|bustier|string)s?\b|\bbh\b/i,
    kind: "underwear",
  },
  { pattern: /\b(lunette|sonnenbrille|sunglasses)s?\b/i, kind: "sunglasses" },
  { pattern: /\b(montre|wristwatch)s?\b|\buhr\b/i, kind: "watch" },

  // footwear
  {
    pattern: /\b(chausson|pantoufle|slipper|hausschuh|sabot|mule|clog|tazz|tasman)s?\b/i,
    kind: "slippers",
  },
  { pattern: /\b(sandale|sandal|slide|tong|flip.?flop)s?\b/i, kind: "sandals" },
  { pattern: /\b(botte|boot|stiefel|ranger|moc.?toe|iron ranger)s?\b/i, kind: "boots" },
  {
    pattern: /\b(basket|sneaker|chaussure|schuh|loafer|halbschuh|derby|oxford)s?\b/i,
    kind: "sneakers",
  },

  // bags
  { pattern: /\b(rucksack|backpack|sac.?a.?dos)s?\b/i, kind: "backpack" },
  {
    pattern: /\b(sac|tasche|bag|etui|poche|portefeuille|wallet|gurteltasche)s?\b/i,
    kind: "bag",
  },

  // apparel
  { pattern: /\b(short|bermuda|kurze hose)s?\b/i, kind: "shorts" },
  {
    pattern:
      /\b(pantalon|jeans|jogging|hose|legging|chino|cordchino|sweatpant|roamer pants)s?\b/i,
    kind: "trousers",
  },
  { pattern: /\b(robe|kleid|dress)s?\b/i, kind: "dress" },
  {
    pattern: /\b(doudoune|puffer|parka|winterjacke|manteau|coat)s?\b/i,
    kind: "winter_jacket",
  },
  { pattern: /\b(impermeable|regenjacke|rain.?jacket)s?\b/i, kind: "rain_jacket" },
  {
    pattern: /\b(veste|jacket|jacke|blazer|anorak|windbreaker|bomber)s?\b/i,
    kind: "light_jacket",
  },
  { pattern: /\b(gilet|veste.?sans|bodywarmer|weste)s?\b/i, kind: "vest" },
  {
    pattern: /\b(pull|pullover|cardigan|maille|tricot|sweat|hoodie|crewneck|pull-over)s?\b/i,
    kind: "pullover",
  },
  { pattern: /\b(chemise|hemd|blouse|matelot|oxford)s?\b/i, kind: "hemd" },
  { pattern: /\b(t-?shirt|tee-?shirt|tshirt|polo)s?\b/i, kind: "tshirt" },
  { pattern: /\b(haut|top|debardeur|tank)s?\b/i, kind: "tshirt" },

  // home accessory leftovers
  {
    pattern:
      /\b(crochet|haken|untersetzer|coaster|porte.?savon|vase|cadre|miroir|spiegel|kerze|bougie|seife)s?\b/i,
    kind: "home_accessory",
  },
];

/** Strip accents so FR plurals / É match ASCII regexes. */
function foldAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "");
}

function sanitize(value?: string | null): string {
  if (!value) return "";
  return foldAccents(String(value).replace(/[™®©]/g, "").replace(/\s+/g, " ").trim()).toLowerCase();
}

function brandKindHint(brandRaw: string): GalaxusProductKind | null {
  const brand = brandRaw.toLowerCase();
  if (!brand) return null;
  if ([...ELECTRONICS_BRANDS].some((b) => brand.includes(b))) return "usb_cable";
  if ([...KITCHEN_BRANDS].some((b) => brand.includes(b))) return "kitchen_tool";
  if ([...FASHION_BRANDS].some((b) => brand.includes(b))) return "apparel";
  if (/verlag|oetker|buch/.test(brand)) return "book";
  return null;
}

export function classifyXntGalaxusKind(input: {
  title?: string | null;
  brand?: string | null;
  supplierProductType?: string | null;
}): GalaxusProductKind {
  const title = sanitize(input.title);
  const brand = sanitize(input.brand);
  const productType = sanitize(input.supplierProductType);
  const hay = `${title} ${productType}`.trim();

  if (hay) {
    for (const rule of XNT_TITLE_RULES) {
      if (rule.pattern.test(hay)) return rule.kind;
    }
  }

  const fromBrand = brandKindHint(brand);
  if (fromBrand) return fromBrand;

  return "home_accessory";
}
