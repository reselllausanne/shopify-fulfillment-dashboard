import { describe, expect, it } from "vitest";
import { classifyEmptyLaneReason } from "@/lib/stockxAutoCheckout/chooseLane";

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

  it("unknown / unparseable body → oos (conservative default)", () => {
    expect(classifyEmptyLaneReason("")).toBe("oos");
    expect(classifyEmptyLaneReason("loading...")).toBe("oos");
  });
});
