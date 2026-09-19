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
 * Missing dims → unknown (caller keeps default ship CHF 2 until next scrape).
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
