import { describe, expect, it } from "vitest";
import { isGalaxusExpressArrival } from "@/galaxus/orders/expressDelivery";

describe("isGalaxusExpressArrival", () => {
  it("treats a 4-day arrival as express and a 3-week arrival as slow", () => {
    expect(isGalaxusExpressArrival("2026-11-27T18:00:00.000Z", "2026-12-01T00:00:00.000Z")).toBe(true);
    expect(isGalaxusExpressArrival("2026-11-27T18:00:00.000Z", "2026-12-20T00:00:00.000Z")).toBe(false);
  });

  it("is false without an arrival date", () => {
    expect(isGalaxusExpressArrival("2026-11-27T18:00:00.000Z", null)).toBe(false);
  });
});
