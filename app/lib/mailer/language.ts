export type MailLanguage = "fr" | "en" | "de";

const MAIL_LANGUAGES = new Set<MailLanguage>(["fr", "en", "de"]);

function asMailLanguage(value: string | null | undefined): MailLanguage | null {
  const raw = String(value || "").trim().toLowerCase();
  return MAIL_LANGUAGES.has(raw as MailLanguage) ? (raw as MailLanguage) : null;
}

/** Shopify customerLocale, e.g. de-CH, fr, en-CH. Unknown languages return null. */
export function mailLanguageFromLocale(locale: string | null | undefined): MailLanguage | null {
  const raw = String(locale || "").trim().toLowerCase();
  if (!raw) return null;
  const primary = raw.split(/[-_]/)[0] || "";
  return asMailLanguage(primary);
}

/** Last resort when the order has no Shopify locale. */
export function mailLanguageFromEmailDomain(email: string | null | undefined): MailLanguage {
  const domain = String(email || "").split("@")[1]?.toLowerCase() || "";
  if (/\.(de|at)$/i.test(domain)) return "de";
  if (/\.(fr|be|ch|qc)$/i.test(domain)) return "fr";
  if (/\.(uk|us|com|net|org)$/i.test(domain)) return "en";
  return "fr";
}

export function resolveMailLanguage(input: {
  override?: string | null;
  explicit?: string | null;
  customerLocale?: string | null;
  email?: string | null;
  domainMap?: Record<string, string> | null;
}): MailLanguage {
  const override = asMailLanguage(input.override);
  if (override) return override;
  const explicit = asMailLanguage(input.explicit);
  if (explicit) return explicit;
  const fromLocale = mailLanguageFromLocale(input.customerLocale);
  if (fromLocale) return fromLocale;
  const domain = String(input.email || "").split("@")[1]?.toLowerCase() || "";
  const mapped = asMailLanguage(input.domainMap?.[domain]);
  if (mapped) return mapped;
  return mailLanguageFromEmailDomain(input.email);
}
