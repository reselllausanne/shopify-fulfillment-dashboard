/**
 * Baby-Walz parcel class vs Swiss Post domestic limits.
 *
 * Standard PostPac: fits 100 × 60 × 60 cm, ≤30 kg.
 * Bulky: longest ≤200 cm and girth (longest + 2×(other two)) ≤400 cm, ≤30 kg.
 * Long bulky (200–250 cm) only if weight known and ≤10 kg.
 *
 * Ship add (CHF, baked into Galaxus BWZ formula as shipping, not a second margin):
 * - standard ≤10 kg or weight unknown: 12
 * - standard >10 kg: 21
 * - bulky that still fits Post: 30
 * Missing structured dims → description text (Maße / Klappmaß / Gewicht) → category estimate.
 * Still unknown → caller keeps default ship CHF 2 (small goods: clothes, care, food).
 */

export const BWZ_POST_STANDARD_MAX_CM = { length: 100, mid: 60, short: 60 } as const;
export const BWZ_POST_BULKY_MAX_LENGTH_CM = 200;
export const BWZ_POST_BULKY_MAX_GIRTH_CM = 400;
export const BWZ_POST_LONG_MAX_LENGTH_CM = 250;
export const BWZ_POST_LONG_MAX_KG = 10;
export const BWZ_POST_MAX_KG = 30;

export const BWZ_SHIP_STANDARD_CHF = 12;
export const BWZ_SHIP_STANDARD_HEAVY_CHF = 21;
export const BWZ_SHIP_BULKY_CHF = 30;

export type BwzParcelClass = "standard" | "bulky" | "unshippable" | "unknown";
export type BwzParcelSource = "attrs" | "description" | "category";

export type BwzParcelAssessment = {
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  weightKg: number | null;
  longestCm: number | null;
  girthCm: number | null;
  parcelClass: BwzParcelClass;
  /** Null when unknown or unshippable. */
  shipChf: number | null;
  /** Where dims/class came from; absent when unknown. */
  source?: BwzParcelSource;
};

export function parseBwzCm(raw: string | null | undefined): number | null {
  const s = String(raw ?? "")
    .trim()
    .replace(",", ".");
  const m = s.match(/(\d+(?:\.\d+)?)\s*cm/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseBwzKg(raw: string | null | undefined): number | null {
  const s = String(raw ?? "")
    .trim()
    .replace(",", ".");
  const m = s.match(/(\d+(?:\.\d+)?)\s*kg/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function unknownBwzParcel(): BwzParcelAssessment {
  return {
    lengthCm: null,
    widthCm: null,
    heightCm: null,
    weightKg: null,
    longestCm: null,
    girthCm: null,
    parcelClass: "unknown",
    shipChf: null,
  };
}

export function classifyBwzParcel(input: {
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  weightKg: number | null;
}): BwzParcelAssessment {
  const lengthCm = finitePositive(input.lengthCm);
  const widthCm = finitePositive(input.widthCm);
  const heightCm = finitePositive(input.heightCm);
  const weightKg = finitePositive(input.weightKg);

  if (lengthCm == null || widthCm == null || heightCm == null) {
    return {
      ...unknownBwzParcel(),
      lengthCm,
      widthCm,
      heightCm,
      weightKg,
    };
  }

  const [longest, mid, short] = [lengthCm, widthCm, heightCm].sort((a, b) => b - a);
  const girthCm = longest + 2 * (mid + short);
  const base = { lengthCm, widthCm, heightCm, weightKg, longestCm: longest, girthCm };

  if (weightKg != null && weightKg > BWZ_POST_MAX_KG) {
    return { ...base, parcelClass: "unshippable", shipChf: null };
  }

  const fitsStandard =
    longest <= BWZ_POST_STANDARD_MAX_CM.length &&
    mid <= BWZ_POST_STANDARD_MAX_CM.mid &&
    short <= BWZ_POST_STANDARD_MAX_CM.short;

  if (fitsStandard) {
    const heavy = weightKg != null && weightKg > 10;
    return {
      ...base,
      parcelClass: "standard",
      shipChf: heavy ? BWZ_SHIP_STANDARD_HEAVY_CHF : BWZ_SHIP_STANDARD_CHF,
    };
  }

  const fitsBulky =
    longest <= BWZ_POST_BULKY_MAX_LENGTH_CM && girthCm <= BWZ_POST_BULKY_MAX_GIRTH_CM;
  if (fitsBulky) {
    return { ...base, parcelClass: "bulky", shipChf: BWZ_SHIP_BULKY_CHF };
  }

  const fitsLong =
    longest <= BWZ_POST_LONG_MAX_LENGTH_CM &&
    girthCm <= BWZ_POST_BULKY_MAX_GIRTH_CM &&
    weightKg != null &&
    weightKg <= BWZ_POST_LONG_MAX_KG;
  if (fitsLong) {
    return { ...base, parcelClass: "bulky", shipChf: BWZ_SHIP_BULKY_CHF };
  }

  return { ...base, parcelClass: "unshippable", shipChf: null };
}

type DimsTriple = { lengthCm: number; widthCm: number; heightCm: number };

const DIM_NUM = String.raw`(\d+(?:[.,]\d+)?)`;
const DIM_TAG = String.raw`\s*(?:\([A-Za-z]\))?\s*`;
const DIM_RE = new RegExp(
  `${DIM_NUM}${DIM_TAG}[x×]\\s*${DIM_NUM}${DIM_TAG}[x×]\\s*${DIM_NUM}${DIM_TAG}(cm|mm)\\b`,
  "i"
);

function dimsLinePriority(line: string): number {
  if (/verpack|packma|paketma|karton/i.test(line)) return 3;
  if (/klappma|faltma|zusammengeklappt|zusammengefaltet|gefaltet/i.test(line)) return 2;
  if (/ma(?:ß|ss)e|abmessung|aufbauma|gr(?:ö|oe)(?:ß|ss)e/i.test(line)) return 1;
  return 0;
}

function decodeBasicEntities(s: string): string {
  return s
    .replace(/&szlig;/g, "ß")
    .replace(/&auml;/g, "ä")
    .replace(/&ouml;/g, "ö")
    .replace(/&uuml;/g, "ü")
    .replace(/&Auml;/g, "Ä")
    .replace(/&Ouml;/g, "Ö")
    .replace(/&Uuml;/g, "Ü")
    .replace(/&times;/g, "×")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** Plain-text lines of the rendered product page (Nuxt JSON script dropped). */
export function bwzDescriptionLines(html: string): string[] {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(li|p|div|tr|h\d)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeBasicEntities(body)
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/**
 * Dims + weight from the Walz description list (e.g. "Klappmaß: 67,5(L) x 61,5(B) x 47,5(H) cm",
 * "Gewicht: Kinderwagen mit Tragewanne 15,6 kg, …"). Packaging &gt; folded &gt; generic Maße line.
 */
export function parseBwzDescriptionParcel(html: string): BwzParcelAssessment | null {
  const lines = bwzDescriptionLines(html);
  let best: { dims: DimsTriple; priority: number } | null = null;
  let weightKg: number | null = null;

  for (const line of lines) {
    if (line.length > 400) continue;
    const priority = dimsLinePriority(line);
    if (priority > 0) {
      const m = line.match(DIM_RE);
      if (m) {
        const div = m[4].toLowerCase() === "mm" ? 10 : 1;
        const nums = [m[1], m[2], m[3]].map((x) => Number(x.replace(",", ".")) / div);
        if (nums.every((n) => Number.isFinite(n) && n > 0) && (!best || priority > best.priority)) {
          best = {
            dims: { lengthCm: nums[0], widthCm: nums[1], heightCm: nums[2] },
            priority,
          };
        }
      }
    }
    if (/^(?:netto-?|gesamt-?|produkt-?)?gewicht\b/i.test(line) && !/belastbar|h(?:ö|oe)chst|maximal/i.test(line)) {
      const kgs = [...line.matchAll(/(\d+(?:[.,]\d+)?)\s*kg\b/gi)]
        .map((k) => Number(k[1].replace(",", ".")))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (kgs.length) weightKg = Math.max(weightKg ?? 0, ...kgs);
    }
  }

  if (!best) return null;
  const parcel = classifyBwzParcel({ ...best.dims, weightKg });
  if (parcel.parcelClass === "unknown") return null;
  const overweight = weightKg != null && weightKg > BWZ_POST_MAX_KG;
  // Generic "Maße" is usually the assembled item (cot, wardrobe) — flat-pack still ships bulky.
  if (parcel.parcelClass === "unshippable" && best.priority < 2 && !overweight) {
    return { ...parcel, parcelClass: "bulky", shipChf: BWZ_SHIP_BULKY_CHF, source: "description" };
  }
  return { ...parcel, source: "description" };
}

const BIG_ITEM_NAME_RE =
  /(kinderwagen|buggy|sportwagen|zwillingswagen|geschwisterwagen|kinderbett|babybett|gitterbett|beistellbett|stubenwagen|laufstall|laufgitter|hochstuhl|wickelkommode|kommode|kleiderschrank|laufrad|fahrrad|dreirad|kettcar|rutschauto|bobby.?car|trampolin|spielhaus|sandkasten|werkbank|kinderk(?:ü|ue)che|schaukel|rutsche\b|tisch\b|stuhl\b|bett\b)/i;
const ACCESSORY_NAME_RE =
  /(spannbett|bettw(?:ä|ae)sche|laken|bezug|nestchen|himmel|moskito|regenschutz|regenverdeck|insektenschutz|schirm|segel|verdeck|fu(?:ß|ss)sack|auflage|aufsatz|einlage|adapter|halter|haken|kette|clip|tasche|organizer|ersatz|zubeh(?:ö|oe)r|klingel|helm|korb|kissen|decke|matratzenschoner|schlafsack|spieluhr|mobile|lampe|aufkleber|schutz|griff|licht|handschuh|muff|netz|spielzeug|socke|matte|w(?:ä|ae)rmer|tablett|gurt|polster)/i;
const PRAM_CATEGORY_MIN_BUY_CHF = 250;
const CAR_SEAT_CATEGORY_MIN_BUY_CHF = 50;
const UNKNOWN_EXPENSIVE_MIN_BUY_CHF = 100;

/**
 * Last resort when Walz has no dims anywhere: big-item names / categories get a conservative
 * ship so a CHF 1'400 pram never goes out on the CHF 2 default.
 */
export function estimateBwzParcelFromCategory(input: {
  name: string;
  productType: string | null;
  buyChf: number;
}): BwzParcelAssessment | null {
  const name = input.name || "";
  const type = (input.productType || "").toLowerCase();
  const buy = Number(input.buyChf);
  const accessory = ACCESSORY_NAME_RE.test(name);
  const est = (parcelClass: "standard" | "bulky", shipChf: number): BwzParcelAssessment => ({
    ...unknownBwzParcel(),
    parcelClass,
    shipChf,
    source: "category",
  });

  // "Handwärmer für Kinderwagen" is an accessory; "Buggy für Zwillinge" is not.
  const headName = name.split(/\bf(?:ü|ue)r\b/i)[0];
  if (BIG_ITEM_NAME_RE.test(headName) && !accessory) return est("bulky", BWZ_SHIP_BULKY_CHF);
  if (Number.isFinite(buy) && !accessory) {
    if (type === "kinderwagen" && buy >= PRAM_CATEGORY_MIN_BUY_CHF) {
      return est("bulky", BWZ_SHIP_BULKY_CHF);
    }
    if (type === "kindersitze" && buy >= CAR_SEAT_CATEGORY_MIN_BUY_CHF) {
      return est("standard", BWZ_SHIP_STANDARD_HEAVY_CHF);
    }
  }
  if (Number.isFinite(buy) && buy >= UNKNOWN_EXPENSIVE_MIN_BUY_CHF) {
    return est("standard", BWZ_SHIP_STANDARD_CHF);
  }
  return null;
}

/** Galaxus ship override from a stored baby-walz note. Null → keep default CHF 2. */
export function bwzShipChfFromManualNote(manualNote: string | null | undefined): number | null {
  const parsed = parseNote(manualNote);
  if (!parsed) return null;
  if (parsed.parcelClass === "unshippable") return null;
  if (parsed.parcelClass === "standard" || parsed.parcelClass === "bulky") {
    const ship = Number(parsed.shipChf);
    if (Number.isFinite(ship) && ship >= 0) return ship;
    return classifyBwzParcel({
      lengthCm: numOrNull(parsed.lengthCm),
      widthCm: numOrNull(parsed.widthCm),
      heightCm: numOrNull(parsed.heightCm),
      weightKg: numOrNull(parsed.weightKg),
    }).shipChf;
  }
  return null;
}

export function isBwzUnshippableNote(manualNote: string | null | undefined): boolean {
  return parseNote(manualNote)?.parcelClass === "unshippable";
}

function finitePositive(value: number | null | undefined): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function numOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseNote(manualNote: string | null | undefined): Record<string, unknown> | null {
  const raw = String(manualNote ?? "").trim();
  if (!raw.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
