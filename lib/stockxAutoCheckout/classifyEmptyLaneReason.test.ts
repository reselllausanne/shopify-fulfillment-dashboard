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
