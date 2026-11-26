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

/**
 * Card / payment method rejected by StockX after "Place Order" (or already shown on the review page).
 * Real texts seen on the VPS (26 Nov 2026, 47 refused clicks):
 *   FR: "Une erreur s'est produite avec votre mode de paiement. Merci d'indiquer un nouveau mode de paiement, puis réessayez. Actualiser"
 *   EN: "There was an error with your payment method. Please enter a new payment method and try again. Update"
 * plus common wordings (declined, insufficient funds, update/add payment method, 3-D Secure required).
 * Stricter than PAYMENT_REFUSED_RE on purpose: no bare "try again" / "expired" / "error".
 */
export const CARD_DECLINED_RE = new RegExp(
  [
    String.raw`erreur s.est produite avec votre mode de paiement`,
    String.raw`error with your payment method`,
    String.raw`indiquer un nouveau mode de paiement`,
    String.raw`(enter|add|provide|use) a new payment method`,
    String.raw`payment method (was )?(declined|failed|rejected|not accepted)`,
    String.raw`payment (was )?(declined|refused)`,
    String.raw`mode de paiement (a [ée]t[ée] )?(refus|rejet|invalide)`,
    String.raw`paiement (a [ée]t[ée] )?(refus|rejet|d[ée]clin)`,
    String.raw`(card|carte)( was| a [ée]t[ée])? (declined|refus[ée]e|rejet[ée]e|bloqu[ée]e)`,
    String.raw`(insufficient|not enough) funds`,
    String.raw`fonds insuffisants`,
    String.raw`update (your )?payment (method|information)`,
    String.raw`mettez? [àa] jour (votre )?mode de paiement`,
    String.raw`3-?D[- ]?Secure[^.]{0,60}(fail|required|[ée]chou|requis)`,
  ].join("|"),
  "i"
);

/** Strict card-declined test. Never true on /buying/ pages (orders list, order detail). */
export function isCardDeclined(text: string, url = ""): boolean {
  if (/\/buying\//.test(url)) return false;
  return CARD_DECLINED_RE.test(String(text ?? "").replace(/\s+/g, " "));
}

export const CARD_DECLINED_REASON = "payment_declined";

/** Halt reason shown to the user / written in buyer.halt + night-buyer.halt. */
export const CARD_DECLINED_HALT_REASON = "card declined — fund/unlock card";
