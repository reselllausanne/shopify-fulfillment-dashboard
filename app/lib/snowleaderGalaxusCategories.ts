import type { GalaxusProductKind } from "@/galaxus/exports/galaxusCategoryPaths";

/**
 * Snowleader GraphQL `category_id` values that map to a Galaxus product kind we export.
 * Leaf-ish categories only (mega parent nodes excluded). Deduped at scrape time by GTIN.
 */
export const SNOWLEADER_GALAXUS_CATEGORY_IDS: string[] = [
  // sneakers
  "596",
  // slippers / après-ski
  "78", "79", "80", "81",
  // sandals
  "605", "599", "359", "352",
  // boots / hiking footwear
  "347", "354", "348", "355", "349", "350", "356", "357", "82", "351", "597", "353", "361", "360",
  "83", "358", "84", "362", "367", "363",
  // apparel
  "560", "67", "555", "575", "8", "292", "580", "38", "335", "563", "276", "274", "278", "562",
  "314", "312", "556", "38948", "11", "38947", "577", "41", "275", "557", "582", "310", "68", "40",
  "579", "311", "559", "291", "578", "558", "3629", "3628", "3038", "576", "3037", "304", "3035",
  "3036", "334", "24207", "3634", "71", "277", "564", "561", "581", "38942", "38944", "38943",
  "3633", "62", "342", "50", "19", "3053", "313", "247", "628", "3054",
  // shorts
  "293", "336", "566", "280", "289", "316", "584", "3039", "305", "38945", "343",
  // trousers / ski & outdoor pants
  "39", "9", "279", "565", "315", "69", "583", "337", "294", "63", "306", "344",
  // underwear
  "43", "13", "325", "45", "15", "317", "281", "26", "326", "283", "57", "319", "44", "28", "14",
  "327", "72", "58", "318", "282", "27", "3028", "3027", "568",
  // socks
  "338", "295", "320", "284", "569", "589", "17", "66", "3029", "3041", "3030", "243",
  // hats / caps
  "296", "339", "285", "322", "590", "18", "570", "3040", "38946", "75", "65",
  // backpacks
  "368", "608", "369", "370", "31034", "537", "231", "633", "373", "376", "501", "233", "210",
  "378", "375", "374", "371", "31037", "234", "211", "235", "212", "213", "236",
  // bags / duffels
  "379", "612", "631", "632", "382", "503", "609", "611", "380", "614", "615", "616", "613", "383",
  "381", "384", "270", "118", "502",
  // skateboards
  "1047",
];

const SNL_CATEGORY_LABEL_TO_KIND: Array<{ pattern: RegExp; kind: GalaxusProductKind }> = [
  { pattern: /sneaker|basket/i, kind: "sneakers" },
  { pattern: /apr[eè]s|après/i, kind: "slippers" },
  { pattern: /sandale|flip.?flop|tong/i, kind: "sandals" },
  { pattern: /wandersandal/i, kind: "sandals" },
  { pattern: /wanderschuhe|bergsteiger|trekking.*schuh|zustieg|halbschuhe|warme wanderschuhe/i, kind: "boots" },
  { pattern: /boxer|unterhose|unterw[aä]sche/i, kind: "underwear" },
  { pattern: /socken/i, kind: "socks" },
  { pattern: /mütze|muetze|beanie|kappe|\bcap\b|hut|stirnband/i, kind: "hat" },
  { pattern: /rucks[aä]ck|daypack|trekkingrucks[aä]ck|tagesrucks[aä]ck|wanderrucks[aä]ck/i, kind: "backpack" },
  { pattern: /duffel|tasche|bauchtasche|reisetasche|fahrradtasche|packtasche/i, kind: "bag" },
  { pattern: /skateboard|nike sb/i, kind: "skateboard" },
  { pattern: /skihose|skihosen|snowboardhose|outdoorhose|\bhosen\b|laufhosen|wanderhosen|legging|tight/i, kind: "trousers" },
  { pattern: /short/i, kind: "shorts" },
  { pattern: /t-shirt|tshirt|polo|pullover|sweat|hemd|jacke|fleece|weste|parka|hoodie|shirt|bluse|triko|bekleidung/i, kind: "apparel" },
];

/** Map Snowleader leaf category label → Galaxus kind (used when supplierKey = snl). */
export function classifySnowleaderCategoryLabel(label?: string | null): GalaxusProductKind | null {
  const text = String(label ?? "").trim();
  if (!text) return null;
  for (const rule of SNL_CATEGORY_LABEL_TO_KIND) {
    if (rule.pattern.test(text)) return rule.kind;
  }
  return null;
}

export function inferSnowleaderGender(parts: Array<string | null | undefined>): string | null {
  const text = parts.filter(Boolean).join(" ").toLowerCase();
  if (/\bdamen\b|\bfrau|\bwomen\b/.test(text)) return "women";
  if (/\bherren\b|\bhomme|\bmen\b/.test(text)) return "men";
  if (/\bkinder\b|\bkids\b|\benfant/.test(text)) return "kids";
  if (/\bunisex\b/.test(text)) return "unisex";
  return null;
}
