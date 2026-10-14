import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ShopifyRateLimiter } from "@/lib/shopifyAdmin";
import {
  computeAdmissionWaitMs,
  debitState,
  effectiveReserve,
  FileThrottleStore,
  formatShopifyApiMetrics,
  emptyShopifyApiMetrics,
  MemoryThrottleStore,
  projectAvailable,
  stateFromThrottleStatus,
  type ShopifyThrottleState,
} from "@/lib/shopifyThrottle";

const state = (available: number, updatedAtMs = 0): ShopifyThrottleState => ({
  available,
  maximumAvailable: 2000,
  restoreRate: 100,
  updatedAtMs,
});

describe("projectAvailable", () => {
  it("restores at restoreRate and caps at maximum", () => {
    expect(projectAvailable(state(0), 1000)).toBe(100);
    expect(projectAvailable(state(1950), 10_000)).toBe(2000);
  });
  it("assumes a full default bucket without prior state", () => {
    expect(projectAvailable(null, 123)).toBe(2000);
  });
});

describe("computeAdmissionWaitMs", () => {
  it("admits when available - cost >= reserve", () => {
    expect(computeAdmissionWaitMs({ state: state(1000), nowMs: 0, cost: 200, reserve: 800 })).toBe(0);
  });
  it("waits for the deficit at restore rate before sending (no THROTTLED first)", () => {
    expect(computeAdmissionWaitMs({ state: state(900), nowMs: 0, cost: 200, reserve: 800 })).toBe(1000);
  });
  it("counts elapsed restore time", () => {
    expect(computeAdmissionWaitMs({ state: state(900), nowMs: 1000, cost: 200, reserve: 800 })).toBe(0);
  });
  it("interactive calls (reserve 0) only need the cost", () => {
    expect(computeAdmissionWaitMs({ state: state(150), nowMs: 0, cost: 100, reserve: 0 })).toBe(0);
    expect(computeAdmissionWaitMs({ state: state(50), nowMs: 0, cost: 100, reserve: 0 })).toBe(500);
  });
  it("never deadlocks when cost + reserve exceeds the bucket", () => {
    expect(effectiveReserve(state(0), 1500, 800)).toBe(500);
    expect(computeAdmissionWaitMs({ state: state(2000), nowMs: 0, cost: 1500, reserve: 800 })).toBe(0);
  });
});

describe("debitState / stateFromThrottleStatus", () => {
  it("debits the projected value", () => {
    expect(debitState(state(500), 1000, 300)).toEqual(state(300, 1000));
  });
  it("parses Shopify throttleStatus", () => {
    expect(stateFromThrottleStatus({ currentlyAvailable: 42, maximumAvailable: 2000, restoreRate: 100 }, 5)).toEqual(
      state(42, 5)
    );
    expect(stateFromThrottleStatus(undefined, 5)).toBeNull();
  });
});

describe("ShopifyRateLimiter", () => {
  function fakeClock() {
    let now = 0;
    const sleeps: number[] = [];
    return {
      now: () => now,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        now += ms;
      },
      sleeps,
    };
  }

  it("sends immediately with headroom and debits the cost", async () => {
    const store = new MemoryThrottleStore();
    store.write(state(2000));
    const clock = fakeClock();
    const limiter = new ShopifyRateLimiter(store, clock);
    expect(await limiter.acquire(300, 800)).toBe(0);
    expect(store.read()?.available).toBe(1700);
  });

  it("waits before the first request when the bucket is below reserve", async () => {
    const store = new MemoryThrottleStore();
    store.write(state(0));
    const clock = fakeClock();
    const limiter = new ShopifyRateLimiter(store, clock);
    const waited = await limiter.acquire(200, 800);
    expect(waited).toBeGreaterThanOrEqual(10_000);
    expect(clock.sleeps.every((ms) => ms <= 5000)).toBe(true);
    expect(store.read()!.available).toBeGreaterThanOrEqual(800);
  });

  it("sequential callers sharing a store pace to the restore rate", async () => {
    const store = new MemoryThrottleStore();
    store.write(state(800));
    const clock = fakeClock();
    const a = new ShopifyRateLimiter(store, clock);
    const b = new ShopifyRateLimiter(store, clock);
    for (let i = 0; i < 10; i += 1) await (i % 2 ? a : b).acquire(100, 800);
    // 10 × 100 pts at 100 pts/s with zero headroom ≈ 10 s
    expect(clock.now()).toBeGreaterThanOrEqual(9_900);
    expect(clock.now()).toBeLessThan(11_000);
  });

  it("observe() overwrites the estimate with the server value", () => {
    const store = new MemoryThrottleStore();
    const limiter = new ShopifyRateLimiter(store, fakeClock());
    limiter.observe({ cost: { throttleStatus: { currentlyAvailable: 77, maximumAvailable: 2000, restoreRate: 100 } } });
    expect(store.read()?.available).toBe(77);
  });
});

describe("FileThrottleStore", () => {
  it("shares state between instances (processes) via the file", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "shopify-throttle-")), "state.json");
    const a = new FileThrottleStore(file);
    const b = new FileThrottleStore(file);
    expect(b.read()).toBeNull();
    a.write(state(123, 9));
    expect(b.read()).toEqual(state(123, 9));
  });
});

describe("formatShopifyApiMetrics", () => {
  it("reports points/s and THROTTLED count", () => {
    const m = { ...emptyShopifyApiMetrics(0), pointsActual: 1000, throttled: 3 };
    const line = formatShopifyApiMetrics(m, 10_000);
    expect(line).toContain("ptsPerSec=100.0");
    expect(line).toContain("throttled=3");
  });
});
