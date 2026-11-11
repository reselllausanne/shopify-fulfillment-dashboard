import { redactSecrets } from "@/lib/stockxBuyer/redact";

/**
 * Pure policy for the unified StockX buyer (Shopify + Galaxus).
 * No I/O here: everything is unit-tested in policy.test.ts.
 */

export type BuySource = "shopify" | "galaxus";

/** Terminal-ish state of one buy job (one Shopify line or one Galaxus unit). */
export type JobStatus =
  | "bought" // StockX order number linked. Never touched again.
  | "done" // nothing to buy (already matched, dry run, pickup, physical stock)
  | "held" // manual hold (GOAT). Only a human releases it.
  | "too_expensive" // margin / cap verdict. Re-check later, prices move.
  | "no_sellers" // StockX sold out. Never auto rebuy; re-check later.
  | "not_stockx" // item not sold on StockX
  | "needs_review" // slug / size map / possible duplicate. Human or fix required.
  | "retry" // transient failure; waits for `nextAttemptAt`
  | "parked"; // retries exhausted; slow re-check

export type JobOutcome =
  | { kind: "bought"; stockxOrderNumber: string; totalChf: number | null; lane: string | null }
  | { kind: "done"; detail: string }
  | { kind: "verdict"; status: Exclude<JobStatus, "bought" | "done" | "retry" | "parked">; reason: string; detail: string | null }
  | { kind: "paid_no_number"; totalChf: number | null; lane: string | null }
  | { kind: "halt"; reason: string }
  | { kind: "retry"; reason: string; detail: string | null; rotateSession: boolean };

/** Loose input: StockxAutoCheckoutResult | Galaxus result | batch "aborted" row. */
export type RawCheckoutResult = {
  kind: string;
  reason?: string | null;
  detail?: string | null;
  stockxOrderNumber?: string | null;
  totalChf?: number | null;
  lane?: string | null;
};

const INF = Number.POSITIVE_INFINITY;

/** How long a verdict blocks a re-run. Prices and stock move, so most expire. */
export const RECHECK_MS: Record<JobStatus, number> = {
  bought: INF,
  done: INF,
  held: INF,
  too_expensive: 90 * 60_000,
  no_sellers: 90 * 60_000,
  not_stockx: 12 * 3600_000,
  needs_review: 3 * 3600_000,
  retry: 0, // governed by nextAttemptAt
  parked: 15 * 60_000,
};

export const MAX_TRIES = Number(process.env.STOCKX_BUYER_MAX_TRIES || 6);

/** Reasons that mean "the page did not behave", never a verdict on the product. */
const TRANSIENT_REASONS = new Set([
  "bot_fail",
  "proxy_blank",
  "oos",
  "express_unparsed",
  "price_moved",
  "multi_price",
  "express_only",
  "wrong_lane_only",
  "setup",
  "cf_abort_45s",
  "cf_no_sticky",
  "cf_sticky_abort",
]);

const SESSION_ROTATE_REASONS = new Set(["proxy_blank", "cf_abort_45s", "cf_no_sticky", "cf_sticky_abort", "proxy_402"]);

/** Pure: map any checkout result to the next action. */
export function classifyResult(r: RawCheckoutResult): JobOutcome {
  const lane = r.lane ? String(r.lane) : null;
  const reason = String(r.reason ?? "unknown");
  const detail = r.detail == null ? null : redactSecrets(r.detail);

  if (r.kind === "easy_buy") {
    if (r.stockxOrderNumber) {
      return {
        kind: "bought",
        stockxOrderNumber: r.stockxOrderNumber,
        totalChf: r.totalChf ?? null,
        lane: laneFromOrderNumber(r.stockxOrderNumber) ?? lane,
      };
    }
    if (/dry_run/i.test(detail ?? "")) return { kind: "done", detail: `dry_run ${detail ?? ""}`.trim() };
    return { kind: "paid_no_number", totalChf: r.totalChf ?? null, lane };
  }

  if (r.kind === "skipped") {
    if (reason === "non_stockx") {
      if (String(detail ?? "").startsWith("goat_")) {
        return { kind: "verdict", status: "held", reason: "goat_hold", detail };
      }
      return { kind: "verdict", status: "not_stockx", reason, detail };
    }
    return { kind: "done", detail: `${reason} ${detail ?? ""}`.trim() };
  }

  if (r.kind === "aborted") {
    if (reason === "proxy_402") return { kind: "halt", reason: `proxy_402: ${detail ?? "LemonPrime out of credit"}` };
    return { kind: "retry", reason, detail, rotateSession: SESSION_ROTATE_REASONS.has(reason) };
  }

  // needs_human family
  if (reason === "link_fail") return { kind: "halt", reason: `link_fail: ${detail ?? ""}` };
  if (reason === "bot_fail" && /paid but no stockx order number/i.test(detail ?? "")) {
    return { kind: "paid_no_number", totalChf: r.totalChf ?? null, lane };
  }
  if (reason === "margin" || reason === "margin_abort" || reason === "cap") {
    return { kind: "verdict", status: "too_expensive", reason, detail };
  }
  if (reason === "oos_no_ask") return { kind: "verdict", status: "no_sellers", reason, detail };
  if (reason === "non_stockx") return { kind: "verdict", status: "not_stockx", reason, detail };
  if (reason === "size_us_map" || reason === "slug" || reason === "size_grid") {
    return { kind: "verdict", status: "needs_review", reason, detail };
  }
  // A possible duplicate (unlinked StockX buy, Gmail receipt) is NEVER bought through.
  if (reason === "prebuy_dedupe" || reason === "already_matched") {
    return { kind: "verdict", status: "needs_review", reason, detail };
  }
  if (TRANSIENT_REASONS.has(reason) || r.kind === "needs_human") {
    return { kind: "retry", reason, detail, rotateSession: SESSION_ROTATE_REASONS.has(reason) };
  }
  return { kind: "retry", reason, detail, rotateSession: false };
}

/** StockX order number prefix is the real lane: 01- Express, 03- Standard. */
export function laneFromOrderNumber(n: string | null | undefined): "EXPRESS" | "STANDARD" | null {
  const t = String(n ?? "");
  if (t.startsWith("01-")) return "EXPRESS";
  if (t.startsWith("03-")) return "STANDARD";
  return null;
}

/** Exponential backoff with a ceiling: 30s, 1m, 2m, 4m, 8m, 15m. */
export function backoffMs(tries: number): number {
  const n = Math.max(1, Math.floor(tries));
  return Math.min(15 * 60_000, 30_000 * 2 ** (n - 1));
}

export type JobState = {
  key: string;
  status: JobStatus;
  reason: string;
  detail?: string | null;
  at: number;
  tries: number;
  nextAttemptAt?: number | null;
  stockxOrderNumber?: string | null;
  totalChf?: number | null;
  lane?: string | null;
  source?: BuySource;
  orderRef?: string;
  title?: string;
};

/** Pure: is a stored state still blocking a new attempt at `now`? */
export function stateBlocks(s: JobState | undefined, now: number): boolean {
  if (!s) return false;
  if (s.status === "retry") return s.nextAttemptAt != null && now < s.nextAttemptAt;
  return now - s.at < RECHECK_MS[s.status];
}

/** Pure: next state after an outcome. */
export function applyOutcome(
  prev: JobState | undefined,
  base: Pick<JobState, "key" | "source" | "orderRef" | "title">,
  out: JobOutcome,
  now: number
): JobState {
  const tries = (prev?.tries ?? 0) + 1;
  const common = { ...base, at: now, tries };
  switch (out.kind) {
    case "bought":
      return {
        ...common,
        status: "bought",
        reason: "bought",
        stockxOrderNumber: out.stockxOrderNumber,
        totalChf: out.totalChf,
        lane: out.lane,
      };
    case "done":
      return { ...common, status: "done", reason: out.detail };
    case "verdict":
      return { ...common, status: out.status, reason: out.reason, detail: out.detail };
    case "paid_no_number":
      // Money may have left. Never retry blind: reconcile first.
      return { ...common, status: "needs_review", reason: "paid_no_number", totalChf: out.totalChf, lane: out.lane };
    case "halt":
      return { ...common, status: "needs_review", reason: out.reason };
    case "retry": {
      if (tries >= MAX_TRIES) {
        return { ...common, status: "parked", reason: `retry_exhausted:${out.reason}`, detail: out.detail };
      }
      return {
        ...common,
        status: "retry",
        reason: out.reason,
        detail: out.detail,
        nextAttemptAt: now + backoffMs(tries),
      };
    }
  }
}

/**
 * Cancelled StockX order → rebuy? Only if the order is cancelled AND the product is still
 * buyable. A sold-out pair is never rebought (it would just fail or overpay).
 */
export function shouldRebuyCancelled(input: {
  stockxStatus: string | null | undefined;
  shopifyCancelled: boolean;
  precheckStatus: string | null | undefined;
  alreadyRebought: boolean;
}): { rebuy: boolean; reason: string } {
  const st = String(input.stockxStatus ?? "").toUpperCase();
  if (!(st.includes("CANCEL") || st.includes("REFUND"))) return { rebuy: false, reason: "not_cancelled" };
  if (input.shopifyCancelled) return { rebuy: false, reason: "shopify_order_cancelled" };
  if (input.alreadyRebought) return { rebuy: false, reason: "already_rebought" };
  const p = String(input.precheckStatus ?? "");
  if (p === "oos_no_ask") return { rebuy: false, reason: "sold_out" };
  if (p === "excluded_brand" || p === "no_variant_match") return { rebuy: false, reason: p };
  if (p === "too_expensive") return { rebuy: false, reason: "too_expensive" };
  return { rebuy: true, reason: p === "buyable" ? "buyable" : `precheck_${p || "unknown"}` };
}

/** Stable idempotency key per buy job. */
export function jobKey(src: BuySource, parts: { lineItemId?: string | null; orderRef: string; lineId?: string; unitIndex?: number }): string {
  if (src === "shopify") {
    const id = String(parts.lineItemId ?? "").replace(/\D/g, "");
    return id ? `shopify:${id}` : `shopify:${parts.orderRef}`;
  }
  return `galaxus:${parts.lineId ?? parts.orderRef}:${parts.unitIndex ?? 0}`;
}

export type QueueEntry = {
  key: string;
  source: BuySource;
  createdAt: number;
  /** Customer chose Express (Shopify). */
  express: boolean;
};

/**
 * Pure ordering. Shopify before Galaxus (customer speed), Express before Standard,
 * then oldest first. Stable on ties.
 */
export function orderQueue<T extends QueueEntry>(entries: T[]): T[] {
  const rank = (e: QueueEntry) => (e.source === "shopify" ? (e.express ? 0 : 1) : 2);
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => rank(a.e) - rank(b.e) || a.e.createdAt - b.e.createdAt || a.i - b.i)
    .map((x) => x.e);
}
