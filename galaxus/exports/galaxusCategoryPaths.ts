/**
 * Galaxus product kind → German merchant category path.
 * See GALAXUS_CATEGORY_PATHS for path strings.
 */
export type GalaxusProductKind =
  | "sneakers"
  | "slippers"
  | "boots"
  | "sandals"
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

/**
 * German Galaxus merchant `ProductCategory` paths.
 *
 * Source: same tree as existing live STX/NER exports (Mode > …, Sport + Toys > …,
 * Office + Gaming > …). WEL + UGG paths follow Galaxus sector naming
 * (galaxus.ch producttype slugs: brettspiele-3878, board-games, etc.).
 *
 * Re-verify against Partner Portal → Product type export before major catalog pushes.
 */
export const GALAXUS_CATEGORY_PATHS: Record<GalaxusProductKind, string> = {
  sneakers: "Mode > Alles in Mode > Schuhe > Sneakers",
  slippers: "Mode > Alles in Mode > Schuhe > Hausschuhe",
  boots: "Mode > Alles in Mode > Schuhe > Stiefel",
  sandals: "Mode > Alles in Mode > Schuhe > Sandalen",
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
  boardgame: "Sport + Toys > Brettspiele",
  cardgame: "Sport + Toys > Kartenspiele",
  rpg: "Sport + Toys > Rollenspiele",
  miniature: "Sport + Toys > Tabletop",
  game_accessory: "Sport + Toys > Spielzubehör",
  dice: "Sport + Toys > Würfel",
  playmat: "Sport + Toys > Spielzubehör",
  puzzle: "Sport + Toys > Puzzle",
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
