/**
 * Failure learning for the StockX buyer.
 *  - Every non-bought outcome is recorded with a stable signature.
 *  - Known signatures map to a remedy the supervisor applies on its own.
 *  - Unknown signatures are counted; after N hits they are escalated to a human.
 * Persisted as JSONL next to the ledger. `renderLearnings()` is the human view.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { BUYER_DIR } from "@/lib/stockxBuyer/ledger";
import { redactSecrets } from "@/lib/stockxBuyer/redact";

export const LEARNINGS_FILE = path.join(BUYER_DIR, "learnings.jsonl");

export type Remedy =
  | "rotate_session" // new sticky IP + new page in the same profile
  | "reload_page" // close the page, open a fresh one in the same Chrome
  | "dismiss_popup" // handled inside dismissNoise()
  | "wait_and_retry" // transient site state, plain backoff
  | "park_for_review" // needs a mapping or a human
  | "halt_all" // possible money-loss state, stop everything
  | "none";

export type Playbook = {
  id: string;
  match: RegExp;
  remedy: Remedy;
  lesson: string;
};

/**
 * Seeded with everything learned the hard way (Nov 2026). Order matters: first match wins.
 */
export const PLAYBOOK: Playbook[] = [
  {
    id: "paid_no_number",
    match: /paid (but|without) no stockx order number|paid_no_number|inflight/i,
    remedy: "halt_all",
    lesson:
      "Payment may have gone through. Never retry blind: list StockX buying orders, link the single unlinked match, else halt.",
  },
  {
    id: "proxy_402",
    match: /proxy_402|\b402\b.*lemon|lemonprime.*402/i,
    remedy: "halt_all",
    lesson: "LemonPrime out of credit. Top up, then clear the halt file.",
  },
  {
    id: "profile_error_popup",
    match: /profile error occurred/i,
    remedy: "dismiss_popup",
    lesson:
      "Two Chromes on one profile. Kill the other one; the popup hides the size grid, which looks like a size failure. Click OK, then continue.",
  },
  {
    id: "proxy_transport",
    match: /CONNECT tunnel failed|curl: \((7|28|56)\)|ECONNRESET|ETIMEDOUT|socket hang up|Proxy CONNECT/i,
    remedy: "rotate_session",
    lesson: "Dead sticky. Transport miss, not a StockX verdict. Fall back direct once, else rotate sticky.",
  },
  {
    id: "cloudflare",
    match: /cloudflare|turnstile|cf_abort|cf_no_sticky|cf_sticky|just a moment/i,
    remedy: "rotate_session",
    lesson: "Cloudflare sat on the page. One sticky per session; rotate only after 2 fails in a row.",
  },
  {
    id: "apparel_size_miss",
    match: /apparel miss|size.*(letter|apparel)|tiles=/i,
    remedy: "reload_page",
    lesson:
      "Apparel size tiles are plain divs, not buttons. Dismiss popups first, then click the shortest matching node.",
  },
  {
    id: "lane_click",
    match: /lane click|STANDARD click did not stick|price_moved|express_unparsed|multi_price/i,
    remedy: "reload_page",
    lesson: "Lane card click did not register. Strip xpress-ship=true, reload checkout, retry.",
  },
  {
    id: "size_map",
    match: /size_us_map|size_grid|size.*not.*found/i,
    remedy: "park_for_review",
    lesson: "EU size has no US mapping on this listing (brand chart or 'US M 15' absent). Needs a mapping or a human.",
  },
  {
    id: "slug_missing",
    match: /\bslug\b|no-slug|not_stx_line/i,
    remedy: "park_for_review",
    lesson:
      "No StockX slug. Style ids are colour-coded (DM1275-250): try progressively shorter hyphen candidates before giving up.",
  },
  {
    id: "oos",
    match: /oos_no_ask|no sellers|sold out/i,
    remedy: "wait_and_retry",
    lesson: "StockX sold out. Never auto rebuy a cancelled pair when sold out. Re-check on a slow timer.",
  },
  {
    id: "margin",
    match: /margin|cap\b|too_expensive/i,
    remedy: "wait_and_retry",
    lesson: "Sale price below all-in. Re-check later (prices move); never overpay silently.",
  },
  {
    id: "prebuy_dedupe",
    match: /prebuy_dedupe|ALREADY_BOUGHT_GMAIL|MATCH_UNLINKED_STX|already_matched/i,
    remedy: "park_for_review",
    lesson: "Possible duplicate (receipt in Gmail or unlinked StockX order). Link it, do not rebuy.",
  },
];

/** Pure: normalise noise (ids, numbers, urls) so equal failures share a signature. */
export function signatureOf(reason: string | null | undefined, detail: string | null | undefined): string {
  const raw = `${reason ?? ""} ${detail ?? ""}`
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/#?\b\d{4,}\b/g, "<n>")
    .replace(/\b0[1-3]-[a-z0-9]{8,}\b/g, "<stx>")
    .replace(/\d+(\.\d+)?/g, "<n>")
    .replace(/\s+/g, " ")
    .trim();
  return raw.slice(0, 140);
}

export function playbookFor(reason: string | null | undefined, detail: string | null | undefined): Playbook | null {
  const hay = `${reason ?? ""} ${detail ?? ""}`;
  return PLAYBOOK.find((p) => p.match.test(hay)) ?? null;
}

export type Learning = {
  t: number;
  signature: string;
  playbookId: string | null;
  remedy: Remedy;
  key: string;
  reason: string;
  detail: string | null;
};

export function makeLearning(input: {
  key: string;
  reason: string;
  detail: string | null;
  now?: number;
}): Learning {
  const pb = playbookFor(input.reason, input.detail);
  return {
    t: input.now ?? Date.now(),
    signature: signatureOf(input.reason, input.detail),
    playbookId: pb?.id ?? null,
    remedy: pb?.remedy ?? "none",
    key: input.key,
    reason: input.reason,
    detail: input.detail ? redactSecrets(input.detail).slice(0, 400) : null,
  };
}

export async function recordLearning(l: Learning, file = LEARNINGS_FILE): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${JSON.stringify(l)}\n`, "utf8");
}

export async function readLearnings(file = LEARNINGS_FILE): Promise<Learning[]> {
  const raw = await fs.readFile(file, "utf8").catch(() => "");
  const out: Learning[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as Learning);
    } catch {
      /* torn */
    }
  }
  return out;
}

export type LearningSummary = {
  signature: string;
  playbookId: string | null;
  remedy: Remedy;
  count: number;
  lastAt: number;
  sampleKey: string;
  sampleDetail: string | null;
};

/** Pure: group by signature, most frequent first. */
export function summarizeLearnings(list: Learning[]): LearningSummary[] {
  const map = new Map<string, LearningSummary>();
  for (const l of list) {
    const cur = map.get(l.signature);
    if (!cur) {
      map.set(l.signature, {
        signature: l.signature,
        playbookId: l.playbookId,
        remedy: l.remedy,
        count: 1,
        lastAt: l.t,
        sampleKey: l.key,
        sampleDetail: l.detail,
      });
    } else {
      cur.count += 1;
      cur.lastAt = Math.max(cur.lastAt, l.t);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
}

/** Pure: unknown signature seen `threshold` times in a row of failures → needs a human look. */
export function unknownSignatureEscalations(sum: LearningSummary[], threshold = 3): LearningSummary[] {
  return sum.filter((s) => s.playbookId == null && s.count >= threshold);
}

export function renderLearnings(sum: LearningSummary[]): string {
  const lines = ["# StockX buyer learnings", ""];
  for (const s of sum) {
    const pb = PLAYBOOK.find((p) => p.id === s.playbookId);
    lines.push(
      `- x${s.count} [${s.playbookId ?? "UNKNOWN"}] ${s.signature}` +
        (pb ? `\n  - lesson: ${pb.lesson}\n  - remedy: ${pb.remedy}` : `\n  - sample: ${s.sampleDetail ?? ""}`)
    );
  }
  return lines.join("\n");
}
