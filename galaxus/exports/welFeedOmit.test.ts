import { describe, expect, it } from "vitest";
import { isWelCardOmitTitle } from "@/galaxus/exports/welFeedOmit";

describe("isWelCardOmitTitle", () => {
  it("matches accent and ascii brand/title", () => {
    expect(isWelCardOmitTitle("Perfect Order Booster Box", "The Pokémon Company International")).toBe(
      true
    );
    expect(isWelCardOmitTitle("Pokemon TCG Pack", "")).toBe(true);
  });

  it("ignores unrelated WEL titles", () => {
    expect(isWelCardOmitTitle("Catan Base Game", "Kosmos")).toBe(false);
    expect(isWelCardOmitTitle("Dragon Shield Sleeves", "Dragon Shield")).toBe(false);
  });
});
