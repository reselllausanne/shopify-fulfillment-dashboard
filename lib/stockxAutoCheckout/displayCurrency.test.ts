import { describe, expect, it } from "vitest";
import {
  parseLaneCardsFromText,
  parseSingleXpressItemPriceChf,
} from "@/lib/stockxAutoCheckout/chooseLane";
import { bodyHasChfPrice, bodyHasEuroPrice, snippetIsChfAmount } from "@/lib/stockxAutoCheckout/displayCurrency";

const EURO_CHECKOUT = `
Taille : US M 7.5
Prix de l'article de 233 €
Recevez votre commande d'ici le
Sous-total
6 décembre - 17 décembre
272,33 €
2 décembre - 7 décembre
362,63 €
livraison Xpress
`;

const CHF_CHECKOUT = `
Taille : EU 40.5
Prix de l'article de 213 CHF
Recevez votre commande d'ici le
Sous-total
6 décembre - 17 décembre
248,97 CHF
2 décembre - 7 décembre
331,75 CHF
livraison Xpress
`;

describe("euro prices are not CHF", () => {
  it("detects the two currencies", () => {
    expect(bodyHasEuroPrice(EURO_CHECKOUT)).toBe(true);
    expect(bodyHasChfPrice(EURO_CHECKOUT)).toBe(false);
    expect(bodyHasChfPrice(CHF_CHECKOUT)).toBe(true);
    expect(snippetIsChfAmount("272,33 €")).toBe(false);
    expect(snippetIsChfAmount("248,97 CHF")).toBe(true);
  });

  it("does not turn a euro sous-total or item price into a CHF lane", () => {
    expect(parseLaneCardsFromText(EURO_CHECKOUT)).toEqual([]);
    expect(parseSingleXpressItemPriceChf(EURO_CHECKOUT)).toBeNull();
  });

  it("still reads CHF sous-totals", () => {
    const lanes = parseLaneCardsFromText(CHF_CHECKOUT);
    expect(lanes.map((l) => l.totalChf).sort()).toEqual([248.97, 331.75]);
    expect(parseSingleXpressItemPriceChf(CHF_CHECKOUT)).toBe(213);
  });
});
