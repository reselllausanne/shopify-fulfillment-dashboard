import { describe, expect, it } from "vitest";
import { galaxusDelayCutoff } from "./delayCutoff";

describe("galaxusDelayCutoff", () => {
  const start = new Date("2026-11-12T00:00:00+01:00");
  it("inactive before start date", () => {
    expect(galaxusDelayCutoff(new Date("2026-11-11T23:00:00+01:00"), 2, start)).toBeNull();
  });
  it("Nov 12 with 2 days → buys up to Nov 9 inclusive (cutoff Nov 10 00:00 Zurich)", () => {
    const c = galaxusDelayCutoff(new Date("2026-11-12T09:00:00+01:00"), 2, start)!;
    expect(c.toISOString()).toBe("2026-11-09T23:00:00.000Z");
  });
  it("0 days disables", () => {
    expect(galaxusDelayCutoff(new Date("2026-11-12T09:00:00+01:00"), 0, start)).toBeNull();
  });
});
