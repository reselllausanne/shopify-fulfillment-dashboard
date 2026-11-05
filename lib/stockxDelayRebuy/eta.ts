/** Simple business-day adder (skip Sat/Sun). */
export function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from.getTime());
  let left = Math.max(0, Math.floor(days));
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) left -= 1;
  }
  return d;
}

/**
 * Fresh ETA after a StockX rebuy.
 * Express ≈ 5–8 business days; Standard ≈ 8–14.
 */
export function rebuyEtaWindow(
  lane: "STANDARD" | "EXPRESS",
  now: Date = new Date()
): { start: Date; end: Date } {
  if (lane === "EXPRESS") {
    return { start: addBusinessDays(now, 5), end: addBusinessDays(now, 8) };
  }
  return { start: addBusinessDays(now, 8), end: addBusinessDays(now, 14) };
}

export function formatFrDate(d: Date): string {
  return formatMailDate(d, "fr");
}

export function formatMailDate(d: Date, language: "fr" | "en" | "de" = "fr"): string {
  const locale = language === "de" ? "de-CH" : language === "en" ? "en-CH" : "fr-CH";
  return d.toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Zurich",
  });
}
