import { describe, expect, it } from "vitest";
import {
  chooseLane,
  classifyLaneLabel,
  marginOk,
  parseLaneCardsFromText,
} from "@/lib/stockxAutoCheckout/chooseLane";
import type { StockxLaneCard } from "@/lib/stockxAutoCheckout/types";

const lanes = (rows: Array<[string, number]>): StockxLaneCard[] =>
  rows.map(([raw, totalChf]) => ({
    label: classifyLaneLabel(raw),
    rawLabel: raw,
    totalChf,
    eta: null,
  }));

describe("classifyLaneLabel", () => {
  it("maps Express / Xpress / Standard", () => {
    expect(classifyLaneLabel("Express")).toBe("EXPRESS");
    expect(classifyLaneLabel("Xpress")).toBe("EXPRESS");
    expect(classifyLaneLabel("Standard")).toBe("STANDARD");
  });
});

describe("chooseLane", () => {
  it("picks Standard under cap when desired STANDARD", () => {
    const result = chooseLane("STANDARD", lanes([
      ["Standard", 86.74],
      ["Express", 140],
    ]));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lane.label).toBe("STANDARD");
      expect(result.lane.totalChf).toBe(86.74);
    }
  });

  it("never returns Express when desired STANDARD", () => {
    const result = chooseLane("STANDARD", lanes([["Express", 90]]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("wrong_lane_only");
  });

  it("picks Express when Shopify Express + under cap", () => {
    const result = chooseLane("EXPRESS", lanes([
      ["Standard", 80],
      ["Xpress", 120],
    ]));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.lane.label).toBe("EXPRESS");
  });

  it("cap when desired lane only above 250", () => {
    const result = chooseLane("STANDARD", lanes([
      ["Standard", 260],
      ["Express", 300],
    ]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("cap");
  });

  it("multi_price when two Standard prices under cap", () => {
    const result = chooseLane(
      "STANDARD",
      lanes([
        ["Standard", 80],
        ["Standard", 95],
      ])
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("multi_price");
  });

  it("oos when empty", () => {
    const result = chooseLane("STANDARD", []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("oos");
  });
});

describe("parseLaneCardsFromText", () => {
  it("extracts Standard + Express CHF", () => {
    const text = `
      Standard  Livraison 5-7j  86,74 CHF
      Express  Recevez d'ici le 24 oct  142,00 CHF
    `;
    const parsed = parseLaneCardsFromText(text);
    expect(parsed.some((l) => l.label === "STANDARD" && l.totalChf === 86.74)).toBe(true);
    expect(parsed.some((l) => l.label === "EXPRESS" && l.totalChf === 142)).toBe(true);
  });
});

describe("marginOk", () => {
  it("requires sale >= total", () => {
    expect(marginOk(100, 86.74)).toBe(true);
    expect(marginOk(80, 86.74)).toBe(false);
    expect(marginOk(null, 80)).toBe(false);
  });
});
