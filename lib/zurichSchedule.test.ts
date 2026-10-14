import { describe, expect, it } from "vitest";

import { msUntilNextZurichTime } from "@/lib/zurichSchedule";

describe("msUntilNextZurichTime", () => {
  it("targets later today in Zurich (summer, UTC+2)", () => {
    // 2026-07-01 00:30 UTC = 02:30 Zurich → 03:00 in 30 min
    expect(msUntilNextZurichTime("03:00", new Date("2026-07-01T00:30:00Z"))).toBe(30 * 60_000);
  });
  it("rolls over to tomorrow once the time has passed (winter, UTC+1)", () => {
    // 2026-01-15 02:30 UTC = 03:30 Zurich → next 03:00 in 23h30
    expect(msUntilNextZurichTime("03:00", new Date("2026-01-15T02:30:00Z"))).toBe((23 * 60 + 30) * 60_000);
  });
  it("rejects malformed times", () => {
    expect(() => msUntilNextZurichTime("25:00")).toThrow();
    expect(() => msUntilNextZurichTime("3h")).toThrow();
  });
});
