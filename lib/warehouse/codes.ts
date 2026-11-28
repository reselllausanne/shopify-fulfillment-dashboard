/**
 * Scan code vocabulary — pure functions, no I/O.
 *
 * Pair label (format UUID_SITE_V1): ASCII `<uuid-v4>-<issuing site>`, e.g.
 *   75d27e3f-d85f-4def-9d00-c70be6fa60b7-CH01
 * No URL, no domain, no rack address: the label stays valid across moves, sites and VPS changes.
 *
 * Location: `<site>-<...>`, e.g. CH01-A-R01-T03-N02, CH01-REC-01, CH01-CART-01.
 * GTIN: digits only, kept as a string (leading zeros are significant).
 *
 * The registry (WarehouseLabelCode / WarehouseLocationCode) is the authority: classification
 * here only decides which registry to ask and which message to show.
 */

export const UNIT_LABEL_FORMAT_V1 = "UUID_SITE_V1";

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_ANY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SITE_CODE_RE = /^[A-Z]{2}[0-9]{2}$/;
const UNIT_LABEL_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-([A-Z]{2}[0-9]{2})$/;
const UUID_SUFFIX_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-([A-Z0-9]{2,8})$/;
const LOCATION_CODE_RE = /^[A-Z]{2}[0-9]{2}(-[A-Z0-9]{1,8}){1,6}$/;
const GTIN_RE = /^[0-9]{8,14}$/;

export function isSiteCode(value: string): boolean {
  return SITE_CODE_RE.test(value);
}

export function isUuidV4(value: string): boolean {
  return UUID_V4_RE.test(value);
}

export function buildUnitLabelCode(unitId: string, issuingSiteCode: string): string {
  const id = unitId.toLowerCase();
  const site = issuingSiteCode.toUpperCase();
  if (!UUID_V4_RE.test(id)) throw new Error(`Not a UUID v4: ${unitId}`);
  if (!SITE_CODE_RE.test(site)) throw new Error(`Invalid site code: ${issuingSiteCode}`);
  return `${id}-${site}`;
}

/** Human-readable reference printed next to the QR: first 8 hex chars, grouped. Not unique by itself. */
export function unitShortRef(unitId: string): string {
  const hex = unitId.replace(/-/g, "").slice(0, 8).toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}

/**
 * Strip only what a scanner transport adds: surrounding whitespace, CR/LF/TAB, NUL, and the
 * AIM symbology identifier some scanners prepend (`]Q1` QR, `]E0` EAN, `]C1` Code128, `]d2` DM).
 * The stored code is never altered — this only cleans the keystrokes.
 */
export function stripScannerTransport(raw: string): string {
  let v = String(raw ?? "");
  // eslint-disable-next-line no-control-regex
  v = v.replace(/[\u0000-\u001f\u007f]/g, "");
  v = v.trim();
  v = v.replace(/^\][A-Za-z][0-9A-Za-z]/, "");
  return v.trim();
}

const WEDGE_SEPARATORS = "'ß?/_=+*)!§°^¨`´";

/**
 * A scanner set to a US keyboard on a Swiss / German host types another character for the dash
 * (`'`, `ß`, …). Our codes use the dash only as a separator, at fixed places, so the substitution
 * is unambiguous: the SAME foreign character at every separator position of a code that is
 * otherwise exactly ours. Digits and a–f are identical on these layouts; nothing else is guessed.
 */
export function compensateWedgeLayout(cleaned: string): string {
  if (cleaned.includes("-")) return cleaned;
  const seps = new Set(cleaned.replace(/[0-9A-Za-z]/g, "").split(""));
  if (seps.size !== 1) return cleaned;
  const sep = [...seps][0];
  if (!WEDGE_SEPARATORS.includes(sep)) return cleaned;
  const candidate = cleaned.split(sep).join("-");
  const lower = candidate.toLowerCase();
  if (UUID_ANY_RE.test(lower.slice(0, 36)) && (candidate.length === 36 || /^-[A-Za-z0-9]{2,8}$/.test(candidate.slice(36)))) return candidate;
  if (LOCATION_CODE_RE.test(candidate.toUpperCase())) return candidate;
  return cleaned;
}

/** QWERTZ ⇄ QWERTY: the only letters that move are Y and Z. Used as a second registry lookup, never as a rewrite. */
export function swapYZ(code: string): string {
  return code.replace(/[yzYZ]/g, (c) => ({ y: "z", z: "y", Y: "Z", Z: "Y" })[c] as string);
}

export type ScanClass =
  | { kind: "UNIT_LABEL"; code: string; unitId: string; issuingSiteCode: string }
  /** UUID-shaped code that is not ours (wrong version nibble or unknown suffix): external reference. */
  | { kind: "EXTERNAL_UUID_REF"; code: string }
  | { kind: "LOCATION"; code: string; siteCode: string }
  /** `packaging`: GTIN-14 with a packaging indicator 1–8 — a carton / inner pack, not one box (A15). */
  | { kind: "GTIN"; gtin: string; checksumValid: boolean; packaging: boolean }
  /** A spreadsheet mangled a GTIN (1.98481E+11): refuse, never guess the digits. */
  | { kind: "MANGLED_NUMBER"; raw: string }
  | { kind: "EMPTY" }
  | { kind: "UNKNOWN"; raw: string };

/**
 * Classify cleaned scanner text. Unit codes are matched case-insensitively (a caps-lock
 * keyboard wedge must not break a scan); the canonical form is lower uuid + upper site.
 */
export function classifyScan(rawInput: string): ScanClass {
  const cleaned = compensateWedgeLayout(stripScannerTransport(rawInput));
  if (!cleaned) return { kind: "EMPTY" };

  // UUID-shaped prefix: ours when it is a v4 followed by `-<site code>`, otherwise an external reference.
  const uuidPart = cleaned.slice(0, 36).toLowerCase();
  if (UUID_ANY_RE.test(uuidPart)) {
    const rest = cleaned.slice(36);
    if (rest === "") return { kind: "EXTERNAL_UUID_REF", code: uuidPart };
    if (rest.startsWith("-")) {
      const canonical = `${uuidPart}-${rest.slice(1).toUpperCase()}`;
      const own = UNIT_LABEL_RE.exec(canonical);
      if (own) return { kind: "UNIT_LABEL", code: canonical, unitId: own[1], issuingSiteCode: own[2] };
      if (UUID_SUFFIX_RE.test(canonical)) return { kind: "EXTERNAL_UUID_REF", code: canonical };
    }
    return { kind: "UNKNOWN", raw: cleaned };
  }

  if (GTIN_RE.test(cleaned)) {
    return { kind: "GTIN", gtin: cleaned, checksumValid: isValidGtinChecksum(cleaned), packaging: isPackagingGtin(cleaned) };
  }
  if (/^[0-9]+([.,][0-9]+)?[eE][+-]?[0-9]+$/.test(cleaned)) {
    return { kind: "MANGLED_NUMBER", raw: cleaned };
  }

  const upper = cleaned.toUpperCase();
  if (LOCATION_CODE_RE.test(upper)) {
    return { kind: "LOCATION", code: upper, siteCode: upper.slice(0, 4) };
  }
  return { kind: "UNKNOWN", raw: cleaned };
}

/** GS1 mod-10 check digit for GTIN-8/12/13/14. */
export function isValidGtinChecksum(gtin: string): boolean {
  if (!GTIN_RE.test(gtin) || ![8, 12, 13, 14].includes(gtin.length)) return false;
  const digits = gtin.split("").map(Number);
  const check = digits.pop() as number;
  let sum = 0;
  for (let i = digits.length - 1, w = 3; i >= 0; i -= 1, w = w === 3 ? 1 : 3) {
    sum += digits[i] * w;
  }
  return (10 - (sum % 10)) % 10 === check;
}

/**
 * GTIN-14 whose first digit is 1–8 identifies a grouping of trade items (carton, inner pack):
 * the box inside has its own GTIN. Indicator 0 is the unit itself, 9 a variable-measure item.
 */
export function isPackagingGtin(gtin: string): boolean {
  return /^[1-8][0-9]{13}$/.test(gtin) && isValidGtinChecksum(gtin);
}

/** The unit GTIN (EAN-13) usually contained in a packaging GTIN-14 — a hint to show, never an identification. */
export function containedUnitGtin(packagingGtin: string): string | null {
  if (!isPackagingGtin(packagingGtin)) return null;
  const body = packagingGtin.slice(1, 13);
  const digits = body.split("").map(Number);
  let sum = 0;
  for (let i = digits.length - 1, w = 3; i >= 0; i -= 1, w = w === 3 ? 1 : 3) sum += digits[i] * w;
  return `${body}${(10 - (sum % 10)) % 10}`;
}

/** Normalize a GTIN for alias lookup: digits as given (no padding, no numeric cast). */
export function normalizeGtin(value: string): string | null {
  const v = stripScannerTransport(value);
  return GTIN_RE.test(v) ? v : null;
}

/** GTIN variants that designate the same trade item (EAN-13 ⇄ UPC-12 ⇄ GTIN-14 with leading zeros). */
export function gtinLookupVariants(gtin: string): string[] {
  const out = new Set<string>([gtin]);
  const stripped = gtin.replace(/^0+/, "");
  for (const len of [8, 12, 13, 14]) {
    if (stripped.length <= len) out.add(stripped.padStart(len, "0"));
  }
  return [...out].filter((g) => GTIN_RE.test(g));
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export type LevelAddress = { siteCode: string; sector: string; rowNo: number; rackNo: number; levelNo: number };

/** CH01-A-R01-T03-N02 = site, sector A, row 01, rack/bay 03, level 02 from the floor. */
export function buildLevelCode(a: LevelAddress): string {
  return `${a.siteCode}-${a.sector}-R${pad2(a.rowNo)}-T${pad2(a.rackNo)}-N${pad2(a.levelNo)}`;
}
export function buildRackCode(a: Omit<LevelAddress, "levelNo">): string {
  return `${a.siteCode}-${a.sector}-R${pad2(a.rowNo)}-T${pad2(a.rackNo)}`;
}
export function buildRowCode(a: Pick<LevelAddress, "siteCode" | "sector" | "rowNo">): string {
  return `${a.siteCode}-${a.sector}-R${pad2(a.rowNo)}`;
}
export function buildSectorCode(siteCode: string, sector: string): string {
  return `${siteCode}-${sector}`;
}
/** Short code shown big on the shelf front: A-01-03-2. */
export function buildLevelShortCode(a: Omit<LevelAddress, "siteCode">): string {
  return `${a.sector}-${pad2(a.rowNo)}-${pad2(a.rackNo)}-${a.levelNo}`;
}

export function isLocationCode(value: string): boolean {
  return LOCATION_CODE_RE.test(value);
}

/** Walk order: sector, row, rack, level. Odd rows walk racks ascending, even rows descending (serpentine). */
export function computeWalkSequence(params: {
  sectorIndex: number;
  rowNo: number;
  rackNo: number;
  levelNo: number;
  racksPerRow: number;
  serpentine: boolean;
}): number {
  const rackOrder =
    params.serpentine && params.rowNo % 2 === 0 ? params.racksPerRow - params.rackNo + 1 : params.rackNo;
  return params.sectorIndex * 1_000_000 + params.rowNo * 10_000 + rackOrder * 100 + params.levelNo;
}

/** Spreadsheet-safe cell: neutralize formula triggers (= + - @ tab CR) and quote CSV specials. */
export function csvCell(value: unknown): string {
  let v = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  if (/[",\n\r;]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  const lines = [header.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
