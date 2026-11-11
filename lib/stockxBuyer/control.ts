/**
 * Control surface shared by the CLI and the MCP server. Everything here is cheap and
 * side-effect-light; the heavy buying happens in the supervisor process.
 */
import fs from "node:fs/promises";
import { prisma } from "@/app/lib/prisma";
import {
  BUYER_DIR,
  HALT_FILE,
  ON_FILE,
  STATUS_FILE,
  appendEvent,
  clearHalt,
  haltBuyer,
  loadReduced,
  readHalt,
  readJson,
  renderReport,
} from "@/lib/stockxBuyer/ledger";
import { readLearnings, renderLearnings, summarizeLearnings } from "@/lib/stockxBuyer/learnings";
import { RECHECK_MS, stateBlocks, type JobState } from "@/lib/stockxBuyer/policy";
import { buildCancelRebuyJobs, buildShopifyJobs, normName } from "@/lib/stockxBuyer/shopifyQueue";
import { configFromEnv } from "@/lib/stockxBuyer/supervisor";
import { checkGoat, goatCostModelFromEnv } from "@/lib/stockxBuyer/goatWatch";
import { isChromeUsingProfile, killChromeForUserDataDir } from "@/lib/stockxBrowserProcess";
import path from "node:path";
import { spawn } from "node:child_process";

const DATA_DIR = process.env.NIGHT_BUYER_DATA_DIR || path.join(process.cwd(), ".data");
const PROFILES = {
  shopify: path.join(DATA_DIR, "stockx-profile"),
  galaxus: path.join(DATA_DIR, "stockx-profile-galaxus"),
};

const exists = (f: string) => fs.stat(f).then(() => true).catch(() => false);

export async function status() {
  const st = await readJson<Record<string, unknown>>(STATUS_FILE, {});
  const heartbeat = st.heartbeat ? Date.parse(String(st.heartbeat)) : 0;
  const reduced = await loadReduced();
  const counts: Record<string, number> = {};
  for (const s of reduced.states.values()) counts[s.status] = (counts[s.status] ?? 0) + 1;
  return {
    on: await exists(ON_FILE),
    halted: await readHalt(),
    alive: heartbeat > 0 && Date.now() - heartbeat < 5 * 60_000,
    heartbeatAgeSec: heartbeat ? Math.round((Date.now() - heartbeat) / 1000) : null,
    worker: st,
    jobs: counts,
    inflight: [...reduced.inflight.keys()],
    chrome: {
      shopifyProfileInUse: await isChromeUsingProfile(PROFILES.shopify),
      galaxusProfileInUse: await isChromeUsingProfile(PROFILES.galaxus),
    },
  };
}

export async function startBuyer(): Promise<string> {
  await fs.mkdir(BUYER_DIR, { recursive: true });
  await fs.writeFile(ON_FILE, `${new Date().toISOString()}\n`, "utf8");
  return "buyer.on written. Worker starts within ~1 min (entrypoint loop) or run: npx tsx scripts/stockx-buyer.ts run";
}

export async function stopBuyer(): Promise<string> {
  await fs.rm(ON_FILE, { force: true });
  return "buyer.on removed. Worker finishes the current pair, then exits.";
}

export async function haltNow(reason: string): Promise<string> {
  await haltBuyer(`manual: ${reason}`);
  return `halted: ${reason}`;
}

export async function resume(): Promise<string> {
  await clearHalt();
  await fs.rm(path.join(DATA_DIR, "night-buyer.halt"), { force: true });
  return "halt cleared";
}

/** Manual hold (e.g. buying on GOAT by hand). Survives restarts: `held` never expires. */
export async function hold(key: string, reason: string): Promise<JobState> {
  const state: JobState = {
    key,
    status: "held",
    reason: `manual_hold:${reason}`,
    at: Date.now(),
    tries: 0,
    source: key.startsWith("galaxus") ? "galaxus" : "shopify",
    orderRef: key,
  };
  await appendEvent({ t: Date.now(), ev: "state", state });
  return state;
}

export async function release(key: string): Promise<string> {
  await appendEvent({ t: Date.now(), ev: "release", key, by: "manual" });
  return `released ${key}`;
}

/** Hold every open line of a Shopify order by name (#7707). */
export async function holdOrder(orderName: string, reason: string): Promise<string[]> {
  const jobs = await buildShopifyJobs({
    since: new Date("2026-10-01T00:00:00+02:00"),
    only: new Set([normName(orderName)]),
  });
  const keys: string[] = [];
  for (const j of jobs) {
    await hold(j.key, reason);
    keys.push(j.key);
  }
  return keys;
}

export async function queue(opts: { limit?: number } = {}) {
  const cfg = configFromEnv();
  const reduced = await loadReduced();
  const open = await buildShopifyJobs({ since: cfg.shopifySince, maxApiLoads: 5 });
  const rebuy = await buildCancelRebuyJobs({}).catch(() => []);
  const now = Date.now();
  const rows = [...rebuy, ...open].map((j) => {
    const st = reduced.states.get(j.key);
    return {
      key: j.key,
      order: j.orderRef,
      title: j.title.slice(0, 60),
      sizeEU: j.sizeEU,
      express: j.express,
      rebuy: j.rebuyOfCancelled,
      state: st ? `${st.status}${stateBlocks(st, now) ? " (blocked)" : ""}` : "new",
      reason: st?.reason ?? null,
    };
  });
  return rows.slice(0, opts.limit ?? 100);
}

export async function explain(key: string) {
  const reduced = await loadReduced();
  const st = reduced.states.get(key);
  const learnings = (await readLearnings()).filter((l) => l.key === key).slice(-8);
  return {
    key,
    state: st ?? null,
    blocksUntil: st && Number.isFinite(RECHECK_MS[st.status]) ? new Date(st.at + RECHECK_MS[st.status]).toISOString() : null,
    inflight: reduced.inflight.get(key) ?? null,
    learnings,
  };
}

export async function learnings() {
  return renderLearnings(summarizeLearnings(await readLearnings()));
}

export async function report() {
  return renderReport((await loadReduced()).states);
}

/** Close leftover Chrome for the buyer profiles. Never touches any other Chrome. */
export async function chromeHygiene(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [name, dir] of Object.entries(PROFILES)) out[name] = await killChromeForUserDataDir(dir);
  return out;
}

/** Ad-hoc GOAT price check for one style id + EU size. */
export async function goat(sku: string, sizeEU: string, stockxAllInChf: number | null) {
  return checkGoat({ sku, sizeEU, stockxAllInChf, model: goatCostModelFromEnv() });
}

/** Cheap DB-only look: who bought what for an order name. */
export async function orderLinks(orderName: string) {
  const name = normName(orderName);
  return prisma.orderMatch.findMany({
    where: { shopifyOrderName: name },
    select: { shopifyLineItemId: true, stockxOrderNumber: true, stockxStatus: true, shopifyProductTitle: true, shopifySizeEU: true },
  });
}

export { HALT_FILE };

/**
 * Fire-and-forget targeted run (`once`) in a detached process, e.g. buy #7661 now.
 * Fails fast if the worker holds the single-instance lock (the child exits on its own).
 */
export async function runOnce(opts: { orders?: string[]; dry?: boolean; shopifyOnly?: boolean }): Promise<{ pid: number | undefined; log: string }> {
  await fs.mkdir(BUYER_DIR, { recursive: true });
  const log = path.join(BUYER_DIR, `once-${Date.now()}.log`);
  const fd = await fs.open(log, "a");
  const args = ["tsx", "scripts/stockx-buyer.ts", "once"];
  if (opts.dry) args.push("--dry");
  if (opts.shopifyOnly) args.push("--no-galaxus");
  if (opts.orders?.length) args.push(`--orders=${opts.orders.join(",")}`);
  const child = spawn("npx", args, { detached: true, stdio: ["ignore", fd.fd, fd.fd], cwd: process.cwd() });
  child.unref();
  await fd.close();
  return { pid: child.pid, log };
}
