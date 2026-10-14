import { createHash } from "node:crypto";

/** Google / Meta / TikTok all expect lowercase hex SHA-256 of the normalized value. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}

const DIAL_CODES: Record<string, string> = {
  CH: "41",
  FR: "33",
  DE: "49",
  AT: "43",
  IT: "39",
  NL: "31",
  ES: "34",
};

/** E.164 digits with leading "+", using the shipping country when the number is national. */
export function normalizePhoneE164(raw: string | null | undefined, country = "CH"): string | null {
  let s = String(raw ?? "").replace(/[^\d+]/g, "");
  if (!s) return null;
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (!s.startsWith("+")) {
    const dial = DIAL_CODES[country.toUpperCase()];
    if (!dial) return null;
    s = `+${dial}${s.replace(/^0+/, "")}`;
  }
  const digits = s.slice(1);
  return /^\d{8,15}$/.test(digits) ? `+${digits}` : null;
}

export function hashedEmail(raw: string | null | undefined): string | null {
  const e = normalizeEmail(raw);
  return e ? sha256Hex(e) : null;
}

/** Meta wants digits only (no "+"); Google/TikTok accept E.164 with "+". */
export function hashedPhone(
  raw: string | null | undefined,
  country = "CH",
  format: "e164" | "digits" = "e164",
): string | null {
  const p = normalizePhoneE164(raw, country);
  if (!p) return null;
  return sha256Hex(format === "digits" ? p.slice(1) : p);
}
