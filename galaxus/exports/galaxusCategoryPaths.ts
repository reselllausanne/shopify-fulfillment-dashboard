/**
 * Galaxus product kind → German merchant category path.
 * Paths sourced from Producttypes.xlsx (Partner Portal export).
 */
export type GalaxusProductKind =
  | "sneakers"
  | "slippers"
  | "boots"
  | "halbschuhe"
  | "hiking_boots"
  | "sandals"
  | "flip_flops"
  | "shorts"
  | "apparel"
  | "phone"
  | "backpack"
  | "bag"
  | "duffel"
  | "waist_bag"
  | "pool_robot"
  | "camera"
  | "tumbler"
  | "watch"
  | "lego"
  | "tradingcard"
  | "boardgame"
  | "cardgame"
  | "rpg"
  | "miniature"
  | "game_accessory"
  | "dice"
  | "playmat"
  | "puzzle"
  | "cap"
  | "hat"
  | "beanie"
  | "headband"
  | "socks"
  | "sport_socks"
  | "trousers"
  | "underwear"
  | "sticker"
  | "skateboard"
  | "charger"
  | "headphone"
  | "console"
  | "controller"
  | "coin"
  | "ski"
  | "langlauf_ski"
  | "ski_boots"
  | "langlauf_boots"
  | "ski_poles"
  | "hiking_poles"
  | "ski_binding"
  | "ski_goggles"
  | "ski_helmet"
  | "ski_jacket"
  | "langlauf_jacket"
  | "ski_pants"
  | "langlauf_pants"
  | "ski_gloves"
  | "snowboard"
  | "snowboard_boots"
  | "snowboard_binding"
  | "sunglasses"
  | "running_shoes"
  | "trail_shoes"
  | "climbing_shoes"
  | "outdoor_jacket"
  | "rain_jacket"
  | "winter_jacket"
  | "running_jacket"
  | "bike_jacket"
  | "outdoor_pants"
  | "bike_pants"
  | "outdoor_shirt"
  | "functional_shirt"
  | "pullover"
  | "tshirt"
  | "hemd"
  | "vest"
  | "base_layer_top"
  | "base_layer_bottom"
  | "gaiters"
  | "sport_bra"
  | "ski_mask"
  | "ski_wax"
  | "ski_tools"
  | "unknown";

/** German Galaxus merchant `ProductCategory` paths (Producttypes.xlsx). */
export const GALAXUS_CATEGORY_PATHS: Record<GalaxusProductKind, string> = {
  sneakers: "Mode > Alles in Mode > Schuhe > Sneakers",
  slippers: "Mode > Alles in Mode > Schuhe > Hausschuhe",
  boots: "Mode > Alles in Mode > Schuhe > Boots + Stiefel",
  halbschuhe: "Mode > Alles in Mode > Schuhe > Halbschuhe",
  hiking_boots: "Sport > Outdoor > Wandern > Wanderschuhe",
  sandals: "Mode > Alles in Mode > Schuhe > Sandalen",
  flip_flops: "Mode > Alles in Mode > Schuhe > Flip-Flops",
  shorts: "Mode > Alles in Mode > Bekleidung > Shorts",
  apparel: "Mode > Alles in Mode > Bekleidung",
  backpack: "Sport > Taschen + Gepäck > Rucksack",
  bag: "Sport > Taschen + Gepäck > Tasche",
  duffel: "Sport > Taschen + Gepäck > Tasche",
  waist_bag: "Sport > Taschen + Gepäck > Bauchtasche",
  phone: "IT + Multimedia > Smartphones + Tablets > Smartphone Zubehör > Weiteres Smartphone Zubehör",
  pool_robot: "Do it + Garden > Pool + Spa > Pool > Poolroboter",
  camera: "IT + Multimedia > Foto + Video > Kameras",
  tumbler: "Sport + Toys > Wasserflaschen + Thermosflaschen",
  watch: "Mode > Alles in Mode > Uhren",
  lego: "Sport + Toys > LEGO",
  tradingcard: "Sport + Toys > Sammelkarten",
  boardgame: "Sport + Toys > Brettspiele",
  cardgame: "Sport + Toys > Kartenspiele",
  rpg: "Sport + Toys > Rollenspiele",
  miniature: "Sport + Toys > Tabletop",
  game_accessory: "Sport + Toys > Spielzubehör",
  dice: "Sport + Toys > Würfel",
  playmat: "Sport + Toys > Spielzubehör",
  puzzle: "Sport + Toys > Puzzle",
  cap: "Mode > Alles in Mode > Accessoires > Hüte + Caps > Cap",
  hat: "Mode > Alles in Mode > Accessoires > Hüte + Caps > Hut",
  beanie: "Mode > Alles in Mode > Accessoires > Hüte + Caps > Mütze",
  headband: "Mode > Alles in Mode > Accessoires > Hüte + Caps > Stirnband",
  socks: "Mode > Alles in Mode > Wäsche > Socken",
  sport_socks: "Sport > Fitness > Fitnessbekleidung > Sportsocken",
  trousers: "Mode > Alles in Mode > Bekleidung > Hosen",
  underwear: "Mode > Alles in Mode > Wäsche > Unterhosen",
  sticker: "Office + Gaming > Bürobedarf + Schule > Etiketten + Aufkleber",
  skateboard: "Sport + Toys > Skateboarding > Decks",
  charger: "IT + Multimedia > Zubehör > Ladegeräte",
  headphone: "IT + Multimedia > Audio > Kopfhörer",
  console: "IT + Multimedia > Gaming > Konsolen",
  controller: "IT + Multimedia > Gaming > Zubehör > Controller",
  coin: "Sammeln + Antiquitäten > Münzen",
  ski: "Sport > Wintersport > Skifahren + Langlauf > Ski",
  langlauf_ski: "Sport > Wintersport > Skifahren + Langlauf > Langlaufski",
  ski_boots: "Sport > Wintersport > Skifahren + Langlauf > Skischuhe",
  langlauf_boots: "Sport > Wintersport > Skifahren + Langlauf > Langlaufschuhe",
  ski_poles: "Sport > Wintersport > Skifahren + Langlauf > Skistöcke",
  hiking_poles: "Sport > Outdoor > Wandern > Wanderstöcke",
  ski_binding: "Sport > Wintersport > Skifahren + Langlauf > Skibindung",
  ski_goggles: "Sport > Wintersport > Wintersport Schutzausrüstung > Skibrille",
  ski_helmet: "Sport > Wintersport > Wintersport Schutzausrüstung > Skihelm",
  ski_jacket: "Sport > Wintersport > Wintersportbekleidung > Skijacke",
  langlauf_jacket: "Sport > Wintersport > Wintersportbekleidung > Langlaufjacke",
  ski_pants: "Sport > Wintersport > Wintersportbekleidung > Skihosen",
  langlauf_pants: "Sport > Wintersport > Wintersportbekleidung > Langlaufhose",
  ski_gloves: "Sport > Wintersport > Wintersportbekleidung > Skihosen",
  snowboard: "Sport > Wintersport > Snowboarden > Snowboard",
  snowboard_boots: "Sport > Wintersport > Snowboarden > Snowboardschuhe",
  snowboard_binding: "Sport > Wintersport > Snowboarden > Snowboardbindung",
  sunglasses: "Mode > Alles in Mode > Accessoires > Sonnenbrille",
  running_shoes: "Sport > Running > Laufschuhe",
  trail_shoes: "Sport > Running > Laufschuhe",
  climbing_shoes: "Sport > Outdoor > Outdoorschuhe > Kletterschuhe",
  outdoor_jacket: "Sport > Outdoor > Outdoorbekleidung > Outdoorjacken",
  rain_jacket: "Mode > Alles in Mode > Bekleidung > Jacken > Regenjacken",
  winter_jacket: "Mode > Alles in Mode > Bekleidung > Jacken > Winterjacken",
  running_jacket: "Sport > Running > Runningbekleidung > Laufjacke",
  bike_jacket: "Sport > Bike > Velobekleidung > Velojacke",
  outdoor_pants: "Sport > Outdoor > Outdoorbekleidung > Outdoorhose",
  bike_pants: "Sport > Bike > Velobekleidung > Velohosen",
  outdoor_shirt: "Sport > Outdoor > Outdoorbekleidung > Sportshirt",
  functional_shirt: "Sport > Outdoor > Outdoorbekleidung > Funktionsshirt",
  pullover: "Mode > Alles in Mode > Bekleidung > Pullover",
  tshirt: "Mode > Alles in Mode > Bekleidung > Shirts",
  hemd: "Mode > Alles in Mode > Bekleidung > Hemden",
  vest: "Mode > Alles in Mode > Bekleidung > Jacken > Westen",
  base_layer_top: "Sport > Outdoor > Outdoorbekleidung > Funktionsshirt",
  base_layer_bottom: "Sport > Outdoor > Outdoorbekleidung > Funktionsunterhose",
  gaiters: "Sport > Outdoor > Outdoorbekleidung > Gamaschen",
  sport_bra: "Sport > Fitness > Yoga + Pilates > Sport-BH",
  ski_mask: "Sport > Wintersport > Wintersport Schutzausrüstung > Sturmhaube + Halsschlauch",
  ski_wax: "Sport > Wintersport > Skifahren + Langlauf > Skiwachs",
  ski_tools: "Sport > Wintersport > Skifahren + Langlauf > Skiwerkzeug",
  unknown: "Mode > Alles in Mode > Schuhe > Sneakers",
};

/** Default kind when no signal matches — supplier-aware. */
export function defaultGalaxusProductKind(supplierKey?: string | null): GalaxusProductKind {
  if (String(supplierKey ?? "").toLowerCase() === "wel") return "boardgame";
  return "sneakers";
}

export function galaxusCategoryPathForKind(
  kind: GalaxusProductKind,
  supplierKey?: string | null
): string {
  if (kind === "unknown") {
    return GALAXUS_CATEGORY_PATHS[defaultGalaxusProductKind(supplierKey)];
  }
  return GALAXUS_CATEGORY_PATHS[kind] ?? GALAXUS_CATEGORY_PATHS.unknown;
}
