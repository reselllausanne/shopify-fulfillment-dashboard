// lib/shopifyThrottle.ts
//
// Cost-aware admission control for the Shopify Admin GraphQL leaky bucket.
// Every app token has one bucket shared by every process using it, so the
// limiter checks the (projected) bucket BEFORE each request instead of only
// backing off after THROTTLED.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type ShopifyThrottleState = {
  available: number;
  maximumAvailable: number;
  restoreRate: number;
  updatedAtMs: number;
};

export interface ShopifyThrottleStore {
  read(): ShopifyThrottleState | null;
  write(state: ShopifyThrottleState): void;
}

/** Standard plan defaults; replaced by the first real `throttleStatus`. */
export const DEFAULT_THROTTLE_STATE: Omit<ShopifyThrottleState, "updatedAtMs"> = {
  available: 2000,
  maximumAvailable: 2000,
  restoreRate: 100,
};

export function projectAvailable(state: ShopifyThrottleState | null, nowMs: number): number {
  const s = state ?? { ...DEFAULT_THROTTLE_STATE, updatedAtMs: nowMs };
  const elapsedMs = Math.max(0, nowMs - s.updatedAtMs);
  return Math.min(s.maximumAvailable, s.available + (s.restoreRate * elapsedMs) / 1000);
}

/** Reserve can never make a request unsendable: cost + reserve is capped at the bucket size. */
export function effectiveReserve(state: ShopifyThrottleState | null, cost: number, reserve: number): number {
  const max = state?.maximumAvailable ?? DEFAULT_THROTTLE_STATE.maximumAvailable;
  return Math.max(0, Math.min(reserve, max - cost));
}

/** 0 = send now; otherwise ms until `available - cost >= reserve` by restore rate. */
export function computeAdmissionWaitMs(input: {
  state: ShopifyThrottleState | null;
  nowMs: number;
  cost: number;
  reserve: number;
}): number {
  const cost = Math.max(0, input.cost);
  const reserve = effectiveReserve(input.state, cost, Math.max(0, input.reserve));
  const deficit = cost + reserve - projectAvailable(input.state, input.nowMs);
  if (deficit <= 0) return 0;
  const restoreRate = Math.max(1, input.state?.restoreRate ?? DEFAULT_THROTTLE_STATE.restoreRate);
  return Math.ceil((deficit / restoreRate) * 1000);
}

/** Optimistic debit so concurrent callers see the points as already spent. */
export function debitState(
  state: ShopifyThrottleState | null,
  nowMs: number,
  cost: number
): ShopifyThrottleState {
  const base = state ?? { ...DEFAULT_THROTTLE_STATE, updatedAtMs: nowMs };
  return {
    available: projectAvailable(base, nowMs) - Math.max(0, cost),
    maximumAvailable: base.maximumAvailable,
    restoreRate: base.restoreRate,
    updatedAtMs: nowMs,
  };
}

export function stateFromThrottleStatus(
  status: { currentlyAvailable?: number; maximumAvailable?: number; restoreRate?: number } | undefined,
  nowMs: number
): ShopifyThrottleState | null {
  if (!status || status.currentlyAvailable == null) return null;
  return {
    available: Number(status.currentlyAvailable),
    maximumAvailable: Number(status.maximumAvailable ?? DEFAULT_THROTTLE_STATE.maximumAvailable),
    restoreRate: Number(status.restoreRate ?? DEFAULT_THROTTLE_STATE.restoreRate),
    updatedAtMs: nowMs,
  };
}

export class MemoryThrottleStore implements ShopifyThrottleStore {
  private state: ShopifyThrottleState | null = null;
  read(): ShopifyThrottleState | null {
    return this.state;
  }
  write(state: ShopifyThrottleState): void {
    this.state = state;
  }
}

/**
 * Shares the bucket estimate between processes on the same filesystem (the
 * worker container spawns its passes as child processes). Atomic rename, no
 * lock: two readers can both admit, which the reserve absorbs.
 */
export class FileThrottleStore implements ShopifyThrottleStore {
  private memory = new MemoryThrottleStore();
  constructor(private readonly filePath: string) {}

  read(): ShopifyThrottleState | null {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as ShopifyThrottleState;
      if (
        [parsed.available, parsed.maximumAvailable, parsed.restoreRate, parsed.updatedAtMs].every(
          (n) => typeof n === "number" && Number.isFinite(n)
        )
      ) {
        return parsed;
      }
    } catch {
      /* missing / partial file → fall back to this process's view */
    }
    return this.memory.read();
  }

  write(state: ShopifyThrottleState): void {
    this.memory.write(state);
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(state));
      fs.renameSync(tmp, this.filePath);
    } catch {
      /* read-only fs etc. → per-process only */
    }
  }
}

export function defaultThrottleStateFile(shop: string, token: string): string {
  const key = crypto.createHash("sha256").update(`${shop}|${token}`).digest("hex").slice(0, 16);
  return path.join(os.tmpdir(), `shopify-throttle-${key}.json`);
}

export function createThrottleStore(shop: string, token: string): ShopifyThrottleStore {
  const shared = String(process.env.SHOPIFY_THROTTLE_SHARED ?? "1").trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(shared)) return new MemoryThrottleStore();
  const file = process.env.SHOPIFY_THROTTLE_STATE_FILE?.trim() || defaultThrottleStateFile(shop, token);
  return new FileThrottleStore(file);
}

export function envReservePoints(): number {
  const n = Number(process.env.SHOPIFY_API_RESERVE_POINTS ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export type ShopifyApiMetrics = {
  requests: number;
  throttled: number;
  transportRetries: number;
  pointsRequested: number;
  pointsActual: number;
  admissionWaitMs: number;
  minAvailableSeen: number | null;
  startedAtMs: number;
};

export function emptyShopifyApiMetrics(nowMs = Date.now()): ShopifyApiMetrics {
  return {
    requests: 0,
    throttled: 0,
    transportRetries: 0,
    pointsRequested: 0,
    pointsActual: 0,
    admissionWaitMs: 0,
    minAvailableSeen: null,
    startedAtMs: nowMs,
  };
}

export function formatShopifyApiMetrics(m: ShopifyApiMetrics, nowMs = Date.now()): string {
  const secs = Math.max(1, (nowMs - m.startedAtMs) / 1000);
  return [
    `requests=${m.requests}`,
    `throttled=${m.throttled}`,
    `transportRetries=${m.transportRetries}`,
    `pointsActual=${Math.round(m.pointsActual)}`,
    `pointsRequested=${Math.round(m.pointsRequested)}`,
    `ptsPerSec=${(m.pointsActual / secs).toFixed(1)}`,
    `waitSec=${(m.admissionWaitMs / 1000).toFixed(0)}`,
    `minAvailable=${m.minAvailableSeen == null ? "n/a" : Math.round(m.minAvailableSeen)}`,
    `elapsedSec=${secs.toFixed(0)}`,
  ].join(" ");
}
