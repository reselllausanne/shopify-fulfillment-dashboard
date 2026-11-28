import { describe, expect, it } from "vitest";
import { isExpressDeliveryRoute, isLegacy48hPromise } from "@/galaxus/orders/expressDelivery";

describe("express delivery stamp", () => {
  it("keeps this week's short promise and ignores the slow date", () => {
    expect(isLegacy48hPromise("2026-11-27T18:00:00.000Z", "2026-12-01T00:00:00.000Z")).toBe(true);
    expect(isLegacy48hPromise("2026-11-27T18:00:00.000Z", "2026-12-20T00:00:00.000Z")).toBe(false);
  });

  it("does not mark older short lead times or a later shortened normal route", () => {
    expect(isLegacy48hPromise("2026-09-03T12:00:00.000Z", "2026-09-09T00:00:00.000Z")).toBe(false);
    expect(isLegacy48hPromise("2027-01-10T12:00:00.000Z", "2027-01-14T00:00:00.000Z")).toBe(false);
  });

  it("is false without an arrival date", () => {
    expect(isLegacy48hPromise("2026-11-27T18:00:00.000Z", null)).toBe(false);
  });

  it("follows the route id, not the number of days", () => {
    expect(isExpressDeliveryRoute("7609999696817")).toBe(true);
    expect(isExpressDeliveryRoute("")).toBe(false);
    expect(isExpressDeliveryRoute(null)).toBe(false);
  });
});
