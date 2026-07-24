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
  // winter sport (Snowleader snow/* leaf categories)
  "12", "16", "20", "29", "34", "42", "46", "49", "59", "70", "73", "88",
  "89", "90", "91", "92", "93", "94", "95", "96", "97", "98", "99", "100",
  "101", "102", "103", "104", "105", "106", "107", "108", "110", "111", "112", "113",
  "114", "115", "116", "117", "119", "120", "121", "122", "123", "124", "125", "126",
  "127", "128", "129", "130", "131", "132", "133", "134", "135", "136", "137", "138",
  "139", "140", "141", "142", "143", "145", "146", "147", "148", "149", "150", "151",
  "152", "153", "154", "155", "157", "158", "160", "162", "163", "164", "166", "167",
  "168", "169", "170", "171", "172", "173", "174", "175", "176", "177", "178", "179",
  "180", "181", "182", "183", "184", "185", "186", "187", "188", "189", "190", "191",
  "192", "193", "194", "201", "217", "218", "219", "220", "227", "228", "253", "254",
  "255", "256", "268", "269", "385", "386", "387", "388", "389", "413", "438", "462",
  "469", "470", "471", "472", "473", "474", "475", "476", "479", "516", "617", "931",
  "935", "1157", "1296", "3827", "24188", "24189", "24190", "24191", "31032", "31033", "31040", "31041",
  "39006", "39007", "39046", "39047", "39048",
];

/**
 * Snowleader leaf category label → Galaxus kind.
 * Order matters: specific winter/outdoor/sport patterns before generic Mode fallbacks.
 * Paths: galaxus/exports/galaxusCategoryPaths.ts (Producttypes.xlsx).
 */
const SNL_CATEGORY_LABEL_TO_KIND: Array<{ pattern: RegExp; kind: GalaxusProductKind }> = [
  // footwear
  { pattern: /sneaker|basket|\bnike sb\b/i, kind: "sneakers" },
  { pattern: /apr[eè]s|après|winterschuhe/i, kind: "slippers" },
  { pattern: /flip.?flop|tong/i, kind: "flip_flops" },
  { pattern: /wandersandal/i, kind: "sandals" },
  { pattern: /sandale/i, kind: "sandals" },
  { pattern: /kletterschuhe/i, kind: "climbing_shoes" },
  { pattern: /laufschuhe|recovery-schuhe/i, kind: "running_shoes" },
  { pattern: /trailschuhe/i, kind: "trail_shoes" },
  { pattern: /wanderschuhe|bergsteiger|warme wanderschuhe|trekking.*schuh|zustiegsschuh/i, kind: "hiking_boots" },
  { pattern: /halbschuhe/i, kind: "halbschuhe" },
  // winter hardware
  { pattern: /skibrille|langlaufsonnenbrille|visiere/i, kind: "ski_goggles" },
  { pattern: /sonnenbrille|sonnenschutz/i, kind: "sunglasses" },
  { pattern: /ski.?helm|ski helme|\bhelme\b/i, kind: "ski_helmet" },
  { pattern: /skimask|sturmhaube|halsschlauch/i, kind: "ski_mask" },
  { pattern: /snowboardschuh|snowboard.*boot/i, kind: "snowboard_boots" },
  { pattern: /snowboardbindung|snowboard.*bind/i, kind: "snowboard_binding" },
  { pattern: /snowboard/i, kind: "snowboard" },
  { pattern: /langlaufschuhe/i, kind: "langlauf_boots" },
  { pattern: /langlaufski|rollskier|skiroller|pistenski|skating|klassisch/i, kind: "langlauf_ski" },
  { pattern: /skischuh|innenschuh|einlegsohl/i, kind: "ski_boots" },
  { pattern: /skist[oö]ck|langlaufst[oö]ck/i, kind: "ski_poles" },
  { pattern: /wanderst[oö]ck|trekkingst[oö]cke|nordic walking st[oö]cke|trailrunning.?st[oö]cke|\bst[oö]cke\b/i, kind: "hiking_poles" },
  { pattern: /skibindung|ski bindung|\bbindungen\b/i, kind: "ski_binding" },
  { pattern: /wachsen|gleitwachs|steigwachs/i, kind: "ski_wax" },
  { pattern: /werzeuge|harscheisen|eispickel|steigeisen/i, kind: "ski_tools" },
  {
    pattern: /tourenski|\bskis\b|freeride ski|freestyle ski|piste ski|\bski set\b|ski inkl|splitboard|telemark|\bski\b(?!.*sock|.*tasche|.*wachs|.*werkzeug|.*zubeh)/i,
    kind: "ski",
  },
  // winter apparel (before generic jacken)
  { pattern: /skihandschuh|ski-hand|langlauf-handschuh|tourenski-handschuh/i, kind: "ski_gloves" },
  { pattern: /langlaufhose|langlauf-hose/i, kind: "langlauf_pants" },
  { pattern: /skihose|tourenskihose|snowboardhose/i, kind: "ski_pants" },
  { pattern: /skianzug/i, kind: "ski_jacket" },
  { pattern: /skijacke|tourenskijacke|ski stepp|ski-fleece|tourenski.*jacke|tourenski-fleece|tourenski-stepp/i, kind: "ski_jacket" },
  { pattern: /langlauf-jacken|langlaufjacke|langlauf bekleidung/i, kind: "langlauf_jacket" },
  // outdoor / sport apparel
  { pattern: /gamaschen/i, kind: "gaiters" },
  { pattern: /sport-bh/i, kind: "sport_bra" },
  { pattern: /mtb bekleidung|fahrradjacke|fahrradbekleidung|velojacke|mtb jacke|bike jacke/i, kind: "bike_jacket" },
  { pattern: /mtb short|velohose|bike short|radhose/i, kind: "bike_pants" },
  { pattern: /trailrunning bekleidung|laufjacke|trailrunning.*jacke/i, kind: "running_jacket" },
  { pattern: /wanderjacke|wanderbekleidung|kletter-bekleidung|kletterbekleidung/i, kind: "outdoor_jacket" },
  { pattern: /tourenjacke|tourenbekleidung/i, kind: "outdoor_jacket" },
  { pattern: /regenjacke|hardshell/i, kind: "rain_jacket" },
  { pattern: /daunen|stepp|winterjacke|parka|isolationsjacke|wärmende jacken/i, kind: "winter_jacket" },
  { pattern: /fleece|softshell|outdoorjacke|funktionsbekleidung|windbreaker|coupe.?vent|outdoor bekleidung|bekleidung technische|blouson/i, kind: "outdoor_jacket" },
  { pattern: /funktionshemd|funktionsshirt|oberteile|technische tops|klettershirt/i, kind: "functional_shirt" },
  { pattern: /thermokleidung|unterhemd/i, kind: "base_layer_top" },
  { pattern: /funktionsunterw|baselayer|first layer|unterhosen|\bleggings\b|\btights\b/i, kind: "base_layer_bottom" },
  { pattern: /outdoorhose|wanderhose|trekkinghose|laufhose|trail.*hose|overalls?|regenhose/i, kind: "outdoor_pants" },
  { pattern: /sportshirt|outdoor.*shirt/i, kind: "outdoor_shirt" },
  { pattern: /\bjacken\b/i, kind: "outdoor_jacket" },
  // base layers / underwear / socks
  { pattern: /boxer|unterhose|unterw[aä]sche/i, kind: "underwear" },
  { pattern: /socken|oversocken|ski-sock/i, kind: "sport_socks" },
  // headwear
  { pattern: /stirnb[aä]nder|schlauchtuch/i, kind: "headband" },
  { pattern: /mütze|muetze|beanie/i, kind: "beanie" },
  { pattern: /\bcap\b|kappe/i, kind: "cap" },
  // bags
  { pattern: /bauchtasche/i, kind: "waist_bag" },
  { pattern: /duffel|reisetasche/i, kind: "duffel" },
  { pattern: /rucks[aä]ck|daypack|lawinenrucks[aä]ck/i, kind: "backpack" },
  { pattern: /tasche|packtasche|fahrradtasche|skitasche|skis[aä]ck/i, kind: "bag" },
  { pattern: /skateboard/i, kind: "skateboard" },
  // city / mode apparel
  { pattern: /\bhemd|\bhemden\b|bluse/i, kind: "hemd" },
  { pattern: /pullover|sweat|hoodie|midlayer|mid layer/i, kind: "pullover" },
  { pattern: /t-shirt|tshirt|\bshirt|\bshirts\b|polo|topologie/i, kind: "tshirt" },
  { pattern: /\bweste\b/i, kind: "vest" },
  { pattern: /\bhosen\b|city.*hose/i, kind: "trousers" },
  { pattern: /short/i, kind: "shorts" },
  { pattern: /jacke|bekleidung|triko|bodywarmer/i, kind: "apparel" },
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
