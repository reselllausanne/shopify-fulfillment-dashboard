/**
 * NER (French sport shop) on Galaxus: clothing + shoes, plus bags, eyewear and watch straps.
 * Titles are French (some EN/ES); many shoe titles are model-only ("Veja V-90"),
 * so a shoe size is enough unless the title names bike / outdoor gear.
 * Kill switch: GALAXUS_NER_APPAREL_ONLY=0.
 */

const SHOE_TEXT_RE =
  /\b(chaussures?|baskets?|sneakers?|bottes?|bottines?|boots?|sandales?|tongs?|claquettes?|mules?|sabots?|chaussons?|espadrilles|mocassins?|derbies|ballerines?|shoes?|trainers?|slides?|clogs?|samba|gazelle|superstar|campus|dunk|air max|air force|jordan|yeezy|new balance|gel-\w+|ultraboost|spezial|handball|forum|stan smith|old skool|chuck taylor|crocs)\b/i;

const APPAREL_TEXT_RE =
  /\b(maillots?|cuissards?|vestes?|gilets?|doudounes?|pantalons?|shorts?|collants?|t-?shirts?|tee-?shirts?|tees?|d[ée]bardeurs?|tops?|sweats?|sweat-?shirts?|hoodies?|pulls?|pullovers?|polaires?|softshell|hardshell|coupe-?vent|jupes?|jupe-?short|robes?|brassi[eè]res?|soutiens?-?gorge|culottes?|boxers?|cale[çc]ons?|slips?|strings?|chaussettes|socquettes|socks?|manchettes|jambi[eè]res|sous-?v[eê]tements?|parkas?|anoraks?|combinaisons?|blousons?|chemises?|polos?|leggings?|tights|baselayer|base layer|casquettes?|caps?|bonnets?|beanies?|gants|gloves?|moufles|tour de cou|cache-?cou|bandeaux?|bandanas?|cagoules?|jammers?|bikinis?|trifonctions?|surv[eê]tements?|jogging|joggers?|cargo|jeans?|chinos?|kimonos?|ponchos?|v[eê]tements?|jacket|jackets|pants|trousers|shirts?|sweater|fleece|vest|bra|bodysuit|onesie|pyjamas?|peignoirs?|chapeaux?|bobs?|visi[eè]res?|neck warmers?|neck gaiters?|gaiters?|guêtres?|overshoes|pant|bib ?tights?|bib ?shorts?|trikots?|jerseys?|snapbacks?|trucker|hats?|headbands?|czapka|flexi chute|ceramiwarm|suunto (?:athletic|ath\d)|watch bands?|wb loop|silicone straps?|(?:loop|textile|nylon) straps?)\b|^haut\b/i;

const GEAR_TEXT_RE =
  /\b(cha[iî]nes?|plateaux?|selles?|bo[iî]tiers?|p[ée]dal\w*|tiges?|roues?|pneus?|cassettes?|disques?|rotors?|guidons?|potences?|cintres?|cadres?|fourches?|rayons?|jantes?|moyeux?|c[aâ]bles?|gaines?|plaquettes?|casques?|lunettes?|masques?|sacs?|sacoches?|bidons?|gourdes?|pompes?|outils?|kits?|adaptateurs?|roulements?|amortisseurs?|d[ée]railleurs?|manettes?|leviers?|freins?|[ée]triers?|chambres?|valves?|spray|imperm[ée]abilisant|rechange|lessive|nettoyant|b[aâ]tons?|genouill[eè]res?|coudi[eè]res?|prot[eè]ges?|dorsale|sabots? (?:de )?protection|montres?|entretoises?|flasques?|inflator|cartouches?|pr[ée]sentoirs?|home trainers?|tapis|sangles?|trousses?|r[ée]troviseurs?|brosses?|stickers?|autocollants?|paniers?|tables?|shoe shields|gilets? (?:de |d')?(?:protection|hydratation)|coques?|films?|extracteurs?|tente|matelas|r[ée]chaud|lampe|[ée]clairage|compteur|support|antivol|porte|skis?|fixations?|raquettes?|ballons?|poign[ée]es?|grips?(?! sneakers)|d[ée]monte|patins?|cales|boyau|tubeless|housses?)\b|visi[eè]re (?:magn|de rechange)|\b(troy lee|leatt|kini|kask|o'neal)\b.*visi[eè]re/i;

/** Spare parts / accessories for another product: always gear, wherever the noun sits. */
const PART_FOR_RE =
  /\bpour (?:casques?|outils?|masques?|porte-?bagages?|lampes?|frontales?|tikk\w*|v[ée]los?|guidons?|selles?)\b|\bde (?:rechange|remplacement)\b|\br[ée]paration\b|\bfilets?\b/i;

/** Fashion-adjacent accessories kept when they are the product noun (bags, sunglasses/lenses/goggles, watch straps). */
const ACCESSORY_KEEP_RE =
  /\b(brillen?|schwimmbrillen?|fahrradbrillen?|julbo|azr|oakley|uvex sportstyle|backpacks?|rucksacks?|duffl?e(?:l)? ?(?:bags?)?|duffel|(?:waist|hip|belt|bum) ?(?:bags?|packs?)|sunglasses|glasses|goggles|replacement lenses|sacs?(?! (?:de (?:couchage|cadre|selle|guidon|top ?tube|potence)|(?:de )?porte-?bagages?))|duffel|(?:sacs?|ceintures?) banane|trousses? de toilette|lunettes?|masques?|verres? de (?:remplacement|rechange)|[ée]crans? de (?:remplacement|rechange)|bracelets?)\b/i;
const BIKE_ACCESSORY_RE = /\bpour (?:v[ée]los?|vtt|roues?|cadres?|guidons?|selles?|porte-?bagages?)\b/i;

const VOLUME_BAG_RE = /\(\d{2,3}(?:\+\d{2})? ?l\)|\b\d{2,3}(?:\+\d{2})? ?l\b.*\bbag\b|\b(?:duffle|duffel)\b|\bBlack Hole\b/i;
const VOLUME_NOT_BAG_RE = /\b(tentes?|tents?|coolers?|glaci[eè]res?|bidons?|bottles?|bouteilles?|tanks?|r[ée]servoirs?|barrels?|canisters?|cartridges?|boxes|box|bo[iî]tes?|bladder|poche [àa] eau|hydration|reservoir|sleeping|couchage|stoves?|r[ée]chaud|lampes?|lamps?|lights?)\b/i;
const RACK_BAG_RE = /\b(rack|pannier|roller|taschen|luggage|porte-?bagages?|sacoches?|frame bag|saddle bag)\b/i;

/** Jersey + pant bundles sold as "Kit Maillot …". */
const APPAREL_KIT_RE = /^kit (?:maillot|tenue)/i;

/**
 * Off the Tali sheet even when a 16–52 size looks like a shoe, or when "sac" / "bracelet"
 * would otherwise count as a kept accessory. New catalog rows, not only the key blocklist.
 * Sport-watch straps (Garmin, Suunto, "bracelet de montre") stay.
 */
const NER_OFFSHEET_RE =
  /\b((?:face|protective|dust|hygiene) masks?|masques? (?:de protection|hygi[eè]nique)|couronnes?|pignons?|sprockets?|chainrings?|pannier racks?|porte-?v[ée]los?|jeux? de direction|lithium packs?|dry sacks?|sacs? [ée]tanches?|wash bags?|pencil cases?|trousses? de toilette)\b|\bcl[ée]s?\s+allen\b|\ballen\s+keys?\b|\bscrews?\b|\brings?\b|\bbagues?\b|\bcolliers?\b|\bnecklaces?\b|\bearrings?\b|\bpendentifs?\b|\bboucles?\s+d['’]oreilles?\b/i;
const TOWEL_RE = /\b(towels?|serviettes?|handt(?:uch|ücher))\b/i;
const JEWELRY_BRACELET_RE = /\bbracelets?\b/i;
const WATCH_STRAP_RE = /\b(garmin|polar|suunto|coros|wahoo|montres?|watch)\b/i;

/** Clothing sizes (S, M, L, XL, 2XL, "M/L", "32, M"). English NER titles ("Fox Flexair Pant") carry no French noun. */
const APPAREL_SIZE_RE = /(?:^|[\s,/])(?:KID)?(?:[2-5]?X{0,3}[SL]|XS|M)(?=$|[\s,/])/i;
const SHOE_SIZE_RE = /^(?:EU\s*)?(1[6-9]|[2-4]\d|5[0-2])(?:[.,]5)?(?:\s?[123]\/3|\s?[⅓⅔])?$|^(?:US|UK)\s*\d/i;

function isNerOffSheet(title: string): boolean {
  if (NER_OFFSHEET_RE.test(title)) return true;
  // Plain towels are off-sheet; "Towel" as a fabric in a garment title ("Towel short sleeve T-shirt") stays.
  if (TOWEL_RE.test(title) && !APPAREL_TEXT_RE.test(title)) return true;
  return JEWELRY_BRACELET_RE.test(title) && !WATCH_STRAP_RE.test(title);
}

export function isGalaxusNerApparelOnlyEnabled(): boolean {
  return String(process.env.GALAXUS_NER_APPAREL_ONLY ?? "").trim() !== "0";
}

function firstMatchAt(re: RegExp, text: string): number {
  const m = re.exec(text);
  return m ? m.index : -1;
}

/**
 * The product noun comes first in NER titles ("Selle … Slide Control", "Chaussures Pédales Plates"),
 * so whichever of gear vs. clothing/shoe wording appears first decides; ties go to gear.
 */
export function isNerApparelOrShoe(input: { title?: string | null; sizeRaw?: string | null }): boolean {
  const title = String(input.title ?? "");
  // NER shoe sizes carry a French-sizing suffix ("38FR").
  const size = String(input.sizeRaw ?? "").trim().replace(/\s?FR$/i, "");
  if (isNerOffSheet(title)) return false;
  // Rucksacks named only by brand + volume ("The North Face Base Camp (50 l)"); rack/pannier bags stay off.
  if (
    VOLUME_BAG_RE.test(title) &&
    !RACK_BAG_RE.test(title) &&
    !BIKE_ACCESSORY_RE.test(title) &&
    !VOLUME_NOT_BAG_RE.test(title) &&
    firstMatchAt(GEAR_TEXT_RE, title) < 0
  ) {
    return true;
  }
  const gearAt = firstMatchAt(GEAR_TEXT_RE, title);
  const wearHits = [firstMatchAt(SHOE_TEXT_RE, title), firstMatchAt(APPAREL_TEXT_RE, title)].filter((i) => i >= 0);
  const wearAt = wearHits.length ? Math.min(...wearHits) : -1;
  const accessoryAt = firstMatchAt(ACCESSORY_KEEP_RE, title);
  if (
    accessoryAt >= 0 &&
    (gearAt < 0 || accessoryAt <= gearAt) &&
    (wearAt < 0 || accessoryAt <= wearAt) &&
    !BIKE_ACCESSORY_RE.test(title)
  ) {
    return true;
  }
  if (PART_FOR_RE.test(title)) return false;
  if (gearAt >= 0 && (wearAt < 0 || gearAt <= wearAt) && !APPAREL_KIT_RE.test(title)) return false;
  if (wearAt >= 0) return true;
  return SHOE_SIZE_RE.test(size) || APPAREL_SIZE_RE.test(size);
}
