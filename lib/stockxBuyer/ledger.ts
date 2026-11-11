/**
 * Append-only JSONL ledger for the StockX buyer.
 * One line per event. State = reduce(events). A crash can never corrupt past lines,
 * and an `attempt` without a matching result tells us a buy may be in flight.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { BuySource, JobState } from "@/lib/stockxBuyer/policy";

export const BUYER_DIR = process.env.STOCKX_BUYER_DIR || path.join(process.cwd(), ".data", "stockx-buyer");
export const LEDGER_FILE = path.join(BUYER_DIR, "ledger.jsonl");
export const STATUS_FILE = path.join(BUYER_DIR, "status.json");
export const REPORT_FILE = path.join(BUYER_DIR, "report.md");
export const ON_FILE = path.join(BUYER_DIR, "buyer.on");
export const HALT_FILE = path.join(BUYER_DIR, "buyer.halt");

export type LedgerEvent =
  | {
      t: number;
      ev: "attempt";
      key: string;
      source: BuySource;
      orderRef: string;
      title: string;
      sizeEU?: string | null;
      slug?: string | null;
      lane?: string | null;
    }
  | { t: number; ev: "state"; state: JobState }
  | { t: number; ev: "release"; key: string; by: string }
  | { t: number; ev: "note"; msg: string };

export async function appendEvent(ev: LedgerEvent, file = LEDGER_FILE): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${JSON.stringify(ev)}\n`, "utf8");
}

export async function readEvents(file = LEDGER_FILE): Promise<LedgerEvent[]> {
  let raw = "";
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return [];
  }
  return parseEvents(raw);
}

/** Pure: tolerate a torn last line. */
export function parseEvents(raw: string): LedgerEvent[] {
  const out: LedgerEvent[] = [];
  for (const line of raw.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      out.push(JSON.parse(s) as LedgerEvent);
    } catch {
      /* torn line */
    }
  }
  return out;
}

export type Reduced = {
  states: Map<string, JobState>;
  /** Attempts with no later state event: a buy may have been in flight when we died. */
  inflight: Map<string, Extract<LedgerEvent, { ev: "attempt" }>>;
};

/** Pure: fold events into current state. `release` drops a held/blocked key. */
export function reduceEvents(events: LedgerEvent[]): Reduced {
  const states = new Map<string, JobState>();
  const inflight = new Map<string, Extract<LedgerEvent, { ev: "attempt" }>>();
  for (const e of events) {
    if (e.ev === "attempt") inflight.set(e.key, e);
    else if (e.ev === "state") {
      states.set(e.state.key, e.state);
      inflight.delete(e.state.key);
    } else if (e.ev === "release") {
      states.delete(e.key);
      inflight.delete(e.key);
    }
  }
  return { states, inflight };
}

export async function loadReduced(file = LEDGER_FILE): Promise<Reduced> {
  return reduceEvents(await readEvents(file));
}

async function exists(f: string): Promise<boolean> {
  return fs.stat(f).then(() => true).catch(() => false);
}

export const isOn = () => exists(ON_FILE);
export const isHalted = () => exists(HALT_FILE);

export async function haltBuyer(reason: string): Promise<void> {
  await fs.mkdir(BUYER_DIR, { recursive: true });
  await fs.writeFile(HALT_FILE, `${new Date().toISOString()} ${reason}\n`, "utf8");
}

export async function clearHalt(): Promise<void> {
  await fs.rm(HALT_FILE, { force: true });
}

export async function readHalt(): Promise<string | null> {
  return fs.readFile(HALT_FILE, "utf8").then((s) => s.trim(), () => null);
}

export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 1), "utf8");
  await fs.rename(tmp, file);
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** Pure: Markdown report so the user wakes up to one readable page. */
export function renderReport(states: Map<string, JobState>, now = Date.now()): string {
  const rows = [...states.values()];
  const by = (s: string) => rows.filter((r) => r.status === s);
  const line = (r: JobState) =>
    `- ${r.source ?? "?"} ${r.orderRef ?? r.key} ${r.title ? `· ${r.title.slice(0, 60)}` : ""} · ${r.reason}` +
    (r.stockxOrderNumber ? ` · ${r.stockxOrderNumber}` : "") +
    (r.totalChf ? ` · ${r.totalChf} CHF` : "");
  const sections: Array<[string, string]> = [
    ["Bought", "bought"],
    ["Held (GOAT / manual)", "held"],
    ["Needs review", "needs_review"],
    ["Too expensive", "too_expensive"],
    ["Sold out (no sellers)", "no_sellers"],
    ["Parked (retries exhausted)", "parked"],
    ["Retrying", "retry"],
    ["Not on StockX", "not_stockx"],
  ];
  const parts = [`# StockX buyer report\n\nUpdated ${new Date(now).toISOString()}\n`];
  for (const [title, st] of sections) {
    const list = by(st);
    parts.push(`## ${title} (${list.length})\n${list.map(line).join("\n") || "_none_"}\n`);
  }
  return parts.join("\n");
}
