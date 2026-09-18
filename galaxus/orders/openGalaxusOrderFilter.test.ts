import { describe, expect, it } from "vitest";
import {
  assessGalaxusOrderOpenness,
  shouldSkipGalaxusOrderForMatching,
} from "@/galaxus/orders/openGalaxusOrderFilter";

describe("openGalaxusOrderFilter", () => {
  it("skips fully shipped orders", () => {
    expect(
      shouldSkipGalaxusOrderForMatching({
        lines: [
          { id: "1", quantity: 1, warehouseMarkedShippedAt: "2026-09-01" },
          { id: "2", quantity: 1, warehouseMarkedShippedAt: "2026-09-01" },
        ],
      })
    ).toBe(true);
  });

  it("keeps partial / open orders", () => {
    expect(
      shouldSkipGalaxusOrderForMatching({
        lines: [
          { id: "1", quantity: 1, warehouseMarkedShippedAt: "2026-09-01" },
          { id: "2", quantity: 1, warehouseMarkedShippedAt: null },
        ],
      })
    ).toBe(false);
  });

  it("skips cancelled", () => {
    expect(
      shouldSkipGalaxusOrderForMatching({
        cancelledAt: "2026-09-01",
        lines: [{ id: "1", quantity: 1 }],
      })
    ).toBe(true);
  });

  it("assesses openness counts", () => {
    const a = assessGalaxusOrderOpenness({
      lines: [
        { quantity: 1, warehouseMarkedShippedAt: null },
        { quantity: 1, warehouseMarkedShippedAt: "x" },
      ],
    });
    expect(a.openLineCount).toBe(1);
    expect(a.isOpenOrPartial).toBe(true);
  });
});
