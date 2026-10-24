import { describe, expect, it } from "vitest";
import {
  chooseLane,
  chooseLaneByCsAtMargin,
  classifyLaneLabel,
  countDistinctShippingTierInText,
  extractCheckoutSubtotalChf,
  laneMatchesSubtotal,
  laneMarginPct,
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
  it("maps Express / Xpress / Fastest / Standard", () => {
    expect(classifyLaneLabel("Express")).toBe("EXPRESS");
    expect(classifyLaneLabel("Xpress")).toBe("EXPRESS");
    expect(classifyLaneLabel("Fastest")).toBe("EXPRESS");
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

  it("parses stacked multiline cards (2–3 prices)", () => {
    const text = `
Standard
Livraison 5-7 jours ouvrés
86,74 CHF
Express
Recevez d'ici le 24 oct.
142,00 CHF
Xpress
199,50 CHF
    `;
    const parsed = parseLaneCardsFromText(text);
    expect(parsed.find((l) => l.label === "STANDARD")?.totalChf).toBe(86.74);
    expect(parsed.find((l) => l.rawLabel === "Express")?.totalChf).toBe(142);
    expect(parsed.find((l) => l.rawLabel === "Xpress")?.totalChf).toBe(199.5);
  });

  it("parses en-GB CHF prefix + Fastest", () => {
    const text = `
Standard
CHF 125.12
Express
CHF 128.44
Fastest
CHF 199.00
    `;
    const parsed = parseLaneCardsFromText(text);
    expect(parsed.find((l) => l.label === "STANDARD")?.totalChf).toBe(125.12);
    expect(parsed.find((l) => l.rawLabel === "Express")?.totalChf).toBe(128.44);
    expect(parsed.some((l) => l.rawLabel === "Fastest" && l.label === "EXPRESS")).toBe(true);
  });

  it("parses en-GB date-only cards into Standard + Express", () => {
    const text = `
Choose shipping
Friday 24 Oct – Monday 27 Oct
CHF 125.12
Tuesday 21 Oct – Wednesday 22 Oct
CHF 128.44
Subtotal
CHF 125.12
    `;
    const parsed = parseLaneCardsFromText(text);
    expect(parsed.find((l) => l.label === "STANDARD")?.totalChf).toBe(125.12);
    expect(parsed.find((l) => l.label === "EXPRESS")?.totalChf).toBe(128.44);
    expect(countDistinctShippingTierInText(text)).toBeGreaterThanOrEqual(2);
  });

  it("parses fr-CH date-only cards (nov. + CHF suffix) — false-OOS fix", () => {
    const text = `
Choisissez votre mode de livraison
2 nov. – 11 nov.
127,50 CHF
28 oct. – 2 nov.
318,85 CHF
Sous-total
127,50 CHF
    `;
    const parsed = parseLaneCardsFromText(text);
    expect(parsed.find((l) => l.label === "STANDARD")?.totalChf).toBe(127.5);
    expect(parsed.find((l) => l.label === "EXPRESS")?.totalChf).toBe(318.85);
  });
});

describe("chooseLaneByCsAtMargin", () => {
  it("picks Express when margin >5% even if only ~+4 CHF vs Standard", () => {
    // sell 149.54, std 125.12, exp 128.44 → Express margin ~14%
    const result = chooseLaneByCsAtMargin(
      149.54,
      lanes([
        ["Standard", 125.12],
        ["Express", 128.44],
      ])
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lane.label).toBe("EXPRESS");
      expect(result.lane.totalChf).toBe(128.44);
      expect(laneMarginPct(149.54, 128.44)).toBeGreaterThan(0.05);
    }
  });

  it("falls to Standard only when Express margin dead", () => {
    const result = chooseLaneByCsAtMargin(
      130,
      lanes([
        ["Standard", 100],
        ["Express", 128], // margin ~1.5%
      ])
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.lane.label).toBe("STANDARD");
  });

  it("fail closed when multi-tier text but Express missing from parse", () => {
    const result = chooseLaneByCsAtMargin(149.54, lanes([["Standard", 125.12]]), {
      shippingTierInText: 2,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("express_unparsed");
  });

  it("allows Standard when Express truly missing (single tier)", () => {
    const result = chooseLaneByCsAtMargin(149.54, lanes([["Standard", 125.12]]), {
      shippingTierInText: 1,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.lane.label).toBe("STANDARD");
  });
});

describe("subtotal verify", () => {
  it("extracts en-GB Subtotal", () => {
    expect(extractCheckoutSubtotalChf("Subtotal\nCHF 128.44\nTotal Price CHF 128.44")).toBe(128.44);
  });

  it("laneMatchesSubtotal", () => {
    const lane = lanes([["Express", 128.44]])[0]!;
    expect(laneMatchesSubtotal(lane, 128.44)).toBe(true);
    expect(laneMatchesSubtotal(lane, 125.12)).toBe(false);
  });

  it("detects stuck Express vs Standard pick (prior #7298/#7542)", () => {
    const std = lanes([["Standard", 127.5]])[0]!;
    const exp = lanes([["Express", 318.85]])[0]!;
    expect(laneMatchesSubtotal(std, 318.85)).toBe(false);
    expect(laneMatchesSubtotal(exp, 318.85)).toBe(true);
    expect(laneMatchesSubtotal(std, 127.5)).toBe(true);
  });
});

describe("marginOk", () => {
  it("requires sale >= total", () => {
    expect(marginOk(100, 86.74)).toBe(true);
    expect(marginOk(80, 86.74)).toBe(false);
    expect(marginOk(null, 80)).toBe(false);
  });
});
