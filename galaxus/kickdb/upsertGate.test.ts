import { describe, expect, it } from "vitest";
import { createUpsertGate } from "./upsertGate";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("createUpsertGate", () => {
  it("runs up to concurrency, then returns busy", async () => {
    const gate = createUpsertGate({ concurrency: 1, maxWaiting: 0 });
    let released = false;
    const first = gate.run(async () => {
      while (!released) await delay(10);
      return "ok";
    });
    await delay(20);
    const busy = await gate.run(async () => "nope");
    expect(busy).toEqual({ ok: false, busy: true });
    released = true;
    await expect(first).resolves.toEqual({ ok: true, value: "ok" });
  });

  it("queues waiters up to maxWaiting then serializes", async () => {
    const gate = createUpsertGate({ concurrency: 1, maxWaiting: 2 });
    const order: number[] = [];
    const jobs = [0, 1, 2].map((i) =>
      gate.run(async () => {
        order.push(i);
        await delay(15);
        return i;
      })
    );
    const results = await Promise.all(jobs);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(order).toEqual([0, 1, 2]);
  });
});
