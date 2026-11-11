/**
 * Galaxus night buyer: every open Galaxus line (Direct Delivery + Warehouse), oldest first,
 * one pair at a time, StockX deep-link checkout, no human.
 *
 * Lane: Express if on page and margin >= 0, else Standard if loss <= 5 %, else report.
 * Verdicts that end a pair: bought, too_expensive, no_sellers, not_stockx, needs_review.
 * Cloudflare / blank / timeout / price moved / lane not verified are NEVER verdicts:
 * same pair, retry. After MAX_TRIES the pair is parked and re-run on the next pass
 * (queue stays oldest first, never starves the rest).
 * One sticky proxy IP per browser session (about 50 min). IP changes only when the
 * session expires or two retryable failures happen in a row.
 * Paid without number: recover from the StockX buying API, link, then continue.
 * Anything ambiguous after a payment: HALT file, no further click.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/app/lib/prisma";
import { fetchRecentStockxBuyingOrders } from "@/galaxus/stx/stockxClient";
import { readGalaxusStockxToken } from "@/lib/stockxGalaxusAuth";
import { nextStockxPlaywrightProxy } from "@/lib/stockxPlaywrightProxy";
import {
  launchStockxContext,
  runStockxAutoCheckoutForGalaxusLine,
  type GalaxusAutoCheckoutResult,
} from "@/lib/stockxCheckout";
import {
  resolveGalaxusStxBuyCandidate,
  type GalaxusBuyCandidate,
} from "@/lib/stockxAutoCheckout/galaxusBuyCandidates";
import { linkStockxBuyToGalaxus } from "@/lib/stockxAutoCheckout/linkAfterBuyGalaxus";
import { isClearlyNotStockxBuyable } from "@/lib/stockxAutoCheckout/nonStockxBuyable";

export const DATA_DIR = process.env.NIGHT_BUYER_DATA_DIR || path.join(process.cwd(), ".data");
export const ON_FILE = path.join(DATA_DIR, "night-buyer.on");
export const HALT_FILE = path.join(DATA_DIR, "night-buyer.halt");
const STATE_FILE = path.join(DATA_DIR, "night-buyer-state.json");
const INFLIGHT_FILE = path.join(DATA_DIR, "night-buyer-inflight.json");
const REPORT_FILE = path.join(DATA_DIR, "night-buyer-report.md");

export type PairStatus =
  | "bought"
  | "done"
  | "too_expensive"
  | "no_sellers"
  | "not_stockx"
  | "needs_review"
  | "parked";

export type NightPair = {
  galaxusOrderId: string;
  lineId: string;
  lineNumber: number;
  gtin: string | null;
  productName: string;
  orderDate: Date;
  unitIndex: number;
  qty: number;
};

export type PairState = {
  status: PairStatus;
  reason: string;
  detail?: string | null;
  at: number;
  tries?: number;
  stockxOrderNumber?: string | null;
  totalChf?: number | null;
  lane?: string | null;
  title?: string;
  orderId?: string;
};

/** How long a non-bought verdict stays before the pair is re-checked (prices move). */
export const RECHECK_MS: Record<PairStatus, number> = {
  bought: Number.POSITIVE_INFINITY,
  done: Number.POSITIVE_INFINITY,
  too_expensive: 90 * 60_000,
  no_sellers: 90 * 60_000,
  not_stockx: 12 * 3600_000,
  needs_review: 3 * 3600_000,
  parked: 15 * 60_000,
};

export type Outcome =
  | { kind: "bought"; stockxOrderNumber: string; totalChf: number | null; lane: string | null }
  | { kind: "done"; detail: string }
  | {
      kind: "verdict";
      status: Exclude<PairStatus, "bought" | "done" | "parked">;
      reason: string;
      detail: string | null;
    }
  | { kind: "paid_no_number"; totalChf: number | null; lane: string | null }
  | { kind: "halt"; reason: string }
  | { kind: "retry"; reason: string; detail: string | null };

/** Pure: map a checkout result to what the worker does next. */
export function classifyCheckoutResult(r: GalaxusAutoCheckoutResult): Outcome {
  const lane = r.lane ? String(r.lane) : null;
  if (r.kind === "easy_buy") {
    if (r.stockxOrderNumber) {
      return {
        kind: "bought",
        stockxOrderNumber: r.stockxOrderNumber,
        totalChf: r.totalChf ?? null,
        lane,
      };
    }
    if (/dry_run/i.test(r.detail ?? "")) {
      return { kind: "done", detail: `dry_run lane=${lane} total=${r.totalChf ?? "?"} ${r.pickReason ?? ""}`.trim() };
    }
    return { kind: "paid_no_number", totalChf: r.totalChf ?? null, lane };
  }
  if (r.kind === "skipped") {
    return { kind: "done", detail: `${r.reason ?? "skipped"} ${r.detail ?? ""}`.trim() };
  }
  const reason = String(r.reason ?? "unknown");
  const detail = r.detail ?? null;
  if (reason === "link_fail") return { kind: "halt", reason: `link_fail: ${detail ?? ""}` };
  if (reason === "bot_fail" && /paid but no stockx order number/i.test(detail ?? "")) {
    return { kind: "paid_no_number", totalChf: r.totalChf ?? null, lane };
  }
  if (reason === "margin" || reason === "margin_abort" || reason === "cap") {
    return { kind: "verdict", status: "too_expensive", reason, detail };
  }
  if (reason === "oos_no_ask") {
    return { kind: "verdict", status: "no_sellers", reason, detail };
  }
  if (reason === "non_stockx") {
    return { kind: "verdict", status: "not_stockx", reason, detail };
  }
  if (reason === "size_us_map" || reason === "slug" || reason === "size_grid") {
    return { kind: "verdict", status: "needs_review", reason, detail };
  }
  // proxy_blank, oos (unparsed), express_unparsed, price_moved, multi_price, bot_fail...
  // = Cloudflare / hydrate / click did not stick. Never a verdict.
  return { kind: "retry", reason, detail };
}

/** Pure: which units of a line still need a purchase. */
export function missingUnitIndexes(
  qty: number,
  taken: Array<{ unitIndex: number | null | undefined }>
): number[] {
  const have = new Set(taken.map((t) => Math.max(0, Number(t.unitIndex ?? 0) || 0)));
  const out: number[] = [];
  for (let i = 0; i < Math.max(0, qty); i += 1) if (!have.has(i)) out.push(i);
  return out;
}

export function pairKey(p: Pick<NightPair, "lineId" | "unitIndex">): string {
  return `${p.lineId}:${p.unitIndex}`;
}

/** Pure: is a stored state still blocking a re-run? */
export function stateBlocks(s: PairState | undefined, now: number): boolean {
  if (!s) return false;
  return now - s.at < RECHECK_MS[s.status];
}

/** Pure: StockX order number prefix tells the real lane. */
export function laneFromOrderNumber(n: string | null | undefined): "EXPRESS" | "STANDARD" | null {
  const t = String(n ?? "");
  if (t.startsWith("01-")) return "EXPRESS";
  if (t.startsWith("03-")) return "STANDARD";
  return null;
}

/** Pure: keep the same IP until it ages out or two retryable failures in a row. */
export const SESSION_MAX_MS = Number(process.env.NIGHT_BUYER_SESSION_MIN || 50) * 60_000;
export function shouldRotateSession(s: { startedAt: number; consecutiveFails: number }, now: number): boolean {
  return now - s.startedAt > SESSION_MAX_MS || s.consecutiveFails >= 2;
}

const QUEUE_SQL = `
SELECT o."galaxusOrderId" AS "galaxusOrderId", o."orderDate" AS "orderDate",
       l.id AS "lineId", l."lineNumber" AS "lineNumber", l.gtin AS gtin,
       l."productName" AS "productName", COALESCE(l.quantity, 0) AS qty
FROM "GalaxusOrder" o
JOIN "GalaxusOrderLine" l ON l."orderId" = o.id
WHERE o."deliveryType" IN ('direct_delivery', 'warehouse_delivery')
  AND o."archivedAt" IS NULL
  AND o."cancelledAt" IS NULL
  AND o."orderDate" >= $1
  AND o."orderDate" < $2
  AND COALESCE(l.quantity, 0) > 0
  AND l."warehouseMarkedShippedAt" IS NULL
  AND COALESCE(l.quantity, 0) > COALESCE((
    SELECT SUM(si.quantity)
    FROM "ShipmentItem" si
    INNER JOIN "Shipment" s ON s.id = si."shipmentId"
    WHERE si."orderId" = o.id
      AND (s."delrSentAt" IS NOT NULL OR s."delrStatus"::text = 'UPLOADED')
      AND length(regexp_replace(COALESCE(l.gtin, ''), '[^0-9]', '', 'g')) > 0
      AND right(lpad(regexp_replace(COALESCE(si.gtin14, ''), '[^0-9]', '', 'g'), 14, '0'), 14)
        = right(lpad(regexp_replace(COALESCE(l.gtin, ''), '[^0-9]', '', 'g'), 14, '0'), 14)
  ), 0)
ORDER BY o."orderDate" ASC, o.id ASC, l."lineNumber" ASC
`;

export async function buildNightQueue(opts: {
  since: Date;
  /** Exclusive upper bound (Zurich day end = next day 00:00). Omit = no ceiling. */
  until?: Date | null;
  skipOrders: Set<string>;
}): Promise<NightPair[]> {
  const until = opts.until ?? new Date("2099-01-01T00:00:00+02:00");
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      galaxusOrderId: string;
      orderDate: Date;
      lineId: string;
      lineNumber: number;
      gtin: string | null;
      productName: string;
      qty: number | bigint;
    }>
  >(QUEUE_SQL, opts.since, until);
  const lineIds = rows.map((r) => r.lineId);
  if (!lineIds.length) return [];
  const [matches, externals] = await Promise.all([
    (prisma as any).galaxusStockxMatch.findMany({
      where: { galaxusOrderLineId: { in: lineIds }, stockxOrderNumber: { not: "" } },
      select: { galaxusOrderLineId: true, unitIndex: true },
    }),
    (prisma as any).galaxusExternalBuy.findMany({
      where: { galaxusOrderLineId: { in: lineIds } },
      select: { galaxusOrderLineId: true, unitIndex: true },
    }),
  ]);
  const taken = new Map<string, Array<{ unitIndex: number }>>();
  for (const m of [...matches, ...externals]) {
    const arr = taken.get(m.galaxusOrderLineId) ?? [];
    arr.push({ unitIndex: m.unitIndex });
    taken.set(m.galaxusOrderLineId, arr);
  }
  const out: NightPair[] = [];
  for (const r of rows) {
    if (opts.skipOrders.has(String(r.galaxusOrderId))) continue;
    if (/zippo|briquet|lighter|feuerzeug/i.test(r.productName)) continue;
    const qty = Number(r.qty) || 0;
    for (const unitIndex of missingUnitIndexes(qty, taken.get(r.lineId) ?? [])) {
      out.push({
        galaxusOrderId: String(r.galaxusOrderId),
        lineId: r.lineId,
        lineNumber: r.lineNumber,
        gtin: r.gtin,
        productName: r.productName,
        orderDate: new Date(r.orderDate),
        unitIndex,
        qty,
      });
    }
  }
  return out;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 1), "utf8");
  await fs.rename(tmp, file);
}

export async function loadState(): Promise<Record<string, PairState>> {
  return readJson<Record<string, PairState>>(STATE_FILE, {});
}

export async function saveState(state: Record<string, PairState>): Promise<void> {
  await writeJson(STATE_FILE, state);
}

export async function writeReport(state: Record<string, PairState>): Promise<void> {
  const rows = Object.entries(state).sort((a, b) => a[1].at - b[1].at);
  const bought = rows.filter(([, s]) => s.status === "bought");
  const not = rows.filter(([, s]) => s.status !== "bought" && s.status !== "done");
  const fmt = (t: number) => new Date(t).toISOString().replace("T", " ").slice(0, 16);
  const lines = [
    `# Night buyer ${fmt(Date.now())} UTC`,
    "",
    `## Bought (${bought.length})`,
    "| order | title | CHF | lane | StockX | at |",
    "|---|---|---|---|---|---|",
    ...bought.map(
      ([, s]) =>
        `| ${s.orderId ?? ""} | ${s.title ?? ""} | ${s.totalChf ?? ""} | ${s.lane ?? ""} | ${s.stockxOrderNumber ?? ""} | ${fmt(s.at)} |`
    ),
    "",
    `## Not bought (${not.length})`,
    "| order | title | verdict | reason / detail | at |",
    "|---|---|---|---|---|",
    ...not.map(
      ([, s]) =>
        `| ${s.orderId ?? ""} | ${s.title ?? ""} | ${s.status} | ${s.reason} ${String(s.detail ?? "").replace(/\|/g, "/").slice(0, 160)} | ${fmt(s.at)} |`
    ),
    "",
  ];
  await fs.writeFile(REPORT_FILE, lines.join("\n"), "utf8");
}

const LOCK_FILE = path.join(DATA_DIR, "night-buyer.lock");
const LOCK_STALE_MS = 45_000;
let lockTimer: NodeJS.Timeout | null = null;

/** Pure: is another worker alive? Lock file touched within the last 45 s. */
export function lockIsLive(mtimeMs: number | null, now: number): boolean {
  return mtimeMs != null && now - mtimeMs < LOCK_STALE_MS;
}

/** One worker only. Two workers = double buys. Returns false if another is alive. */
export async function acquireSingleInstanceLock(): Promise<boolean> {
  const st = await fs.stat(LOCK_FILE).catch(() => null);
  if (lockIsLive(st ? st.mtimeMs : null, Date.now())) return false;
  await fs.mkdir(DATA_DIR, { recursive: true });
  const token = `${process.pid}:${Date.now()}`;
  await fs.writeFile(LOCK_FILE, token, "utf8");
  // Re-read: if two start at once, only the last writer keeps the lock.
  await new Promise((r) => setTimeout(r, 400));
  if ((await fs.readFile(LOCK_FILE, "utf8").catch(() => "")) !== token) return false;
  lockTimer = setInterval(() => {
    fs.writeFile(LOCK_FILE, token, "utf8").catch(() => undefined);
  }, 10_000);
  return true;
}

export async function releaseLock(): Promise<void> {
  if (lockTimer) clearInterval(lockTimer);
  lockTimer = null;
  await fs.rm(LOCK_FILE, { force: true });
}

export async function halt(reason: string): Promise<void> {
  console.error(`[NIGHT-BUYER] HALT ${reason}`);
  await fs.writeFile(HALT_FILE, `${new Date().toISOString()} ${reason}\n`, "utf8");
}

function normStyle(v: unknown): string {
  return String(v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

type StockxBuyingNodeLike = {
  orderNumber?: string | null;
  purchaseDate?: string | null;
  creationDate?: string | null;
  amount?: number | null;
  productVariant?: any;
};

function sameProduct(n: StockxBuyingNodeLike, c: Pick<GalaxusBuyCandidate, "styleId" | "slug">): boolean {
  const product = n.productVariant?.product ?? {};
  return Boolean(
    (c.styleId && normStyle(product.styleId) === normStyle(c.styleId)) ||
      (product.urlKey && String(product.urlKey) === c.slug)
  );
}

async function isLinkedAnywhere(orderNumber: string): Promise<boolean> {
  const gx = await (prisma as any).galaxusStockxMatch.findFirst({
    where: { stockxOrderNumber: orderNumber },
    select: { id: true },
  });
  if (gx) return true;
  const shop = await (prisma as any).orderMatch
    .findFirst({ where: { stockxOrderNumber: orderNumber }, select: { id: true } })
    .catch(() => null);
  return Boolean(shop);
}

async function freshUnlinkedBuys(
  c: Pick<GalaxusBuyCandidate, "styleId" | "slug">,
  sinceMs: number
): Promise<Array<{ orderNumber: string; amount: number | null }>> {
  const token = await readGalaxusStockxToken();
  if (!token) throw new Error("no_stockx_token");
  const nodes = (await fetchRecentStockxBuyingOrders(token, {
    first: 30,
    maxPages: 1,
    state: "PENDING",
  })) as StockxBuyingNodeLike[];
  const hits: Array<{ orderNumber: string; amount: number | null }> = [];
  for (const n of nodes) {
    const num = String(n.orderNumber ?? "").trim();
    if (!num) continue;
    const when = Date.parse(String(n.purchaseDate ?? n.creationDate ?? ""));
    if (Number.isFinite(when) && when < sinceMs - 120_000) continue;
    if (!sameProduct(n, c)) continue;
    if (await isLinkedAnywhere(num)) continue;
    hits.push({ orderNumber: num, amount: typeof n.amount === "number" ? n.amount : null });
  }
  return hits;
}

/**
 * Paid, no number. Find the fresh unlinked StockX buy for this product and link it.
 * Exactly one unlinked candidate in the window = link. Else null (caller halts).
 */
export async function recoverUnlinkedBuy(
  candidate: GalaxusBuyCandidate,
  opts: { sinceMs: number; totalChf: number | null; unitIndex: number }
): Promise<string | null> {
  const hits = await freshUnlinkedBuys(candidate, opts.sinceMs);
  if (hits.length !== 1) {
    console.error(
      `[NIGHT-BUYER] recover: ${hits.length} unlinked candidates (${hits.map((h) => h.orderNumber).join(",")})`
    );
    return null;
  }
  const num = hits[0]!.orderNumber;
  const lane = num.startsWith("01-") ? "EXPRESS" : "STANDARD";
  const linked = await linkStockxBuyToGalaxus({
    galaxusOrderDbId: candidate.galaxusOrderDbId,
    galaxusOrderId: candidate.galaxusOrderId,
    lineId: candidate.lineId,
    unitIndex: opts.unitIndex,
    productName: candidate.productName,
    gtin: candidate.gtin,
    sizeEU: candidate.sizeEU,
    styleId: candidate.styleId,
    sellChf: candidate.sellChf,
    stockxOrderNumber: num,
    supplierCost: opts.totalChf ?? hits[0]!.amount ?? 0,
    desiredLane: lane as any,
    stockxCheckoutType: lane,
  });
  return linked.ok ? num : null;
}

/** Token may be mid-renewal and the buying list may lag: retry for a few minutes. */
export async function recoverWithPolling(
  candidate: GalaxusBuyCandidate,
  opts: { sinceMs: number; totalChf: number | null; unitIndex: number },
  poll: { tries: number; everyMs: number } = { tries: 12, everyMs: 30_000 }
): Promise<string | null> {
  for (let i = 0; i < poll.tries; i += 1) {
    try {
      const num = await recoverUnlinkedBuy(candidate, opts);
      if (num) return num;
    } catch (e: any) {
      console.warn(`[NIGHT-BUYER] recover try ${i + 1}/${poll.tries}: ${e?.message || e}`);
    }
    await new Promise((r) => setTimeout(r, poll.everyMs));
  }
  return null;
}

/**
 * While halted for "paid without number" / inflight: try to link the fresh buy by itself.
 * 1 unlinked candidate = link, clear halt. 0 candidates after 30 min with a readable
 * StockX list = never paid, clear halt. Anything else stays halted.
 */
export async function autoHealHalt(): Promise<boolean> {
  const halted = await fs.readFile(HALT_FILE, "utf8").catch(() => "");
  if (!/paid without number|inflight/i.test(halted)) return false;
  const inflight = await readJson<null | { key: string; startedAt: number; candidate: GalaxusBuyCandidate }>(INFLIGHT_FILE, null);
  if (!inflight) return false;
  const unitIndex = Number(String(inflight.key).split(":")[1] ?? 0) || 0;
  let hits: Array<{ orderNumber: string; amount: number | null }>;
  try {
    hits = await freshUnlinkedBuys(inflight.candidate, inflight.startedAt);
  } catch {
    return false;
  }
  if (hits.length === 1) {
    const num = await recoverUnlinkedBuy(inflight.candidate, { sinceMs: inflight.startedAt, totalChf: null, unitIndex }).catch(() => null);
    if (!num) return false;
    console.warn(`[NIGHT-BUYER] auto-heal linked ${num}`);
  } else if (hits.length === 0) {
    if (Date.now() - inflight.startedAt < 30 * 60_000) return false;
    console.warn(`[NIGHT-BUYER] auto-heal: no StockX buy for ${inflight.key} after 30 min — never paid`);
  } else {
    return false;
  }
  await fs.rm(INFLIGHT_FILE, { force: true });
  await fs.rm(HALT_FILE, { force: true });
  return true;
}

export async function resolvePair(
  pair: NightPair
): Promise<
  | { ok: true; candidate: GalaxusBuyCandidate }
  | { ok: false; status: "not_stockx" | "needs_review"; reason: string }
> {
  const order = await prisma.galaxusOrder.findFirst({
    where: { galaxusOrderId: pair.galaxusOrderId },
    include: { lines: true },
  });
  const line = order?.lines.find((l) => l.id === pair.lineId);
  if (!order || !line) return { ok: false, status: "needs_review", reason: "order_or_line_missing" };
  const nb = isClearlyNotStockxBuyable({ title: line.productName, sku: line.supplierSku });
  if (nb.notBuyable) return { ok: false, status: "not_stockx", reason: nb.label ?? "not_stockx" };
  const r = await resolveGalaxusStxBuyCandidate({ order, line });
  if (r.ok) return r;
  const notStockx = ["not_stx_line", "warehouse_stock_hint"].includes(r.reason);
  return { ok: false, status: notStockx ? "not_stockx" : "needs_review", reason: r.reason };
}

/** One browser, one sticky IP, reused across pairs. */
type Session = {
  launched: Awaited<ReturnType<typeof launchStockxContext>>;
  startedAt: number;
  consecutiveFails: number;
};
let session: Session | null = null;

export async function closeSession(): Promise<void> {
  const s = session;
  session = null;
  await s?.launched.ctx.close().catch(() => undefined);
}

async function getSession(): Promise<Session> {
  if (session && shouldRotateSession(session, Date.now())) {
    console.warn(
      `[NIGHT-BUYER] rotate IP (age ${Math.round((Date.now() - session.startedAt) / 60000)}min, fails ${session.consecutiveFails})`
    );
    await closeSession();
  }
  if (!session) {
    const sticky = nextStockxPlaywrightProxy();
    const launched = await launchStockxContext({
      account: "galaxus",
      proxy: sticky,
      useStickyProxy: Boolean(sticky),
      forceCold: Boolean(sticky),
    });
    session = { launched, startedAt: Date.now(), consecutiveFails: 0 };
    console.warn(`[NIGHT-BUYER] new session (sticky=${Boolean(sticky)})`);
  }
  return session;
}

async function runOnce(
  candidate: GalaxusBuyCandidate,
  unitIndex: number
): Promise<GalaxusAutoCheckoutResult> {
  const s = await getSession();
  return runStockxAutoCheckoutForGalaxusLine({
    candidate,
    unitIndex,
    noLoss: true,
    dryRun: process.env.NIGHT_BUYER_DRY === "1",
    reuse: { ctx: s.launched.ctx, page: s.launched.page },
    skipGoto: false,
  });
}

export const MAX_TRIES = Number(process.env.NIGHT_BUYER_MAX_TRIES || 6);

export async function processPair(
  pair: NightPair,
  state: Record<string, PairState>,
  opts?: { isOn?: () => Promise<boolean> }
): Promise<void> {
  const isOn =
    opts?.isOn ?? (() => fs.stat(ON_FILE).then(() => true).catch(() => false));
  const key = pairKey(pair);
  const base = { title: pair.productName, orderId: pair.galaxusOrderId, at: Date.now() };
  const resolved = await resolvePair(pair);
  if (!resolved.ok) {
    state[key] = { ...base, status: resolved.status, reason: resolved.reason };
    console.warn(
      `[NIGHT-BUYER] ${pair.galaxusOrderId} ${pair.productName} → ${resolved.status} ${resolved.reason}`
    );
    return;
  }
  const candidate = resolved.candidate;
  let lastReason = "";
  let lastDetail: string | null = null;
  for (let attempt = 1; attempt <= MAX_TRIES; attempt += 1) {
    if (!(await isOn())) return;
    const startedAt = Date.now();
    await writeJson(INFLIGHT_FILE, { key, startedAt, candidate });
    let result: GalaxusAutoCheckoutResult;
    try {
      result = await runOnce(candidate, pair.unitIndex);
    } catch (e: any) {
      result = { kind: "needs_human", reason: "bot_fail", detail: e?.message || String(e) };
    }
    const out = classifyCheckoutResult(result);
    console.warn(
      `[NIGHT-BUYER] try ${attempt}/${MAX_TRIES} ${pair.galaxusOrderId} u${pair.unitIndex} ${pair.productName} → ${out.kind}` +
        ("reason" in out ? ` ${out.reason}` : "") +
        ("detail" in out && out.detail ? ` | ${String(out.detail).slice(0, 160)}` : "")
    );
    if (session) session.consecutiveFails = out.kind === "retry" ? session.consecutiveFails + 1 : 0;

    if (out.kind === "bought") {
      state[key] = {
        ...base,
        status: "bought",
        reason: "bought",
        stockxOrderNumber: out.stockxOrderNumber,
        totalChf: out.totalChf,
        // Truth = StockX number prefix: 01- Express, 03- Standard.
        lane: laneFromOrderNumber(out.stockxOrderNumber) ?? out.lane,
      };
      await fs.rm(INFLIGHT_FILE, { force: true });
      return;
    }
    if (out.kind === "done") {
      state[key] = { ...base, status: "done", reason: out.detail };
      await fs.rm(INFLIGHT_FILE, { force: true });
      return;
    }
    if (out.kind === "verdict") {
      state[key] = { ...base, status: out.status, reason: out.reason, detail: out.detail };
      await fs.rm(INFLIGHT_FILE, { force: true });
      return;
    }
    if (out.kind === "halt") {
      await halt(`${pair.galaxusOrderId} ${pair.productName}: ${out.reason}`);
      return;
    }
    if (out.kind === "paid_no_number") {
      const num = await recoverWithPolling(candidate, {
        sinceMs: startedAt,
        totalChf: out.totalChf,
        unitIndex: pair.unitIndex,
      });
      if (num) {
        state[key] = {
          ...base,
          status: "bought",
          reason: "bought_recovered",
          stockxOrderNumber: num,
          totalChf: out.totalChf,
          lane: num.startsWith("01-") ? "EXPRESS" : "STANDARD",
        };
        await fs.rm(INFLIGHT_FILE, { force: true });
        return;
      }
      await halt(`paid without number, not recoverable: ${pair.galaxusOrderId} ${pair.productName}`);
      return;
    }
    lastReason = out.reason;
    lastDetail = out.detail;
    await new Promise((r) => setTimeout(r, Math.min(60_000, 6_000 * attempt)));
  }
  await fs.rm(INFLIGHT_FILE, { force: true });
  state[key] = {
    ...base,
    status: "parked",
    reason: `retry_exhausted:${lastReason}`,
    detail: lastDetail,
    tries: MAX_TRIES,
  };
}

/** On start: a kill between Place Order and link must not cause a rebuy. */
export async function reconcileInflight(): Promise<void> {
  const inflight = await readJson<null | {
    key: string;
    startedAt: number;
    candidate: GalaxusBuyCandidate;
  }>(INFLIGHT_FILE, null);
  if (!inflight) return;
  const unitIndex = Number(String(inflight.key).split(":")[1] ?? 0) || 0;
  console.warn(`[NIGHT-BUYER] inflight ${inflight.key} — reconcile against StockX buying list`);
  let hits: Array<{ orderNumber: string; amount: number | null }> = [];
  try {
    hits = await freshUnlinkedBuys(inflight.candidate, inflight.startedAt);
  } catch (e: any) {
    await halt(`inflight ${inflight.key}: cannot read StockX buying list (${e?.message || e})`);
    return;
  }
  if (hits.length === 0) {
    await fs.rm(INFLIGHT_FILE, { force: true });
    return;
  }
  if (hits.length === 1) {
    const num = await recoverUnlinkedBuy(inflight.candidate, {
      sinceMs: inflight.startedAt,
      totalChf: null,
      unitIndex,
    }).catch(() => null);
    if (num) {
      console.warn(`[NIGHT-BUYER] inflight recovered + linked ${num}`);
      await fs.rm(INFLIGHT_FILE, { force: true });
      return;
    }
  }
  await halt(
    `inflight ${inflight.key}: unlinked fresh buys ${hits.map((h) => h.orderNumber).join(",")} — link by hand`
  );
}
