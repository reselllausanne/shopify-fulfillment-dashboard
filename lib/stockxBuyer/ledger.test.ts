import { describe, expect, it } from "vitest";
import { parseEvents, reduceEvents, renderReport, type LedgerEvent } from "@/lib/stockxBuyer/ledger";
import type { JobState } from "@/lib/stockxBuyer/policy";

const st = (key: string, status: JobState["status"], extra: Partial<JobState> = {}): JobState => ({
  key,
  status,
  reason: "r",
  at: 1,
  tries: 1,
  ...extra,
});

describe("ledger", () => {
  it("tolerates a torn last line", () => {
    const raw = `${JSON.stringify({ t: 1, ev: "note", msg: "a" })}\n{"t":2,"ev":"no`;
    expect(parseEvents(raw)).toHaveLength(1);
  });

  it("latest state wins; attempt without result stays in flight", () => {
    const events: LedgerEvent[] = [
      { t: 1, ev: "attempt", key: "k1", source: "shopify", orderRef: "#1", title: "t" },
      { t: 2, ev: "state", state: st("k1", "retry") },
      { t: 3, ev: "state", state: st("k1", "bought", { stockxOrderNumber: "03-X" }) },
      { t: 4, ev: "attempt", key: "k2", source: "shopify", orderRef: "#2", title: "t2" },
    ];
    const r = reduceEvents(events);
    expect(r.states.get("k1")?.status).toBe("bought");
    expect([...r.inflight.keys()]).toEqual(["k2"]);
  });

  it("release removes a hold", () => {
    const r = reduceEvents([
      { t: 1, ev: "state", state: st("k", "held") },
      { t: 2, ev: "release", key: "k", by: "manual" },
    ]);
    expect(r.states.has("k")).toBe(false);
  });

  it("report groups by status", () => {
    const m = new Map<string, JobState>([
      ["a", st("a", "bought", { orderRef: "#1", source: "shopify", stockxOrderNumber: "03-A", totalChf: 100 })],
      ["b", st("b", "held", { orderRef: "#7707", source: "shopify" })],
    ]);
    const md = renderReport(m, 0);
    expect(md).toContain("## Bought (1)");
    expect(md).toContain("03-A");
    expect(md).toContain("## Held (GOAT / manual) (1)");
  });
});
