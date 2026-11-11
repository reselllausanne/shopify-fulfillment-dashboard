/**
 * Pure helpers: what did the StockX checkout say right after "Place Order"?
 * And the payment circuit breaker (card dead => stop clicking Place Order).
 */

/** Words that make a checkout text snippet useful (payment outcome), vs nav boilerplate. */
const DIAG_KEYWORDS_RE =
  /payment|paiement|card|carte|declin|refus|error|erreur|try again|r[ée]essay|3-?D Secure|verify|authenticat|insufficient|expired|problem/i;

/**
 * Page text is mostly nav ("Skip to Main Content StockX ... Sneakers ..."). Return ~max chars
 * starting a bit before the first payment-ish keyword; fall back to the text after the nav.
 */
export function extractPaymentSnippet(body: string, max = 400): string {
  const text = String(body ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const m = DIAG_KEYWORDS_RE.exec(text);
  if (m) {
    const start = Math.max(0, m.index - 80);
    return text.slice(start, start + max);
  }
  // No keyword: skip the nav header when we recognise it, keep the rest.
  const afterNav = text.replace(/^.*?(?:Skip Account Menu|Log Out)\s+/i, "");
  return (afterNav.length >= 40 ? afterNav : text).slice(0, max);
}

/**
 * Specific phrases only. Bare "card" would hit "Gift Cards" in the account nav and
 * mislabel a PAID order as refused (then the buyer re-buys). Never match on /buying/ pages.
 */
export const PAYMENT_REFUSED_RE =
  /declin|refus|[ée]chou|payment (failed|error|could not|was not|not (completed|successful|accepted))|paiement (a [ée]chou[ée]|refus[ée]|impossible|non )|carte (refus[ée]e|expir[ée]e|invalide|n.a pas)|(card|credit card|debit card)[^.]{0,40}(declin|refus|expired|invalid|not accepted|rejected)|insufficient|expired|3-?D[- ]?Secure|authentication (is )?required|authentification|verify your (card|payment|identity)|there was a problem|something went wrong|probl[èe]me (de|avec)|try again|r[ée]essay|unable to (process|place)/i;

/** True when the checkout text says the payment did not go through. */
export function isPaymentRefused(text: string, url = ""): boolean {
  // Orders list / order page: if StockX moved us there, it is not a refusal screen.
  if (/\/buying\//.test(url)) return false;
  return PAYMENT_REFUSED_RE.test(String(text ?? ""));
}

export const PAYMENT_NOT_COMPLETED_PREFIX = "Payment not completed";

/** Checkout detail of a refused / unconfirmed payment (no charge). */
export function isPaymentNotCompletedDetail(detail: string | null | undefined): boolean {
  return String(detail ?? "").startsWith(PAYMENT_NOT_COMPLETED_PREFIX);
}

/** Consecutive Place Order clicks that ended with no StockX order and no order in the API. */
export const PAYMENT_BREAKER_LIMIT = 3;

export const PAYMENT_BREAKER_MESSAGE = "StockX payment failing (card?) - check payment method";

export function nextPaymentStreak(streak: number, event: "no_order" | "order"): number {
  return event === "order" ? 0 : streak + 1;
}

export function paymentBreakerTripped(streak: number, limit = PAYMENT_BREAKER_LIMIT): boolean {
  return streak >= limit;
}
