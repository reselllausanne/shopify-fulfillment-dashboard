import { describe, expect, it } from "vitest";
import { addBusinessDays, rebuyEtaWindow } from "@/lib/stockxDelayRebuy/eta";

describe("rebuyEtaWindow", () => {
  it("express is shorter than standard", () => {
    const now = new Date("2026-10-30T12:00:00Z");
    const ex = rebuyEtaWindow("EXPRESS", now);
    const st = rebuyEtaWindow("STANDARD", now);
    expect(ex.end.getTime()).toBeLessThan(st.end.getTime());
    expect(ex.start.getTime()).toBeGreaterThan(now.getTime());
  });

  it("addBusinessDays skips weekend", () => {
    // Friday → +1 business day = Monday
    const fri = new Date("2026-10-30T12:00:00Z"); // Friday
    const next = addBusinessDays(fri, 1);
    expect(next.getUTCDay()).toBe(1);
  });
});
