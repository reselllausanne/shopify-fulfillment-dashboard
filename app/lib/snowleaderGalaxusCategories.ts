import type { GalaxusProductKind } from "@/galaxus/exports/galaxusCategoryPaths";

/**
 * Snowleader GraphQL `category_id` values that map to a Galaxus product kind we export.
 * Leaf-ish categories only (mega parent nodes excluded). Deduped at scrape time by GTIN.
 */
export const SNOWLEADER_GALAXUS_CATEGORY_IDS: string[] = [
  // sneakers
  "596",
  // slippers / après-ski
  "77", "78", "79", "80", "81",
  // sandals
  "352", "359", "599", "605",
  // boots / hiking footwear
  "82", "83", "84", "346", "347", "348", "349", "350", "351", "353", "354", "355",
  "356", "357", "358", "360", "361", "362", "363", "367", "597",
  // apparel
  "7", "8", "10", "11", "19", "21", "22", "24", "25", "31", "32", "37",
  "38", "40", "41", "50", "51", "52", "54", "55", "61", "62", "67", "68",
  "71", "247", "272", "273", "274", "275", "276", "277", "278", "290", "291", "292",
  "298", "299", "300", "303", "304", "308", "309", "310", "311", "312", "313", "314",
  "328", "329", "330", "333", "334", "335", "341", "342", "555", "556", "557", "558",
  "559", "560", "561", "562", "563", "564", "575", "576", "577", "578", "579", "580",
  "581", "582", "627", "628", "3035", "3036", "3037", "3038", "3053", "3054", "3627", "3628",
  "3629", "3632", "3633", "3634", "24207", "38941", "38942", "38943", "38944", "38947", "38948", "38949",
  // shorts
  "224", "280", "289", "293", "302", "305", "316", "331", "336", "343", "566", "584",
  "3039", "38945",
  // trousers / ski & outdoor pants
  "9", "23", "33", "39", "53", "63", "69", "279", "294", "306", "315", "332",
  "337", "344", "565", "583",
  // underwear
  "13", "14", "15", "26", "27", "28", "43", "44", "45", "56", "57", "58",
  "72", "281", "282", "283", "317", "318", "319", "325", "326", "327", "568", "3027",
  "3028",
  // socks
  "17", "30", "36", "47", "60", "66", "74", "243", "284", "295", "320", "338",
  "569", "589", "3029", "3030", "3041",
  // hats / caps
  "18", "35", "48", "65", "75", "165", "216", "237", "239", "285", "296", "322",
  "339", "426", "429", "464", "480", "525", "527", "531", "532", "570", "590", "3040",
  "3189", "38946",
  // backpacks
  "144", "210", "211", "212", "213", "231", "232", "233", "234", "235", "236", "368",
  "369", "370", "371", "372", "373", "374", "375", "376", "378", "442", "477", "501",
  "537", "608", "633", "31034", "31037",
  // bags / duffels
  "118", "196", "270", "379", "380", "381", "382", "383", "384", "502", "503", "609",
  "611", "612", "613", "614", "615", "616", "631", "632",
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
