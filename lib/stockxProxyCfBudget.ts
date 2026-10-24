/**
 * Cap LemonPrime sticky rotates that hit Cloudflare challenges.
 * Each rotate loads challenges.cloudflare.com JS (~hundreds of MB) — GB killer.
 *
 * Budget: ≤2 CF sticky-rotates / rolling hour (process-wide, file-backed).
 */
import fs from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), ".data");
const BUDGET_FILE = path.join(DATA_DIR, "stockx-proxy-cf-rotates.json");
const WINDOW_MS = 60 * 60 * 1000;
/** Remint must not sticky-rotate on CF more than this many times per hour. */
export const STOCKX_CF_ROTATE_BUDGET_PER_HOUR = 2;

type BudgetState = { rotates: string[] };

async function readBudget(): Promise<BudgetState> {
  try {
    const raw = JSON.parse(await fs.readFile(BUDGET_FILE, "utf8")) as BudgetState;
    const cutoff = Date.now() - WINDOW_MS;
    const rotates = (raw.rotates || []).filter((iso) => {
      const t = Date.parse(iso);
      return Number.isFinite(t) && t >= cutoff;
    });
    return { rotates };
  } catch {
    return { rotates: [] };
  }
}

async function writeBudget(state: BudgetState): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(BUDGET_FILE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

/** How many CF sticky-rotates remain in the current hour window. */
export async function stockxCfRotateBudgetRemaining(): Promise<number> {
  const { rotates } = await readBudget();
  return Math.max(0, STOCKX_CF_ROTATE_BUDGET_PER_HOUR - rotates.length);
}

/**
 * Try to spend one CF sticky-rotate slot. Returns false when budget exhausted —
 * caller must fail the remint instead of opening another sticky.
 */
export async function tryConsumeStockxCfRotateBudget(reason: string): Promise<boolean> {
  const state = await readBudget();
  if (state.rotates.length >= STOCKX_CF_ROTATE_BUDGET_PER_HOUR) {
    console.warn(
      `[STOCKX-PROXY-CF] rotate budget exhausted (${STOCKX_CF_ROTATE_BUDGET_PER_HOUR}/h) — refuse rotate reason=${reason}`
    );
    return false;
  }
  state.rotates.push(new Date().toISOString());
  await writeBudget(state);
  console.warn(
    `[STOCKX-PROXY-CF] rotate consumed ${state.rotates.length}/${STOCKX_CF_ROTATE_BUDGET_PER_HOUR} reason=${reason}`
  );
  return true;
}
