/**
 * Durable per-line attempt cap (Shopify ledger + Galaxus night state).
 *
 * Before: a line that kept failing was `parked` and re-checked every 15 min with a fresh budget, forever
 * (Ugg Fluff: 349 attempts, Shopify #7842: 15 attempts in 10 h on a refused payment).
 * Now: failures are counted per error class in the persisted state. When one class reaches the limit the
 * line becomes `needs_review` / `max_attempts:<class>` and is NOT re-checked automatically.
 * Only that line stops; every other line keeps going. A card refusal is a separate global halt (cardAlert.ts).
 *
 * Never counted: paid_no_number (must be verified through the buying API before any retry),
 * payment_declined (global halt), proxy_402 (global halt), a rejected StockX promo code
 * (checkout pays without the code; it is not a card refusal). Pure helpers, unit tested.
 */

import { isPromoCodeRejection } from "@/lib/stockxPromo/codes";

export const MAX_ATTEMPTS_PREFIX = "max_attempts:";

/** Infra classes hit every line during an outage, so they get a much higher cap than line-specific ones. */
const INFRA_CLASSES = new Set(["proxy_blank", "network", "cf_abort_45s", "cf_no_sticky", "cf_sticky_abort"]);

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : d;
};

/** Same line, same checkout/payment/size/lane error, this many times → stop retrying that line. */
export function maxLineFails(env: NodeJS.ProcessEnv = process.env): number {
  return num(env.STOCKX_BUYER_MAX_LINE_FAILS, 20);
}

export function maxInfraFails(env: NodeJS.ProcessEnv = process.env): number {
  return num(env.STOCKX_BUYER_MAX_LINE_FAILS_INFRA, 60);
}

export function limitFor(cls: string, env: NodeJS.ProcessEnv = process.env): number {
  return INFRA_CLASSES.has(cls) ? maxInfraFails(env) : maxLineFails(env);
}

/**
 * Error class of a failed attempt, or null when it must not be counted.
 * `reason` is the checkout reason (bot_fail, size_us_map, no_lane_under_cap, proxy_blank...), `detail` the page text.
 */
export function failureClass(reason: string | null | undefined, detail?: string | null): string | null {
  const r = String(reason ?? "")
    .replace(/^retry_exhausted:/, "")
    .replace(MAX_ATTEMPTS_PREFIX, "")
    .trim();
  if (!r) return null;
  if (r === "paid_no_number" || r === "payment_declined" || r === "proxy_402" || r.startsWith("card declined")) return null;
  const d = String(detail ?? "");
  if (isPromoCodeRejection(d)) return null;
  if (/^Payment not completed/i.test(d)) return "payment_not_completed";
  if (/ERR_TUNNEL|ERR_CONNECTION|ERR_PROXY|ERR_TIMED_OUT|net::ERR/i.test(d)) return "network";
  if (/hydrate timeout|no CHF lanes/i.test(d)) return "proxy_blank";
  return r;
}

export function addFail(prev: Record<string, number> | undefined, cls: string, n = 1): Record<string, number> {
  return { ...(prev ?? {}), [cls]: ((prev ?? {})[cls] ?? 0) + n };
}

/** First class at or above its limit, else null. */
export function capHit(
  counts: Record<string, number> | undefined,
  env: NodeJS.ProcessEnv = process.env
): { cls: string; count: number } | null {
  for (const [cls, count] of Object.entries(counts ?? {})) {
    if (count >= limitFor(cls, env)) return { cls, count };
  }
  return null;
}

export const maxAttemptsReason = (cls: string) => `${MAX_ATTEMPTS_PREFIX}${cls}`;
export const isMaxAttemptsReason = (reason: string | null | undefined) => String(reason ?? "").startsWith(MAX_ATTEMPTS_PREFIX);

/**
 * A `max_attempts:<class>` state keeps blocking until someone releases the line, or the configured limit
 * is raised above the stored count (config change frees it).
 */
export function maxAttemptsBlocks(
  s: { reason?: string | null; failCounts?: Record<string, number> } | undefined,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (!s || !isMaxAttemptsReason(s.reason)) return false;
  const cls = String(s.reason).slice(MAX_ATTEMPTS_PREFIX.length);
  const count = s.failCounts?.[cls];
  if (count == null) return true;
  return count >= limitFor(cls, env);
}
