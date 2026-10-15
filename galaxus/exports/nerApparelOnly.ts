/**
 * NER (French sport shop) on Galaxus: clothing + shoes only.
 * Titles are French (some EN/ES); many shoe titles are model-only ("Veja V-90"),
 * so a shoe size is enough unless the title names bike / outdoor gear.
 * Kill switch: GALAXUS_NER_APPAREL_ONLY=0.
 */

const SHOE_TEXT_RE =
  /\b(chaussures?|baskets?|sneakers?|bottes?|bottines?|boots?|sandales?|tongs?|claquettes?|mules?|sabots?|chaussons?|espadrilles|mocassins?|derbies|ballerines?|shoes?|trainers?|slides?|clogs?|samba|gazelle|superstar|campus|dunk|air max|air force|jordan|yeezy|new balance|gel-\w+|ultraboost|spezial|handball|forum|stan smith|old skool|chuck taylor|crocs)\b/i;

const APPAREL_TEXT_RE =
  /\b(maillots?|cuissards?|vestes?|gilets?|doudounes?|pantalons?|shorts?|collants?|t-?shirts?|tee-?shirts?|tees?|d[ée]bardeurs?|tops?|sweats?|sweat-?shirts?|hoodies?|pulls?|pullovers?|polaires?|softshell|hardshell|coupe-?vent|jupes?|jupe-?short|robes?|brassi[eè]res?|soutiens?-?gorge|culottes?|boxers?|cale[çc]ons?|slips?|strings?|chaussettes|socquettes|socks?|manchettes|jambi[eè]res|sous-?v[eê]tements?|parkas?|anoraks?|combinaisons?|blousons?|chemises?|polos?|leggings?|tights|baselayer|base layer|casquettes?|caps?|bonnets?|beanies?|gants|gloves?|moufles|tour de cou|cache-?cou|bandeaux?|bandanas?|cagoules?|jammers?|bikinis?|trifonctions?|surv[eê]tements?|jogging|joggers?|cargo|jeans?|chinos?|kimonos?|ponchos?|v[eê]tements?|jacket|jackets|pants|trousers|shirts?|sweater|fleece|vest|bra|bodysuit|onesie|pyjamas?|peignoirs?|chapeaux?|bobs?|visi[eè]res?)\b|^haut\b/i;

const GEAR_TEXT_RE =
  /\b(cha[iî]nes?|plateaux?|selles?|bo[iî]tiers?|p[ée]dal\w*|tiges?|roues?|pneus?|cassettes?|disques?|rotors?|guidons?|potences?|cintres?|cadres?|fourches?|rayons?|jantes?|moyeux?|c[aâ]bles?|gaines?|plaquettes?|casques?|lunettes?|masques?|sacs?|sacoches?|bidons?|gourdes?|pompes?|outils?|kits?|adaptateurs?|roulements?|amortisseurs?|d[ée]railleurs?|manettes?|leviers?|freins?|[ée]triers?|chambres?|valves?|spray|imperm[ée]abilisant|rechange|lessive|nettoyant|b[aâ]tons?|genouill[eè]res?|coudi[eè]res?|prot[eè]ge|dorsale|tente|matelas|r[ée]chaud|lampe|[ée]clairage|compteur|support|antivol|porte|skis?|fixations?|raquettes?|ballons?|poign[ée]es?|grips?|patins?|cales|boyau|tubeless|housses?)\b|visi[eè]re (?:magn|de rechange)|\b(troy lee|leatt|kini|kask|o'neal)\b.*visi[eè]re/i;

/** Clothing words that override a gear word in the same title (e.g. "Gants VTT", "Maillot vélo"). */
const APPAREL_OVERRIDES_GEAR_RE = /\b(gants|casquettes?|maillots?|vestes?|chaussettes|t-?shirts?)\b/i;

const SHOE_SIZE_RE = /^(?:EU\s*)?(1[6-9]|[2-4]\d|5[0-2])(?:[.,]5)?(?:\s?[123]\/3|\s?[⅓⅔])?$|^(?:US|UK)\s*\d/i;

export function isGalaxusNerApparelOnlyEnabled(): boolean {
  return String(process.env.GALAXUS_NER_APPAREL_ONLY ?? "").trim() !== "0";
}

export function isNerApparelOrShoe(input: { title?: string | null; sizeRaw?: string | null }): boolean {
  const title = String(input.title ?? "");
  const size = String(input.sizeRaw ?? "").trim();
  const shoeText = SHOE_TEXT_RE.test(title);
  if (GEAR_TEXT_RE.test(title) && !shoeText && !APPAREL_OVERRIDES_GEAR_RE.test(title)) return false;
  if (shoeText) return true;
  if (APPAREL_TEXT_RE.test(title)) return true;
  return SHOE_SIZE_RE.test(size);
}
