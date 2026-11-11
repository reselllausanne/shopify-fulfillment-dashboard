/**
 * Unified StockX buyer: one process, one lock, one Chrome at a time.
 *
 * Cycle: Shopify (Express first, then oldest) → cancelled-pair rebuys → Galaxus.
 * Every pair: dedupe (ledger + OrderMatch + prebuy Gmail/StockX check inside the checkout)
 * → GOAT price watch (alert + short pause, never buys on GOAT) → buy → ledger + learning.
 * Failures are classified; transient ones back off, verdicts wait for a re-check window,
 * and anything that may have cost money halts the whole worker.
 */
import path from "node:path";
import fs from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import {
  HALT_FILE as NIGHT_HALT_FILE,
  acquireSingleInstanceLock,
  autoHealHalt,
  buildNightQueue,
  closeSession as closeGalaxusSession,
  loadState as loadNightState,
  pairKey,
  processPair,
  reconcileInflight,
  resolvePair,
  saveState as saveNightState,
  stateBlocks as nightStateBlocks,
  type NightPair,
  type PairState,
  releaseLock,
} from "@/lib/stockxAutoCheckout/galaxusNightBuyer";
import { runShopifyBatchBuy, type ShopifyBatchBuyItem } from "@/lib/stockxAutoCheckout/shopifyBatchBuy";
import { findUnlinkedStockxMatches } from "@/lib/stockxAutoCheckout/prebuyDedupe";
import { precheckStockxBuyability } from "@/lib/stockxAutoCheckout/precheckAvailability";
import { killChromeForUserDataDir } from "@/lib/stockxBrowserProcess";
import { postSlack } from "@/lib/stockxAuthAlert";
import { checkGoat, goatAlertText } from "@/lib/stockxBuyer/goatWatch";
import {
  BUYER_DIR,
  REPORT_FILE,
  STATUS_FILE,
  appendEvent,
  haltBuyer,
  isHalted,
  isOn,
  loadReduced,
  readHalt,
  renderReport,
  writeJsonAtomic,
} from "@/lib/stockxBuyer/ledger";
import {
  makeLearning,
  readLearnings,
  recordLearning,
  summarizeLearnings,
  unknownSignatureEscalations,
} from "@/lib/stockxBuyer/learnings";
import {
  applyOutcome,
  classifyResult,
  jobKey,
  orderQueue,
  stateBlocks,
  type JobOutcome,
  type JobState,
  type RawCheckoutResult,
} from "@/lib/stockxBuyer/policy";
import {
  buildCancelRebuyJobs,
  buildShopifyJobs,
  type ShopifyJob,
} from "@/lib/stockxBuyer/shopifyQueue";

export type SupervisorConfig = {
  dryRun: boolean;
  /** Run one cycle and return (CLI dry-run / tests). */
  once: boolean;
  shopify: boolean;
  galaxus: boolean;
  rebuy: boolean;
  shopifySince: Date;
  galaxusSince: Date;
  galaxusUntil: Date | null;
  skipGalaxusOrders: Set<string>;
  onlyOrders: Set<string> | null;
  /** Shopify pairs per browser session. */
  batchSize: number;
  galaxusPerCycle: number;
  maxAllInChf: number;
  idleMs: number;
  rebuyEveryMs: number;
  goatWatch: boolean;
  goatHoldMs: number;
};

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): SupervisorConfig {
  const num = (v: string | undefined, d: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  const bool = (v: string | undefined, d: boolean) => (v == null || v === "" ? d : /^(1|true|yes|on)$/i.test(v));
  const day = (v: string | undefined, d: string) => new Date(`${(v || d).trim()}T00:00:00+02:00`);
  const until = (env.STOCKX_BUYER_GALAXUS_UNTIL || "").trim();
  return {
    dryRun: bool(env.STOCKX_BUYER_DRY, false),
    once: false,
    shopify: bool(env.STOCKX_BUYER_SHOPIFY, true),
    galaxus: bool(env.STOCKX_BUYER_GALAXUS, true),
    rebuy: bool(env.STOCKX_BUYER_REBUY, true),
    shopifySince: day(env.STOCKX_BUYER_SHOPIFY_SINCE, "2026-10-01"),
    galaxusSince: day(env.STOCKX_BUYER_GALAXUS_SINCE, "2026-10-22"),
    galaxusUntil: until ? new Date(day(until, until).getTime() + 24 * 3600_000) : null,
    skipGalaxusOrders: new Set(
      (env.STOCKX_BUYER_GALAXUS_SKIP_ORDERS || "208510767")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    ),
    onlyOrders: null,
    batchSize: Math.floor(num(env.STOCKX_BUYER_BATCH, 5)),
    galaxusPerCycle: Math.floor(num(env.STOCKX_BUYER_GALAXUS_PER_CYCLE, 12)),
    maxAllInChf: num(env.STOCKX_BUYER_MAX_ALL_IN_CHF, 1_000_000),
    idleMs: num(env.STOCKX_BUYER_IDLE_MS, 60_000),
    rebuyEveryMs: num(env.STOCKX_BUYER_REBUY_EVERY_MS, 15 * 60_000),
    goatWatch: bool(env.STOCKX_BUYER_GOAT_WATCH, true),
    goatHoldMs: num(env.GOAT_HOLD_MINUTES, 45) * 60_000,
  };
}

const DATA_DIR = process.env.NIGHT_BUYER_DATA_DIR || path.join(process.cwd(), ".data");
const PROFILE_DIRS = [path.join(DATA_DIR, "stockx-profile"), path.join(DATA_DIR, "stockx-profile-galaxus")];

const log = (msg: string) => console.warn(`[STOCKX-BUYER] ${msg}`);

type Counters = { bought: number; verdicts: number; retries: number; halts: number; goatAlerts: number };

export type Runtime = {
  cfg: SupervisorConfig;
  states: Map<string, JobState>;
  alerted: Map<string, number>;
  counters: Counters;
  phase: string;
  startedAt: number;
  lastRebuyAt: number;
  rebuyJobs: ShopifyJob[];
  escalated: Map<string, number>;
  lastError: string | null;
};

async function persistState(rt: Runtime, state: JobState): Promise<void> {
  rt.states.set(state.key, state);
  if (!rt.cfg.dryRun) await appendEvent({ t: Date.now(), ev: "state", state });
}

async function halt(rt: Runtime, reason: string): Promise<void> {
  rt.counters.halts += 1;
  log(`HALT ${reason}`);
  if (!rt.cfg.dryRun) await haltBuyer(reason);
  if (!rt.cfg.dryRun) await postSlack(`:octagonal_sign: StockX buyer HALT: ${reason}`).catch(() => false);
}

/** Learn from a failure and apply the playbook remedy. Never throws. */
async function learn(rt: Runtime, key: string, out: JobOutcome): Promise<void> {
  try {
    let reason = "";
    let detail: string | null = null;
    if (out.kind === "retry") {
      reason = out.reason;
      detail = out.detail;
    } else if (out.kind === "verdict") {
      reason = out.reason;
      detail = out.detail;
    } else if (out.kind === "halt") reason = out.reason;
    else if (out.kind === "paid_no_number") reason = "paid_no_number";
    else return;
    const l = makeLearning({ key, reason, detail });
    if (!rt.cfg.dryRun) await recordLearning(l);
    if (l.remedy === "halt_all") await halt(rt, `${l.playbookId}: ${reason} ${detail ?? ""}`.trim());

    const esc = unknownSignatureEscalations(summarizeLearnings(await readLearnings()), 3);
    for (const e of esc) {
      const last = rt.escalated.get(e.signature) ?? 0;
      if (Date.now() - last > 3600_000) {
        rt.escalated.set(e.signature, Date.now());
        if (!rt.cfg.dryRun) await postSlack(`:mag: StockX buyer: unknown failure x${e.count}: ${e.signature}\nsample: ${e.sampleDetail ?? ""}`).catch(
          () => false
        );
      }
    }
  } catch (e: any) {
    log(`learn error ${e?.message || e}`);
  }
}

async function handleOutcome(
  rt: Runtime,
  base: Pick<JobState, "key" | "source" | "orderRef" | "title">,
  out: JobOutcome
): Promise<void> {
  const next = applyOutcome(rt.states.get(base.key), base, out, Date.now());
  await persistState(rt, next);
  if (out.kind === "bought") rt.counters.bought += 1;
  else if (out.kind === "verdict") rt.counters.verdicts += 1;
  else if (out.kind === "retry") rt.counters.retries += 1;
  log(
    `${base.source} ${base.orderRef} ${(base.title || "").slice(0, 40)} → ${next.status} ${next.reason}` +
      (next.stockxOrderNumber ? ` ${next.stockxOrderNumber}` : "")
  );
  await learn(rt, base.key, out);
}

/** GOAT price watch. Returns true if the pair should wait (alert sent, inside the hold window). */
async function goatHold(
  rt: Runtime,
  p: {
    key: string;
    orderRef: string;
    title: string;
    sku: string | null;
    sizeEU: string;
    slug: string | null;
    saleChf: number | null;
    lane: "STANDARD" | "EXPRESS";
    stockxRefChf?: number | null;
  }
): Promise<boolean> {
  if (!rt.cfg.goatWatch) return false;
  const now = Date.now();
  const at = rt.alerted.get(p.key);
  if (at != null) return now - at < rt.cfg.goatHoldMs;
  let ref = p.stockxRefChf ?? null;
  if (ref == null && p.sku) {
    const pre = await precheckStockxBuyability({
      line: { sku: p.sku, sizeEU: p.sizeEU, title: p.title, saleChf: p.saleChf },
      desiredLane: p.lane,
    }).catch(() => null);
    ref = pre?.expectedBuyChf ?? null;
  }
  const v = await checkGoat({ sku: p.sku, sizeEU: p.sizeEU, title: p.title, slug: p.slug, stockxAllInChf: ref });
  if (v.kind !== "goat_cheaper") return false;
  rt.alerted.set(p.key, now);
  rt.counters.goatAlerts += 1;
  if (!rt.cfg.dryRun) await appendEvent({ t: now, ev: "note", msg: `goat_alert:${p.key}:${now}` });
  const text = goatAlertText({
    orderRef: p.orderRef,
    title: p.title,
    sizeEU: p.sizeEU,
    verdict: v,
    sizeUs: (v as { sizeUs?: string }).sizeUs,
    holdMinutes: Math.round(rt.cfg.goatHoldMs / 60_000),
  });
  log(text.replace(/\n/g, " | "));
  if (!rt.cfg.dryRun) await postSlack(`:moneybag: ${text}`).catch(() => false);
  return true;
}

async function killLeftoverChrome(): Promise<void> {
  for (const dir of PROFILE_DIRS) {
    const n = await killChromeForUserDataDir(dir).catch(() => 0);
    if (n > 0) log(`chrome hygiene: killed ${n} leftover process(es) for ${path.basename(dir)}`);
  }
}

function matchResult(
  jobs: ShopifyJob[],
  used: Set<number>,
  row: { orderName: string; slug: string; sizeEU: string }
): number {
  return jobs.findIndex(
    (j, i) =>
      !used.has(i) &&
      j.orderName === (row.orderName.startsWith("#") ? row.orderName : `#${row.orderName}`) &&
      j.slug === row.slug &&
      j.sizeEU === row.sizeEU
  );
}

async function shopifyPhase(rt: Runtime, ordered: ShopifyJob[]): Promise<number> {
  const batch: ShopifyJob[] = [];
  for (const j of ordered) {
    if (batch.length >= rt.cfg.batchSize) break;
    if (!(await isOn()) && !rt.cfg.once) break;
    if (await goatHold(rt, { ...j, lane: j.express ? "EXPRESS" : "STANDARD", slug: j.slug })) {
      log(`goat hold ${j.orderRef} (${j.title.slice(0, 40)})`);
      continue;
    }
    batch.push(j);
  }
  if (!batch.length) return 0;
  rt.phase = `shopify:${batch.map((b) => b.orderRef).join(",")}`;
  if (!rt.cfg.dryRun) {
    for (const j of batch) {
      await appendEvent({
        t: Date.now(),
        ev: "attempt",
        key: j.key,
        source: "shopify",
        orderRef: j.orderRef,
        title: j.title,
        sizeEU: j.sizeEU,
        slug: j.slug,
      });
    }
  }
  const items: ShopifyBatchBuyItem[] = batch.map((j) => ({
    orderName: j.orderName,
    slug: j.slug,
    sizeEU: j.sizeEU,
    lineItemId: j.lineItemId,
    allowRebuyOfCancelled: j.rebuyOfCancelled,
  }));
  const used = new Set<number>();
  try {
    const summary = await runShopifyBatchBuy({
      items,
      dryRun: rt.cfg.dryRun,
      confirmLive: !rt.cfg.dryRun,
      maxAllInChf: rt.cfg.maxAllInChf,
    });
    for (const row of summary.items) {
      const idx = matchResult(batch, used, row);
      if (idx < 0) continue;
      used.add(idx);
      const j = batch[idx]!;
      const r = row.result as RawCheckoutResult;
      await handleOutcome(rt, { key: j.key, source: "shopify", orderRef: j.orderRef, title: j.title }, classifyResult(r));
    }
    if (summary.stoppedOn402) await halt(rt, "proxy_402: LemonPrime out of credit");
  } catch (e: any) {
    rt.lastError = String(e?.message || e).slice(0, 300);
    log(`batch exception ${rt.lastError}`);
    for (let i = 0; i < batch.length; i += 1) {
      if (used.has(i)) continue;
      used.add(i);
      const j = batch[i]!;
      await handleOutcome(
        rt,
        { key: j.key, source: "shopify", orderRef: j.orderRef, title: j.title },
        classifyResult({ kind: "aborted", reason: "bot_fail", detail: `batch_exception: ${rt.lastError}` })
      );
    }
  } finally {
    await killLeftoverChrome();
  }
  // Jobs the batch never reached (it stops early on CF / 402): no try consumed, retry next cycle.
  for (let i = 0; i < batch.length; i += 1) {
    if (used.has(i)) continue;
    const j = batch[i]!;
    const prev = rt.states.get(j.key);
    if (prev) await persistState(rt, { ...prev, at: Date.now(), status: "retry", nextAttemptAt: Date.now() + 30_000 });
    else if (!rt.cfg.dryRun) await appendEvent({ t: Date.now(), ev: "release", key: j.key, by: "not_reached" });
  }
  return batch.length;
}

async function galaxusPhase(rt: Runtime): Promise<number> {
  const night = await loadNightState();
  const queue = await buildNightQueue({
    since: rt.cfg.galaxusSince,
    until: rt.cfg.galaxusUntil,
    skipOrders: rt.cfg.skipGalaxusOrders,
  });
  const todo = queue.filter((p) => !nightStateBlocks(night[pairKey(p)], Date.now()));
  if (!todo.length) return 0;
  log(`galaxus queue=${queue.length} todo=${todo.length}`);
  let done = 0;
  const isOnSup = async () => rt.cfg.once || (await isOn());
  for (const pair of todo.slice(0, rt.cfg.galaxusPerCycle)) {
    if (!(await isOnSup()) || (await isHalted()) || (await exists(NIGHT_HALT_FILE))) break;
    const key = jobKey("galaxus", { orderRef: pair.galaxusOrderId, lineId: pair.lineId, unitIndex: pair.unitIndex });
    rt.phase = `galaxus:${pair.galaxusOrderId}:${pair.unitIndex}`;
    if (await galaxusGoatHold(rt, pair, key)) continue;
    const before = night[pairKey(pair)];
    if (!rt.cfg.dryRun) {
      await appendEvent({
        t: Date.now(),
        ev: "attempt",
        key,
        source: "galaxus",
        orderRef: pair.galaxusOrderId,
        title: pair.productName,
      });
    }
    await processPair(pair, night, { isOn: isOnSup });
    await saveNightState(night);
    done += 1;
    const after = night[pairKey(pair)];
    if (after && after !== before) await mirrorGalaxus(rt, pair, key, after);
    await sleep(2_500);
  }
  await closeGalaxusSession().catch(() => undefined);
  await killLeftoverChrome();
  return done;
}

async function galaxusGoatHold(rt: Runtime, pair: NightPair, key: string): Promise<boolean> {
  if (!rt.cfg.goatWatch) return false;
  try {
    const r = await resolvePair(pair);
    if (!r.ok) return false;
    const c = r.candidate;
    return await goatHold(rt, {
      key,
      orderRef: pair.galaxusOrderId,
      title: pair.productName,
      sku: c.styleId,
      sizeEU: c.sizeEU,
      slug: c.slug,
      saleChf: c.sellChf,
      lane: c.desiredLaneHint,
      stockxRefChf: c.standardBuyChf ?? c.expressBuyChf ?? null,
    });
  } catch {
    return false;
  }
}

/** Night-buyer state → unified ledger + learnings. */
async function mirrorGalaxus(rt: Runtime, pair: NightPair, key: string, s: PairState): Promise<void> {
  const base = { key, source: "galaxus" as const, orderRef: pair.galaxusOrderId, title: pair.productName };
  let out: JobOutcome;
  if (s.status === "bought") {
    out = {
      kind: "bought",
      stockxOrderNumber: s.stockxOrderNumber || "?",
      totalChf: s.totalChf ?? null,
      lane: s.lane ?? null,
    };
  } else if (s.status === "done") out = { kind: "done", detail: s.reason };
  else if (s.status === "parked") out = { kind: "retry", reason: s.reason, detail: s.detail ?? null, rotateSession: false };
  else {
    out = {
      kind: "verdict",
      status: s.status === "too_expensive" || s.status === "no_sellers" || s.status === "not_stockx" ? s.status : "needs_review",
      reason: s.reason,
      detail: s.detail ?? null,
    };
  }
  await handleOutcome(rt, base, out);
}

async function exists(f: string): Promise<boolean> {
  return fs.stat(f).then(() => true).catch(() => false);
}

/** Crash recovery: an `attempt` with no result may have paid. Never rebuy blind. */
async function reconcileShopifyInflight(rt: Runtime, inflight: Awaited<ReturnType<typeof loadReduced>>["inflight"]): Promise<void> {
  for (const [key, a] of inflight) {
    if (a.source !== "shopify") continue;
    try {
      const hits = await findUnlinkedStockxMatches(
        {
          shopifyOrderName: a.orderRef,
          shopifyOrderId: "",
          shopifyLineItemId: key.replace(/\D/g, ""),
          shopifyCreatedAt: new Date(a.t - 3600_000).toISOString(),
          title: a.title,
          sku: null,
          sizeEU: a.sizeEU ?? null,
          urlKeyHint: a.slug ?? null,
        },
        { forceRefresh: true }
      );
      if (hits.length) {
        await persistState(rt, {
          key,
          status: "needs_review",
          reason: "inflight_possible_buy",
          detail: hits.map((h) => h.orderNumber).join(","),
          at: Date.now(),
          tries: 1,
          source: "shopify",
          orderRef: a.orderRef,
          title: a.title,
        });
        log(`inflight ${a.orderRef}: possible buy ${hits.map((h) => h.orderNumber).join(",")} → needs_review`);
      } else {
        await appendEvent({ t: Date.now(), ev: "release", key, by: "inflight_no_buy_found" });
      }
    } catch (e: any) {
      await persistState(rt, {
        key,
        status: "needs_review",
        reason: "inflight_unverifiable",
        detail: String(e?.message || e).slice(0, 200),
        at: Date.now(),
        tries: 1,
        source: "shopify",
        orderRef: a.orderRef,
        title: a.title,
      });
    }
  }
}

async function writeStatus(rt: Runtime, extra: Record<string, unknown> = {}): Promise<void> {
  await writeJsonAtomic(STATUS_FILE, {
    pid: process.pid,
    startedAt: new Date(rt.startedAt).toISOString(),
    heartbeat: new Date().toISOString(),
    phase: rt.phase,
    dryRun: rt.cfg.dryRun,
    halted: await readHalt(),
    counters: rt.counters,
    lastError: rt.lastError,
    ...extra,
  }).catch(() => undefined);
  await fs.writeFile(REPORT_FILE, renderReport(rt.states), "utf8").catch(() => undefined);
}

export type CycleResult = { shopifyTried: number; galaxusTried: number; shopifyQueue: number; rebuyQueue: number };

/** One pass. Exported so the CLI (--once) and tests can drive it. */
export async function runCycle(rt: Runtime): Promise<CycleResult> {
  const cfg = rt.cfg;
  const now = Date.now();
  let shopifyTried = 0;
  let galaxusTried = 0;
  let shopifyQueue = 0;

  if (cfg.rebuy && now - rt.lastRebuyAt > cfg.rebuyEveryMs) {
    rt.lastRebuyAt = now;
    rt.phase = "rebuy-sweep";
    rt.rebuyJobs = await buildCancelRebuyJobs({ log }).catch((e) => {
      log(`rebuy sweep failed ${e?.message || e}`);
      return [];
    });
    if (cfg.onlyOrders) rt.rebuyJobs = rt.rebuyJobs.filter((j) => cfg.onlyOrders!.has(j.orderName));
    if (rt.rebuyJobs.length) log(`rebuy sweep: ${rt.rebuyJobs.length} cancelled pair(s) to rebuy`);
  }

  if (cfg.shopify) {
    rt.phase = "shopify-queue";
    const open = await buildShopifyJobs({
      since: cfg.shopifySince,
      only: cfg.onlyOrders,
      log,
      stopAfterJobs: cfg.batchSize * 3,
    });
    const all = [...rt.rebuyJobs, ...open].filter((j) => !stateBlocks(rt.states.get(j.key), Date.now()));
    shopifyQueue = all.length;
    // Rebuys rank with Express: the customer is already waiting.
    const ordered = orderQueue(
      all.map((j) => ({ ...j, express: j.express || j.rebuyOfCancelled })) as Array<ShopifyJob & { express: boolean }>
    );
    log(`shopify queue=${ordered.length} (express/rebuy first)`);
    if (ordered.length) shopifyTried = await shopifyPhase(rt, ordered);
  }

  if (cfg.galaxus && !(await isHalted()) && !(await exists(NIGHT_HALT_FILE)) && (cfg.once || (await isOn()))) {
    galaxusTried = await galaxusPhase(rt);
  }
  rt.phase = "idle";
  await writeStatus(rt, { shopifyQueue, rebuyQueue: rt.rebuyJobs.length });
  return { shopifyTried, galaxusTried, shopifyQueue, rebuyQueue: rt.rebuyJobs.length };
}

export function createRuntime(cfg: SupervisorConfig, states: Map<string, JobState> = new Map()): Runtime {
  return {
    cfg,
    states,
    alerted: new Map(),
    counters: { bought: 0, verdicts: 0, retries: 0, halts: 0, goatAlerts: 0 },
    phase: "start",
    startedAt: Date.now(),
    lastRebuyAt: 0,
    rebuyJobs: [],
    escalated: new Map(),
    lastError: null,
  };
}

export async function runSupervisor(cfg: SupervisorConfig): Promise<void> {
  if (!(await acquireSingleInstanceLock())) {
    log("another buyer is alive (lock). exit.");
    return;
  }
  await fs.mkdir(BUYER_DIR, { recursive: true });
  const reduced = await loadReduced();
  const rt = createRuntime(cfg, reduced.states);
  // Rebuild GOAT alert memory from the ledger notes.
  const { readEvents } = await import("@/lib/stockxBuyer/ledger");
  for (const e of await readEvents()) {
    if (e.ev === "note" && e.msg.startsWith("goat_alert:")) {
      const i = e.msg.lastIndexOf(":");
      rt.alerted.set(e.msg.slice("goat_alert:".length, i), Number(e.msg.slice(i + 1)));
    }
  }
  log(`start dry=${cfg.dryRun} shopify=${cfg.shopify} galaxus=${cfg.galaxus} rebuy=${cfg.rebuy} batch=${cfg.batchSize}`);
  try {
    await killLeftoverChrome();
    await reconcileShopifyInflight(rt, reduced.inflight);
    await reconcileInflight().catch((e) => log(`galaxus reconcile: ${e?.message || e}`));
    for (;;) {
      if (!cfg.once && !(await isOn())) {
        log("stopped: buyer.on removed");
        break;
      }
      if ((await isHalted()) || (await exists(NIGHT_HALT_FILE))) {
        log(`halted: ${(await readHalt()) ?? "night-buyer halt"}`);
        if (await autoHealHalt().catch(() => false)) continue;
        if (cfg.once) break;
        await writeStatus(rt);
        await sleep(60_000);
        continue;
      }
      let res: CycleResult;
      try {
        res = await runCycle(rt);
      } catch (e: any) {
        rt.lastError = String(e?.message || e).slice(0, 300);
        log(`cycle error ${rt.lastError}`);
        await killLeftoverChrome();
        await closeGalaxusSession().catch(() => undefined);
        await writeStatus(rt);
        await sleep(30_000);
        continue;
      }
      if (cfg.once) break;
      if (!res.shopifyTried && !res.galaxusTried) await sleep(cfg.idleMs);
      else await sleep(3_000);
    }
  } finally {
    await closeGalaxusSession().catch(() => undefined);
    await killLeftoverChrome();
    await writeStatus(rt, { stopped: true });
    await releaseLock();
  }
}
