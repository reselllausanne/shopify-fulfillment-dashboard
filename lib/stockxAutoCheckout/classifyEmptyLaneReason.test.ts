import { describe, expect, it } from "vitest";
import {
  classifyEmptyLaneReason,
  isCheckoutShellWithoutLanes,
} from "@/lib/stockxAutoCheckout/chooseLane";

describe("classifyEmptyLaneReason", () => {
  it("true OOS — FR 'aucune demande' with no price → oos_no_ask", () => {
    // #7302 Nike Air Max Pulse EU47 — page literally says no demand.
    const body =
      "Nike Air Max Pulse\nIl n'existe aucune demande pour cette taille.\nFaire une offre";
    expect(classifyEmptyLaneReason(body)).toBe("oos_no_ask");
  });

  it("true OOS — EN 'no asks' / 'make an offer' with no price → oos_no_ask", () => {
    expect(classifyEmptyLaneReason("No Asks available. Make an Offer")).toBe(
      "oos_no_ask"
    );
  });

  it("buyable but STANDARD unparsed — single price present → express_only", () => {
    // #7536 adidas Ultra Boost 4.0 EU42 — buyable 173 CHF Xpress-only.
    const body = "adidas Ultra Boost 4.0\nIl n'en reste que 1\nXpress\n173,00 CHF";
    expect(classifyEmptyLaneReason(body)).toBe("express_only");
  });

  it("Xpress label with CHF price → express_only (not oos)", () => {
    expect(classifyEmptyLaneReason("Livraison Xpress CHF 190.00")).toBe(
      "express_only"
    );
  });

  it("'aucune demande' but a CHF price is still on page → express_only", () => {
    // Mixed signal: never blanket-OOS when a buyable price shows.
    expect(
      classifyEmptyLaneReason("aucune demande ... autre taille 180,00 CHF")
    ).toBe("express_only");
  });

  it("Stan Smith skeleton chrome (size selected, no CHF) → proxy_blank not oos", () => {
    // LIVE #7566 IE4634 — gray panel + spinner; marketing chrome only.
    const body = [
      "Passer au contenu principal",
      "FAQ",
      "Retour",
      "adidas Stan Smith Cloud Blanc OFF-WHITE Wonder Blanc (femme)",
      "Taille :",
      "EU 40",
      "Nouveautés vérifiées",
      "StockX : sneakers, streetwear, cartes collector, sacs, montres",
    ].join("\n");
    expect(isCheckoutShellWithoutLanes(body)).toBe(true);
    expect(classifyEmptyLaneReason(body)).toBe("proxy_blank");
  });

  it("blank / truncated shell → proxy_blank (retryable, not hard OOS)", () => {
    expect(classifyEmptyLaneReason("")).toBe("proxy_blank");
    expect(classifyEmptyLaneReason("loading...")).toBe("proxy_blank");
  });
});

import { euSizeTilePattern, isSizeGridBody, usSizeTilePattern } from "./chooseLane";

describe("isSizeGridBody", () => {
  it("detects the size picker (Mihara dump)", () => {
    const body =
      "Skip to Main Content\nFAQ\nBack\nMaison Mihara\nSelect Size\nUS M\nUS W\nEU\nEU 43\n\nCHF 130\nEU 44\n\nCHF 132\nCancel";
    expect(isSizeGridBody(body)).toBe(true);
  });
  it("ignores a real checkout page", () => {
    expect(isSizeGridBody("Select Size\nSubtotal CHF 130\nReview Order")).toBe(false);
    expect(isSizeGridBody("")).toBe(false);
  });
});

describe("isSizeGridBody fr-fr (Ugg enfant dump, 25 Nov)", () => {
  const frKids = [
    "Passer au contenu principal",
    "FAQ",
    "Opens in new tab",
    "Retour",
    "UGG Classic Ultra Mini Platform Boot Chestnut (enfant)",
    "Sélectionnez du Size",
    "US",
    "UK",
    "CM",
    "KR",
    "EU",
    "EU 37",
    "",
    "119 CHF",
    "EU 38",
    "",
    "98 CHF",
    "Annuler",
  ].join("\n");
  it("detects the half-translated French picker (was misread as proxy_blank)", () => {
    expect(isSizeGridBody(frKids)).toBe(true);
  });
  it("French checkout page is not a picker", () => {
    expect(isSizeGridBody(frKids + "\nSous-total 98 CHF\nVérifier la commande")).toBe(false);
  });
});

describe("euSizeTilePattern", () => {
  it("matches EU tile with CHF, euro, or offer-only price", () => {
    const re = euSizeTilePattern("38");
    expect(re.test("EU 38\n\n98 CHF")).toBe(true);
    expect(re.test("EU 38\n\nCHF 98")).toBe(true);
    expect(re.test("EU 38\n\n€111")).toBe(true);
    expect(re.test("EU 38\n\nOffer")).toBe(true);
  });
  it("never matches a neighbouring size", () => {
    const re = euSizeTilePattern("38");
    expect(re.test("EU 38.5\n\n98 CHF")).toBe(false);
    expect(re.test("EU 3876 CHF")).toBe(false);
    expect(re.test("EU 37\n\n119 CHF")).toBe(false);
  });
});

describe("usSizeTilePattern (Li-Ning picker has US M tiles only)", () => {
  it("matches the US tile with CHF, euro or offer price", () => {
    const re = usSizeTilePattern("9.5");
    expect(re.test("US M 9.5\n\n72 CHF")).toBe(true);
    expect(re.test("US M 9.5\n\nCHF 72")).toBe(true);
    expect(re.test("US M 9.5\n\n€72")).toBe(true);
    expect(re.test("US M 9.5\n\nOffre")).toBe(true);
  });
  it("accepts toddler / kids suffix tokens and never a neighbour", () => {
    expect(usSizeTilePattern("6T").test("US 6T\n\n94 CHF")).toBe(true);
    expect(usSizeTilePattern("9.5").test("US M 19.5\n\n72 CHF")).toBe(false);
    expect(usSizeTilePattern("9.5").test("US M 9\n\n75 CHF")).toBe(false);
    expect(usSizeTilePattern("M 9.5").test("US M 9.5\n\n72 CHF")).toBe(true);
  });
});
