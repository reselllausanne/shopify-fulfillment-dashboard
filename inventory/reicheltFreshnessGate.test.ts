import { afterEach, describe, expect, it } from "vitest";
import {
  isReicheltHighValuePrice,
  isReicheltStaleHighValue,
  isReicheltSupplierVariantId,
} from "@/inventory/reicheltFreshnessGate";

const NOW = new Date("2026-10-07T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

afterEach(() => {
  delete process.env.REI_HIGH_VALUE_CHF;
  delete process.env.REI_HIGH_VALUE_MAX_AGE_HOURS;
});

describe("reichelt freshness gate", () => {
  it("only rei_ ids", () => {
    expect(isReicheltSupplierVariantId("rei_0810152850282")).toBe(true);
    expect(isReicheltSupplierVariantId("alt_0810152850282")).toBe(false);
  });

  it("high value threshold defaults to CHF 1000", () => {
    expect(isReicheltHighValuePrice(999.99)).toBe(false);
    expect(isReicheltHighValuePrice("7439.84")).toBe(true);
  });

  it("hides high-value rows not re-checked within 24h", () => {
    expect(isReicheltStaleHighValue({ price: 7439.84, lastSyncAt: hoursAgo(6 * 24), now: NOW })).toBe(true);
    expect(isReicheltStaleHighValue({ price: 7439.84, lastSyncAt: hoursAgo(25), now: NOW })).toBe(true);
    expect(isReicheltStaleHighValue({ price: 7439.84, lastSyncAt: hoursAgo(10), now: NOW })).toBe(false);
    expect(isReicheltStaleHighValue({ price: 7439.84, lastSyncAt: null, now: NOW })).toBe(true);
  });

  it("cheap rows never gated", () => {
    expect(isReicheltStaleHighValue({ price: 49, lastSyncAt: hoursAgo(24 * 30), now: NOW })).toBe(false);
  });

  it("env overrides", () => {
    process.env.REI_HIGH_VALUE_CHF = "500";
    process.env.REI_HIGH_VALUE_MAX_AGE_HOURS = "48";
    expect(isReicheltStaleHighValue({ price: 600, lastSyncAt: hoursAgo(30), now: NOW })).toBe(false);
    expect(isReicheltStaleHighValue({ price: 600, lastSyncAt: hoursAgo(50), now: NOW })).toBe(true);
  });
});
