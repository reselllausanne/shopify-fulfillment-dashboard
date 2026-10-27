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
  parseSingleXpressItemPriceChf,
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
  it("maps Express / Xpress / Expedited / Fastest / Standard", () => {
    expect(classifyLaneLabel("Express")).toBe("EXPRESS");
    expect(classifyLaneLabel("Xpress")).toBe("EXPRESS");
    expect(classifyLaneLabel("Express Expedited")).toBe("EXPEDITED");
    expect(classifyLaneLabel("Fastest")).toBe("EXPEDITED");
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

  it("takes Express when desired STANDARD but only Express available (don't refuse)", () => {
    const result = chooseLane("STANDARD", lanes([["Express", 90]]));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.lane.label).toBe("EXPRESS");
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

  it("EXPRESS: picks expedited when within 5% of normal express", () => {
    // normal 140, expedited 145 → 145 <= 140*1.05=147 → upgrade
    const result = chooseLane("EXPRESS", lanes([
      ["Express", 140],
      ["Express Expedited", 145],
    ]));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lane.label).toBe("EXPEDITED");
      expect(result.lane.totalChf).toBe(145);
    }
  });

  it("EXPRESS: picks expedited when delta <= 10 CHF even if >5%", () => {
    // normal 100, expedited 109 → 109 > 105 but delta 9 <= 10 → upgrade
    const result = chooseLane("EXPRESS", lanes([
      ["Express", 100],
      ["Expedited", 109],
    ]));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.lane.label).toBe("EXPEDITED");
  });

  it("EXPRESS: keeps normal express when expedited far more expensive", () => {
    // normal 140, expedited 200 → >5% and delta 60 → keep normal
    const result = chooseLane("EXPRESS", lanes([
      ["Express", 140],
      ["Express Expedited", 200],
    ]));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lane.label).toBe("EXPRESS");
      expect(result.lane.totalChf).toBe(140);
    }
  });

  it("EXPRESS: uses expedited when only expedited present", () => {
    const result = chooseLane("EXPRESS", lanes([["Express Expedited", 150]]));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.lane.label).toBe("EXPEDITED");
  });

  it("EXPRESS: does NOT multi_price on express vs expedited", () => {
    const result = chooseLane("EXPRESS", lanes([
      ["Express", 140],
      ["Express Expedited", 200],
    ]));
    expect(result.ok).toBe(true);
  });

  it("EXPRESS: multi_price only when 2+ distinct normal express prices", () => {
    const result = chooseLane("EXPRESS", lanes([
      ["Express", 140],
      ["Express", 160],
    ]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("multi_price");
  });

  it("STANDARD takes Expedited when only Expedited available (don't refuse)", () => {
    const result = chooseLane("STANDARD", lanes([["Express Expedited", 150]]));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.lane.label).toBe("EXPEDITED");
  });

  it("STANDARD upgrades to Express when ~same price (+7 CHF, screenshot case)", () => {
    const result = chooseLane("STANDARD", lanes([
      ["Standard", 209.23],
      ["Express", 216.84],
    ]));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.lane.label).toBe("EXPRESS");
  });

  it("STANDARD keeps Standard when faster lane far more expensive", () => {
    const result = chooseLane("STANDARD", lanes([
      ["Standard", 100],
      ["Express", 160],
    ]));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.lane.label).toBe("STANDARD");
  });

  it("STANDARD upgrade respects pct=0/delta=0 opts (keep standard)", () => {
    const result = chooseLane(
      "STANDARD",
      lanes([
        ["Standard", 209.23],
        ["Express", 216.84],
      ]),
      250,
      { standardUpgradeMaxPct: 0, standardUpgradeMaxDeltaChf: 0 }
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.lane.label).toBe("STANDARD");
  });

  it("EXPRESS: respects configurable thresholds via opts", () => {
    // normal 140, expedited 145 but pct=0 and delta=0 → keep normal
    const result = chooseLane(
      "EXPRESS",
      lanes([
        ["Express", 140],
        ["Express Expedited", 145],
      ]),
      250,
      { expeditedUpgradeMaxPct: 0, expeditedUpgradeMaxDeltaChf: 0 }
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.lane.label).toBe("EXPRESS");
  });
});

describe("parseSingleXpressItemPriceChf", () => {
  it("parses FR 'Prix de l'article 119 CHF' (no decimals)", () => {
    expect(
      parseSingleXpressItemPriceChf(
        "Prix de l'article 119 CHF\ndirectement expédié en livraison Xpress"
      )
    ).toBe(119);
  });

  it("parses 'Item price CHF 119.00'", () => {
    expect(parseSingleXpressItemPriceChf("Item price CHF 119.00")).toBe(119);
  });

  it("parses low FR item ask with 'de' (under all-in floor)", () => {
    expect(
      parseSingleXpressItemPriceChf(
        "Prix de l'article\n\nde\n\n43 CHF\nRecevez votre commande d'ici le"
      )
    ).toBe(43);
  });

  it("parses sub-80 item price (live subtotal still gates)", () => {
    expect(parseSingleXpressItemPriceChf("Prix de l'article\n67 CHF")).toBe(67);
  });

  it("returns null when no item price present", () => {
    expect(parseSingleXpressItemPriceChf("aucune demande")).toBeNull();
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
    expect(parsed.some((l) => l.rawLabel === "Fastest" && l.label === "EXPEDITED")).toBe(true);
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

  it("parses cheap Stan Smith FR checkout (~68 CHF) — not express_unparsed", () => {
    // Live fail: floor 80 discarded all three lanes → empty → express_unparsed
    // while "Vérifier la commande" was on screen (IE4634 EU40).
    const text = `
adidas Stan Smith Cloud Blanc OFF-WHITE Wonder Blanc (femme)
Taille : EU 40
Prix de l'article 43 CHF
Choisissez votre mode de livraison
5 novembre - 14 novembre
68,73 CHF
29 octobre - 3 novembre
69,73 CHF
jeudi 29 octobre
70,73 CHF
Sous-total
68,73 CHF
Vérifier la commande
`;
    const parsed = parseLaneCardsFromText(text);
    expect(parsed.find((l) => l.label === "STANDARD")?.totalChf).toBe(68.73);
    expect(parsed.find((l) => l.label === "EXPRESS")?.totalChf).toBe(69.73);
    expect(parsed.find((l) => l.label === "EXPEDITED")?.totalChf).toBe(70.73);
    expect(extractCheckoutSubtotalChf(text)).toBe(68.73);

    const pick = chooseLane("STANDARD", parsed);
    expect(pick.ok).toBe(true);
    if (pick.ok) {
      // +1 CHF Xpress vs Standard → MUST upgrade (≤2 / ≤10 CHF rule)
      expect(pick.lane.label).toBe("EXPRESS");
      expect(pick.lane.totalChf).toBe(69.73);
    }
  });
});

describe("STANDARD → Xpress upgrade (≤2 CHF hard rule)", () => {
  it("upgrades STANDARD to Xpress when delta is 1–2 CHF", () => {
    const result = chooseLane(
      "STANDARD",
      lanes([
        ["Standard", 68.73],
        ["Xpress", 69.73],
        ["Fastest", 70.73],
      ])
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lane.label).toBe("EXPRESS");
      expect(result.lane.totalChf).toBe(69.73);
    }
  });

  it("keeps STANDARD when Xpress is far more expensive", () => {
    const result = chooseLane(
      "STANDARD",
      lanes([
        ["Standard", 139.33],
        ["Xpress", 295.2],
      ])
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lane.label).toBe("STANDARD");
      expect(result.lane.totalChf).toBe(139.33);
    }
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

  it("treats EXPEDITED as express-equivalent (no regression)", () => {
    // Only an expedited lane labelled — must still count as express for CSAT.
    const result = chooseLaneByCsAtMargin(
      149.54,
      lanes([
        ["Standard", 125.12],
        ["Express Expedited", 128.44],
      ])
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lane.label).toBe("EXPEDITED");
      expect(result.lane.totalChf).toBe(128.44);
    }
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
