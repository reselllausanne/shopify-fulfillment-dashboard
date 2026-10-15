import type { GalaxusProductKind } from "@/galaxus/exports/galaxusCategoryPaths";

/**
 * NER (French sport shop) titles lead with a French product noun ("Maillot Manches Courtes …",
 * "Cuissard Court …", "Paire de Chaussettes …"); the English regexes in productClassification
 * miss them, which sent jerseys and bib shorts to the Sneakers default.
 * Targets the leaves on Galaxus's fashion list (Velotrikot, Velohosen, Outdoorjacken, …).
 */

type NerRule = { pattern: RegExp; kind: GalaxusProductKind | ((title: string) => GalaxusProductKind) };

const BIKE_RE = /\b(v[ée]lo|vtt|cyclisme|gravel|route|bib|enduro|mtb|bmx)\b/i;
const RAIN_RE = /\b(imperm[ée]able|pluie|coupe-?pluie|gore-?tex|hardshell|rain)\b/i;
const WIND_RE = /\b(coupe-?vent|windbreaker|wind)\b/i;
const INSULATED_RE = /\b(doudoune|isol[ée]e|synth[ée]tique|down|puffer|primaloft|thermo)\b/i;
const SLEEVELESS_RE = /\bsans manches\b/i;
const RUNNING_RE = /\b(running|run|course|trail|marathon)\b/i;
const SKI_RE = /\b(ski|snowboard|freeride)\b/i;
const MEN_RE = /\b(homme|men|garçon|boy)\b/i;

function jacketKind(title: string): GalaxusProductKind {
  if (SLEEVELESS_RE.test(title)) return "vest";
  if (SKI_RE.test(title)) return "ski_jacket";
  if (INSULATED_RE.test(title)) return "winter_jacket";
  if (BIKE_RE.test(title)) return "bike_jacket";
  if (RAIN_RE.test(title)) return "rain_jacket";
  if (RUNNING_RE.test(title)) return "running_jacket";
  if (WIND_RE.test(title)) return "light_jacket";
  return "outdoor_jacket";
}

function pantsKind(title: string): GalaxusProductKind {
  if (BIKE_RE.test(title)) return "bike_pants";
  if (SKI_RE.test(title)) return "ski_pants";
  if (/\b(jeans?|chinos?|cargo|jogging|joggers?|surv[eê]tement)\b/i.test(title)) return "trousers";
  return "outdoor_pants";
}

function shortsKind(title: string): GalaxusProductKind {
  return BIKE_RE.test(title) ? "bike_pants" : "shorts";
}

function shoeKind(title: string): GalaxusProductKind {
  if (/\brandonn[ée]e|hiking|approche\b/i.test(title)) return "hiking_boots";
  if (/\btrail\b/i.test(title)) return "trail_shoes";
  if (/\b(running|course)\b/i.test(title)) return "running_shoes";
  if (/\bescalade\b/i.test(title)) return "climbing_shoes";
  return "sneakers";
}

function swimKind(title: string): GalaxusProductKind {
  if (/\b(jammer|slip de bain|boxer de bain|short de bain)\b/i.test(title)) return "swim_trunks";
  return MEN_RE.test(title) ? "swim_trunks" : "swimsuit";
}

/** Order matters on ties: specific multi-word nouns before their generic head noun. */
const NER_RULES: NerRule[] = [
  { pattern: /\b(maillots? de bain|slips? de bain|boxers? de bain|shorts? de bain|jammers?|bikinis?|une pi[eè]ce)\b/i, kind: swimKind },
  { pattern: /\b(sous-?maillots?|maillots? de compression|baselayer|base layer|maillots? technique|haut technique)\b/i, kind: "base_layer_top" },
  { pattern: /\b(combinaisons? trifonction|trifonctions?|trisuit)\b/i, kind: "bike_jersey" },
  { pattern: /\bcuissards?\b/i, kind: "bike_pants" },
  { pattern: /\bcouvre-?\s?chaussures?\b/i, kind: "gaiters" },
  { pattern: /\bmaillots?\b/i, kind: (t) => (/\b(football|domicile|ext[ée]rieur|foot)\b/i.test(t) ? "tshirt" : "bike_jersey") },
  { pattern: /\bdoudounes?\b/i, kind: (t) => (SLEEVELESS_RE.test(t) ? "vest" : "winter_jacket") },
  { pattern: /\b(vestes?|blousons?|parkas?|anoraks?|jackets?|softshell|hardshell)\b/i, kind: jacketKind },
  { pattern: /\bgilets?\b/i, kind: "vest" },
  { pattern: /\b(polaires?|sweats?|sweat-?shirts?|sweatshirts?|hoodies?|pulls?|pullovers?)\b/i, kind: "pullover" },
  { pattern: /\b(brassi[eè]res?|soutiens?-?gorge|sport bra)\b/i, kind: "sport_bra" },
  { pattern: /\b(sous-?v[eê]tements?|cale[çc]ons?|boxers?|slips?|culottes?|strings?)\b/i, kind: "underwear" },
  { pattern: /\b(collants?|leggings?|tights)\b/i, kind: "trousers" },
  { pattern: /\b(pantalons?|pants|trousers|jeans?)\b/i, kind: pantsKind },
  { pattern: /\b(shorts?|jupe-?short)\b/i, kind: shortsKind },
  { pattern: /\b(chemises?)\b/i, kind: "hemd" },
  { pattern: /\b(tee-?shirts?|t-?shirts?|tees?|d[ée]bardeurs?|tops?|polos?|haut)\b/i, kind: "tshirt" },
  { pattern: /\b(jupes?|robes?)\b/i, kind: "dress" },
  { pattern: /\b(chaussettes|socquettes|socks?)\b/i, kind: "sport_socks" },
  { pattern: /\b(gants|moufles|gloves?)\b/i, kind: "gloves" },
  { pattern: /\b(casquettes?|caps?|visi[eè]res?)\b/i, kind: "cap" },
  { pattern: /\b(bonnets?|beanies?)\b/i, kind: "beanie" },
  { pattern: /\b(bandeaux?|headbands?)\b/i, kind: "headband" },
  { pattern: /\b(tours? de cou|cache-?cou|cagoules?|buff)\b/i, kind: "ski_mask" },
  { pattern: /\b(sacs? [àa] dos|backpack)\b/i, kind: "backpack" },
  { pattern: /\b(sacs? banane|ceintures? banane)\b/i, kind: "waist_bag" },
  { pattern: /\b(sacs?|duffel|sacoches?)\b/i, kind: "bag" },
  { pattern: /\blunettes de soleil\b|\blunettes(?! de natation| de ski)\b/i, kind: "sunglasses" },
  { pattern: /\b(sandales?|claquettes?|sandalias)\b/i, kind: "sandals" },
  { pattern: /\btongs?\b/i, kind: "flip_flops" },
  { pattern: /\b(chaussons?|mules?|sabots?)\b/i, kind: "slippers" },
  { pattern: /\b(bottes?|bottines?|boots?)\b/i, kind: "boots" },
  { pattern: /\b(chaussures?|baskets?)\b/i, kind: shoeKind },
];

function firstMatchAt(re: RegExp, text: string): number {
  const m = re.exec(text);
  return m ? m.index : -1;
}

/** Earliest noun in the title wins (NER puts the product noun first); null when nothing matches. */
export function classifyNerGalaxusKind(input: { title?: string | null }): GalaxusProductKind | null {
  const title = String(input.title ?? "").replace(/\s+/g, " ").trim();
  if (!title) return null;
  let best: { at: number; rule: NerRule } | null = null;
  for (const rule of NER_RULES) {
    const at = firstMatchAt(rule.pattern, title);
    if (at < 0) continue;
    if (!best || at < best.at) best = { at, rule };
  }
  if (!best) return null;
  return typeof best.rule.kind === "function" ? best.rule.kind(title) : best.rule.kind;
}
