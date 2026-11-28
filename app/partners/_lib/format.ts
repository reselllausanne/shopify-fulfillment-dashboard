/** Display helpers of the partner portal (French, Swiss formats). Display only: no money arithmetic. */

const LOCALE = "fr-CH";
const TIME_ZONE = "Europe/Zurich";

const currencyFormatters = new Map<string, Intl.NumberFormat>();
const plainAmount = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });

function currencyFormatter(currency: string): Intl.NumberFormat | null {
  const code = currency.trim().toUpperCase();
  const cached = currencyFormatters.get(code);
  if (cached) return cached;
  try {
    const created = new Intl.NumberFormat(LOCALE, { style: "currency", currency: code });
    currencyFormatters.set(code, created);
    return created;
  } catch {
    return null;
  }
}

/** Amounts come from the API as decimal strings. Returns null when there is nothing to show. */
export function formatMoney(amount: string | null | undefined, currency: string | null | undefined): string | null {
  if (amount === null || amount === undefined || amount === "") return null;
  const value = Number(amount);
  if (!Number.isFinite(value)) return null;
  const formatter = currency ? currencyFormatter(currency) : null;
  return formatter ? formatter.format(value) : plainAmount.format(value);
}

export function formatCount(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? integer.format(n) : "—";
}

export function plural(n: number, singular: string, pluralForm: string): string {
  return n > 1 ? pluralForm : singular;
}

/** "36 paires", "1 paire". */
export function pairs(n: number): string {
  return `${formatCount(n)} ${plural(n, "paire", "paires")}`;
}

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

const dateLong = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "long", year: "numeric", timeZone: TIME_ZONE });
const dateShort = new Intl.DateTimeFormat(LOCALE, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: TIME_ZONE });
const dateTime = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TIME_ZONE,
});

/** "28 novembre 2026" */
export function formatDate(iso: string | null | undefined): string | null {
  const d = parse(iso);
  return d ? dateLong.format(d) : null;
}

/** "28.11.2026" */
export function formatDateShort(iso: string | null | undefined): string | null {
  const d = parse(iso);
  return d ? dateShort.format(d) : null;
}

/** "28 novembre 2026 à 04:20" */
export function formatDateTime(iso: string | null | undefined): string | null {
  const d = parse(iso);
  return d ? dateTime.format(d) : null;
}

/** "Nike Dunk Low Panda"; the brand is not repeated when the model name already contains it ("Air Jordan 1"). */
export function productTitle(brand: string | null | undefined, name: string): string {
  const b = (brand ?? "").trim();
  if (!b) return name;
  return ` ${name.toLowerCase()} `.includes(` ${b.toLowerCase()} `) ? name : `${b} ${name}`;
}
