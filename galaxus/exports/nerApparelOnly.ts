/**
 * NER (French sport shop) on Galaxus: clothing + shoes, plus bags, eyewear and watch straps.
 * Titles are French (some EN/ES); many shoe titles are model-only ("Veja V-90"),
 * so a shoe size is enough unless the title names bike / outdoor gear.
 * Kill switch: GALAXUS_NER_APPAREL_ONLY=0.
 */

const SHOE_TEXT_RE =
  /\b(chaussures?|baskets?|sneakers?|bottes?|bottines?|boots?|sandales?|tongs?|claquettes?|mules?|sabots?|chaussons?|espadrilles|mocassins?|derbies|ballerines?|shoes?|trainers?|slides?|clogs?|samba|gazelle|superstar|campus|dunk|air max|air force|jordan|yeezy|new balance|gel-\w+|ultraboost|spezial|handball|forum|stan smith|old skool|chuck taylor|crocs)\b/i;

const APPAREL_TEXT_RE =
  /\b(maillots?|cuissards?|vestes?|gilets?|doudounes?|pantalons?|shorts?|collants?|t-?shirts?|tee-?shirts?|tees?|d[ée]bardeurs?|tops?|sweats?|sweat-?shirts?|hoodies?|pulls?|pullovers?|polaires?|softshell|hardshell|coupe-?vent|jupes?|jupe-?short|robes?|brassi[eè]res?|soutiens?-?gorge|culottes?|boxers?|cale[çc]ons?|slips?|strings?|chaussettes|socquettes|socks?|manchettes|jambi[eè]res|sous-?v[eê]tements?|parkas?|anoraks?|combinaisons?|blousons?|chemises?|polos?|leggings?|tights|baselayer|base layer|casquettes?|caps?|bonnets?|beanies?|gants|gloves?|moufles|tour de cou|cache-?cou|bandeaux?|bandanas?|cagoules?|jammers?|bikinis?|trifonctions?|surv[eê]tements?|jogging|joggers?|cargo|jeans?|chinos?|kimonos?|ponchos?|v[eê]tements?|jacket|jackets|pants|trousers|shirts?|sweater|fleece|vest|bra|bodysuit|onesie|pyjamas?|peignoirs?|chapeaux?|bobs?|visi[eè]res?)\b|^haut\b/i;

const GEAR_TEXT_RE =
  /\b(cha[iî]nes?|plateaux?|selles?|bo[iî]tiers?|p[ée]dal\w*|tiges?|roues?|pneus?|cassettes?|disques?|rotors?|guidons?|potences?|cintres?|cadres?|fourches?|rayons?|jantes?|moyeux?|c[aâ]bles?|gaines?|plaquettes?|casques?|lunettes?|masques?|sacs?|sacoches?|bidons?|gourdes?|pompes?|outils?|kits?|adaptateurs?|roulements?|amortisseurs?|d[ée]railleurs?|manettes?|leviers?|freins?|[ée]triers?|chambres?|valves?|spray|imperm[ée]abilisant|rechange|lessive|nettoyant|b[aâ]tons?|genouill[eè]res?|coudi[eè]res?|prot[eè]ges?|dorsale|sabots? (?:de )?protection|montres?|entretoises?|flasques?|inflator|cartouches?|pr[ée]sentoirs?|home trainers?|tapis|sangles?|trousses?|r[ée]troviseurs?|brosses?|stickers?|autocollants?|paniers?|tables?|shoe shields|gilets? (?:de |d')?(?:protection|hydratation)|coques?|films?|extracteurs?|tente|matelas|r[ée]chaud|lampe|[ée]clairage|compteur|support|antivol|porte|skis?|fixations?|raquettes?|ballons?|poign[ée]es?|grips?(?! sneakers)|d[ée]monte|patins?|cales|boyau|tubeless|housses?)\b|visi[eè]re (?:magn|de rechange)|\b(troy lee|leatt|kini|kask|o'neal)\b.*visi[eè]re/i;

/** Spare parts / accessories for another product: always gear, wherever the noun sits. */
const PART_FOR_RE =
  /\bpour (?:casques?|outils?|masques?|porte-?bagages?|lampes?|frontales?|tikk\w*|v[ée]los?|guidons?|selles?)\b|\bde (?:rechange|remplacement)\b|\br[ée]paration\b|\bfilets?\b/i;

/** Fashion-adjacent accessories kept when they are the product noun (bags, sunglasses/lenses/goggles, watch straps). */
const ACCESSORY_KEEP_RE =
  /\b(sacs?(?! (?:de (?:couchage|cadre|selle|guidon|top ?tube|potence)|(?:de )?porte-?bagages?))|duffel|(?:sacs?|ceintures?) banane|trousses? de toilette|lunettes?|masques?|verres? de (?:remplacement|rechange)|[ée]crans? de (?:remplacement|rechange)|bracelets?)\b/i;
const BIKE_ACCESSORY_RE = /\bpour (?:v[ée]los?|vtt|roues?|cadres?|guidons?|selles?|porte-?bagages?)\b/i;

/** Jersey + pant bundles sold as "Kit Maillot …". */
const APPAREL_KIT_RE = /^kit (?:maillot|tenue)/i;

const SHOE_SIZE_RE = /^(?:EU\s*)?(1[6-9]|[2-4]\d|5[0-2])(?:[.,]5)?(?:\s?[123]\/3|\s?[⅓⅔])?$|^(?:US|UK)\s*\d/i;

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
  const size = String(input.sizeRaw ?? "").trim();
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
  return SHOE_SIZE_RE.test(size);
}
