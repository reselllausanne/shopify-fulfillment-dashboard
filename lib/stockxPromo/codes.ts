/**
 * StockX promo codes mined from the buyer's Gmail (same mailbox as the OTP IMAP).
 * One code per checkout. A rejected code is not a card decline and does not count
 * toward the per-line attempt cap.
 */

export type PromoAccount = "shopify" | "galaxus";
export type PromoStatus = "unused" | "used" | "rejected";

export type PromoCode = {
  code: string;
  account: PromoAccount;
  /** ISO time of the email. */
  emailDate: string;
  subject: string;
  /** YYYY-MM-DD, or null when the mail has no expiry. */
  expires: string | null;
  status: PromoStatus;
  lastTriedAt: string | null;
  rejectReason: string | null;
  /** While set and in the future, another checkout will not take this code. */
  holdUntil: string | null;
};

/** Galaxus StockX login. Mails to this recipient belong to that account. */
export const GALAXUS_PROMO_EMAIL = "contact@resell-lausanne.ch";

const CODE_BODY = "([A-Za-z0-9][A-Za-z0-9_-]{3,19})";
const PATTERNS: Array<{ re: RegExp; allowAlpha: boolean }> = [
  {
    re: new RegExp(
      `(?:use|utilisez|utiliser|appliquez|enter|entrez|saisissez)\\s+(?:the\\s+|le\\s+|votre\\s+|ce\\s+)?code\\s*[:：]?\\s*${CODE_BODY}`,
      "gi"
    ),
    allowAlpha: true,
  },
  {
    re: new RegExp(
      `(?:discount|promo|reward|coupon)\\s+code\\s*[:：]?\\s*${CODE_BODY}`,
      "gi"
    ),
    allowAlpha: true,
  },
  {
    re: new RegExp(
      `code\\s*(?:promo|de\\s+r[ée]duction|de\\s+remise)\\s*[:：]?\\s*${CODE_BODY}`,
      "gi"
    ),
    allowAlpha: true,
  },
  {
    re: new RegExp(`(?:votre|your)\\s+code\\s*[:：]?\\s*${CODE_BODY}`, "gi"),
    allowAlpha: true,
  },
];

const PROMO_MAIL_RE =
  /promo|discount|reward|\bcoupon\b|r[ée]duction|r[ée]compense|use code|utilisez le code|code promo|%\s*off|\boff\b|voucher|remise/i;

const OTP_SUBJECT_RE =
  /code de connexion|verification code|security code|one[- ]time|two[- ]factor|2fa|authentification|sign[- ]?in code/i;

const ALPHA_BLOCKLIST =
  /^(?:PROMO|CODE|DISCOUNT|REWARD|STOCKX|OFFER|ORDER|COMMANDE|TOTAL|EMAIL|HTTPS|HTTP|READY|HERE|BELOW|ABOVE|VALID|VALIDE|SUIVANT|FOLLOWING)$/i;

export const PROMO_REJECT_RE = new RegExp(
  [
    String.raw`(?:discount|promo|coupon|reward)\s+code[^.\n]{0,80}(?:invalid|expired|not valid|already(?: been)? used|doesn.?t apply|does not apply|minimum|cannot be applied|not applicable|has been used)`,
    String.raw`(?:code\s+promo|code\s+de\s+r[ée]duction|code\s+de\s+remise)[^.\n]{0,80}(?:invalid|invalide|expir|d[ée]j[àa]\s+utilis|minimum|ne\s+s.applique|pas\s+valable|incorrect|ne\s+peut\s+pas)`,
    String.raw`(?:invalid|invalide|expir[ée]e?|already used|d[ée]j[àa]\s+utilis[ée]e?)[^.\n]{0,60}(?:discount|promo|coupon|code)`,
    String.raw`(?:discount|promo|coupon|reward)\s+code[^.\n]{0,40}(?:is\s+)?(?:invalid|expired|already used)`,
    String.raw`code[^.\n]{0,40}(?:is\s+)?(?:invalid|expired|already used)`,
    String.raw`code[^.\n]{0,40}(?:est\s+)?(?:invalide|expir[ée]|d[ée]j[àa]\s+utilis)`,
    String.raw`(?:code|promo|coupon)[^.\n]{0,50}minimum\s+(?:order|purchase|spend|d.achat|de\s+commande)`,
    String.raw`minimum\s+(?:order|purchase|spend|d.achat|de\s+commande)[^.\n]{0,50}(?:code|promo|coupon)`,
    String.raw`montant minimum[^.\n]{0,40}(?:code|promo)`,
  ].join("|"),
  "i"
);

const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  janvier: 0,
  feb: 1,
  february: 1,
  fevrier: 1,
  février: 1,
  mar: 2,
  march: 2,
  mars: 2,
  apr: 3,
  april: 3,
  avril: 3,
  may: 4,
  mai: 4,
  jun: 5,
  june: 5,
  juin: 5,
  jul: 6,
  july: 6,
  juillet: 6,
  aug: 7,
  august: 7,
  aout: 7,
  août: 7,
  sep: 8,
  sept: 8,
  september: 8,
  septembre: 8,
  oct: 9,
  october: 9,
  octobre: 9,
  nov: 10,
  november: 10,
  novembre: 10,
  dec: 11,
  december: 11,
  decembre: 11,
  décembre: 11,
};

export function stripHtml(html: string): string {
  return String(html ?? "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function accountForRecipients(
  recipients: string[],
  galaxusEmail = GALAXUS_PROMO_EMAIL
): PromoAccount {
  const galaxus = galaxusEmail.trim().toLowerCase();
  for (const raw of recipients) {
    const email = raw.trim().toLowerCase();
    if (!email) continue;
    if (email === galaxus || email === GALAXUS_PROMO_EMAIL) return "galaxus";
    if (/^contact@/.test(email) && /resell-lausanne\.ch$/.test(email)) return "galaxus";
  }
  return "shopify";
}

export function isPromoCodeRejection(text: string): boolean {
  return PROMO_REJECT_RE.test(String(text ?? "").replace(/\s+/g, " "));
}

export function promoRejectReason(text: string): string {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  const match = flat.match(PROMO_REJECT_RE);
  if (!match || match.index == null) return "rejected";
  const start = Math.max(0, match.index - 40);
  return flat.slice(start, start + 160);
}

export function isPromoMail(subject: string, body: string): boolean {
  if (OTP_SUBJECT_RE.test(subject) && !PROMO_MAIL_RE.test(subject)) return false;
  return PROMO_MAIL_RE.test(`${subject}\n${body}`);
}

function cleanCode(raw: string, allowAlpha: boolean): string | null {
  const code = raw.trim().replace(/[.,;:!?)]+$/g, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{3,19}$/.test(code)) return null;
  if (/^\d+$/.test(code)) return null;
  if (!/[A-Za-z]/.test(code)) return null;
  if (/^0[123]-/i.test(code)) return null;
  if (ALPHA_BLOCKLIST.test(code)) return null;
  if (!allowAlpha && !/\d/.test(code)) return null;
  return code;
}

export function extractReceiptCodes(text: string): string[] {
  const found = new Set<string>();
  const out: string[] = [];
  const re = /(?<![A-Za-z0-9])([A-Za-z0-9][A-Za-z0-9]{5,19})\s*:\s*-(?:CHF|USD|EUR|€|\$)/gi;
  for (const match of text.matchAll(re)) {
    const code = cleanCode(match[1] ?? "", false);
    if (!code) continue;
    const key = code.toUpperCase();
    if (found.has(key)) continue;
    found.add(key);
    out.push(code);
  }
  return out;
}

export function extractPromoCodes(text: string): string[] {
  const found = new Set<string>();
  const out: string[] = [];
  for (const pattern of PATTERNS) {
    pattern.re.lastIndex = 0;
    for (const match of text.matchAll(pattern.re)) {
      const code = cleanCode(match[1] ?? "", pattern.allowAlpha);
      if (!code) continue;
      const key = code.toUpperCase();
      if (found.has(key)) continue;
      found.add(key);
      out.push(code);
    }
  }
  return out;
}

function isoDate(year: number, month: number, day: number): string | null {
  if (month < 0 || month > 11 || day < 1 || day > 31 || year < 2020 || year > 2100) return null;
  const dt = new Date(Date.UTC(year, month, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month || dt.getUTCDate() !== day) return null;
  return dt.toISOString().slice(0, 10);
}

export function parseExpiry(text: string): string | null {
  const blob = String(text ?? "");
  const iso = blob.match(
    /(?:expir\w*|valable jusqu|valid until|valid thru|until|avant le|ends on|jusqu'au)\D{0,16}(\d{4}-\d{2}-\d{2})/i
  );
  if (iso) return iso[1];

  const dmy = blob.match(
    /(?:expir\w*|valable jusqu|valid until|valid thru|until|avant le|ends on|jusqu'au)\D{0,20}(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/i
  );
  if (dmy) {
    const year = dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
    return isoDate(year, Number(dmy[2]) - 1, Number(dmy[1]));
  }

  const dMon = blob.match(
    /(?:expir\w*|valable jusqu|valid until|valid thru|until|avant le|ends on|jusqu'au)\D{0,20}(\d{1,2})(?:er|e)?\s+([A-Za-zàâéèêëîïôùûüç]+)\s+(\d{4})/i
  );
  if (dMon) {
    const month = MONTHS[dMon[2].toLowerCase().normalize("NFC")];
    if (month != null) return isoDate(Number(dMon[3]), month, Number(dMon[1]));
  }

  const monD = blob.match(
    /(?:expir\w*|valable jusqu|valid until|valid thru|until|avant le|ends on|jusqu'au)\D{0,20}([A-Za-zàâéèêëîïôùûüç]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i
  );
  if (monD) {
    const month = MONTHS[monD[1].toLowerCase().normalize("NFC")];
    if (month != null) return isoDate(Number(monD[3]), month, Number(monD[2]));
  }
  return null;
}

export type ParsedPromoMail = {
  subject: string;
  body: string;
  recipients: string[];
  emailDate: string;
  galaxusEmail?: string | null;
};

export function promosFromMail(mail: ParsedPromoMail): PromoCode[] {
  const body = stripHtml(mail.body);
  const subject = String(mail.subject ?? "").trim();
  const blob = `${subject}\n${body}`;
  const account = accountForRecipients(mail.recipients, mail.galaxusEmail || GALAXUS_PROMO_EMAIL);
  const expires = parseExpiry(blob);
  const reward = isPromoMail(subject, body) ? extractPromoCodes(blob) : [];
  const receipt = extractReceiptCodes(blob);
  const used = new Set(receipt.map((code) => code.toUpperCase()));
  const byCode = new Map<string, PromoCode>();
  const base = {
    account,
    emailDate: mail.emailDate,
    subject: subject.slice(0, 180),
    expires,
    lastTriedAt: null,
    holdUntil: null,
  };
  for (const code of reward) {
    const spent = used.has(code.toUpperCase());
    byCode.set(code.toUpperCase(), {
      ...base,
      code,
      status: spent ? "used" : "unused",
      rejectReason: spent ? "seen on order receipt" : null,
    });
  }
  for (const code of receipt) {
    const key = code.toUpperCase();
    if (byCode.has(key)) continue;
    byCode.set(key, {
      ...base,
      code,
      status: "used",
      rejectReason: "seen on order receipt",
    });
  }
  return [...byCode.values()];
}

export function zurichDay(nowMs: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(nowMs));
}

export function pickNextPromo(
  codes: PromoCode[],
  account: PromoAccount,
  nowMs: number
): PromoCode | null {
  const today = zurichDay(nowMs);
  const recentCut = new Date(nowMs - 90 * 24 * 60 * 60 * 1000).toISOString();
  const eligible = codes.filter((code) => {
    if (code.account !== account || code.status !== "unused") return false;
    if (code.expires && code.expires < today) return false;
    if (code.holdUntil) {
      const hold = Date.parse(code.holdUntil);
      if (Number.isFinite(hold) && hold > nowMs) return false;
    }
    return true;
  });
  // Year-old unread credits (BF 2025) stay stored, but a live code from the last 90 days is tried first.
  const pool = eligible.some((code) => code.emailDate >= recentCut)
    ? eligible.filter((code) => code.emailDate >= recentCut)
    : eligible;
  pool.sort((a, b) => a.emailDate.localeCompare(b.emailDate) || a.code.localeCompare(b.code));
  return pool[0] ?? null;
}

/** Scan must not clobber status, lastTriedAt, rejectReason, or an in-flight hold. */
export function mergePromoCodes(existing: PromoCode[], incoming: PromoCode[]): PromoCode[] {
  const byCode = new Map<string, PromoCode>();
  for (const code of existing) byCode.set(code.code.toUpperCase(), { ...code });
  for (const inc of incoming) {
    const key = inc.code.toUpperCase();
    const prev = byCode.get(key);
    if (!prev) {
      byCode.set(key, { ...inc });
      continue;
    }
    if (!prev.expires && inc.expires) prev.expires = inc.expires;
    if (!prev.subject && inc.subject) prev.subject = inc.subject;
    if (inc.emailDate && (!prev.emailDate || inc.emailDate < prev.emailDate)) prev.emailDate = inc.emailDate;
    // A later receipt proves the code was spent. Never revive a used or rejected code.
    if (inc.status === "used" && prev.status === "unused") {
      prev.status = "used";
      prev.holdUntil = null;
      prev.rejectReason = prev.rejectReason ?? inc.rejectReason ?? "seen on order receipt";
    }
  }
  return [...byCode.values()].sort(
    (a, b) => a.emailDate.localeCompare(b.emailDate) || a.code.localeCompare(b.code)
  );
}

export function promoApplyOutcome(input: {
  before: number | null;
  after: number | null;
  body: string;
}): "applied" | "rejected" | "unchanged" {
  if (isPromoCodeRejection(input.body)) return "rejected";
  if (
    input.before != null &&
    input.after != null &&
    Number.isFinite(input.before) &&
    Number.isFinite(input.after) &&
    input.after < input.before - 0.05
  ) {
    return "applied";
  }
  if (/(?:discount|r[ée]duction|promo)\s*[-–−]\s*(?:CHF\s*)?\d/i.test(input.body)) return "applied";
  return "unchanged";
}

function moneyToNumber(raw: string): number | null {
  const cleaned = raw.replace(/[’'\s]/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Last checkout total. Ignores "Subtotal" / "Sous-total". */
export function lastCheckoutTotalChf(text: string): number | null {
  const re =
    /(?<![A-Za-zÀ-ÿ])Total(?:\s*Price|\s*[àa]\s*payer)?\s*(?:CHF\s*)?(\d{1,3}(?:[’'\s]\d{3})*(?:[.,]\d{2})?)\s*(?:CHF)?/gi;
  let last: string | null = null;
  for (const match of text.matchAll(re)) last = match[1] ?? last;
  return last ? moneyToNumber(last) : null;
}
