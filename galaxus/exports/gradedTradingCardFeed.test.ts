import { describe, expect, it } from "vitest";
import {
  appendGradedTradingCardToTitle,
  extractGradedTradingCardLabel,
  gradedTradingCardDescriptionSuffix,
} from "@/galaxus/exports/gradedTradingCardFeed";

describe("gradedTradingCardFeed", () => {
  it("extracts PSA/BGS grade labels from sizeRaw", () => {
    expect(extractGradedTradingCardLabel("PSA 9")).toBe("PSA 9");
    expect(extractGradedTradingCardLabel("  BGS 9.5 ")).toBe("BGS 9.5");
    expect(extractGradedTradingCardLabel("US 10")).toBeNull();
  });

  it("appends grade to title when missing", () => {
    const base = "Pokémon TCG x Van Gogh Museum Pikachu (PSA or BGS Graded)";
    expect(appendGradedTradingCardToTitle(base, "PSA 9")).toBe(`${base} — PSA 9`);
    expect(appendGradedTradingCardToTitle(`${base} — PSA 9`, "PSA 9")).toBe(`${base} — PSA 9`);
  });

  it("builds German description suffix", () => {
    expect(gradedTradingCardDescriptionSuffix("PSA 9")).toBe(
      "Bewertung: PSA 9 (Professional Sports Authenticator)."
    );
    expect(gradedTradingCardDescriptionSuffix("BGS 10")).toBe(
      "Bewertung: BGS 10 (Beckett Grading Services)."
    );
  });
});
