import { describe, expect, it } from "vitest";
import { accumulateBestCandidates } from "@/galaxus/exports/gtinSelection";
import {
  isWelCardOmitTitle,
  shouldOmitWelPokemonFromGalaxusFeed,
} from "@/galaxus/exports/welFeedOmit";

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

describe("shouldOmitWelPokemonFromGalaxusFeed", () => {
  it("omits WEL + pokemon only", () => {
    expect(
      shouldOmitWelPokemonFromGalaxusFeed({
        providerKey: "WEL_196214150454",
        title: "Pokémon Perfect Order Booster Box",
        brand: "The Pokémon Company International",
      })
    ).toBe(true);
    expect(
      shouldOmitWelPokemonFromGalaxusFeed({
        supplierVariantId: "wel_196214150454",
        title: "Catan Base Game",
        brand: "Kosmos",
      })
    ).toBe(false);
    expect(
      shouldOmitWelPokemonFromGalaxusFeed({
        providerKey: "STX_196214150454",
        title: "Pokemon TCG Pack",
        brand: "Pokemon",
      })
    ).toBe(false);
  });
});

describe("accumulateBestCandidates WEL pokemon omit", () => {
  it("drops WEL pokemon and keeps other WEL", () => {
    const best = new Map();
    accumulateBestCandidates(
      [
        {
          gtin: "1962141504546",
          supplierVariantId: "wel_1962141504546",
          supplierVariant: {
            supplierVariantId: "wel_1962141504546",
            providerKey: "WEL_1962141504546",
            supplierProductName: "Pokémon Perfect Order Booster Box",
            supplierBrand: "The Pokémon Company International",
            price: 16.5,
            stock: 4,
          },
        },
        {
          gtin: "4000118155003",
          supplierVariantId: "wel_4000118155003",
          supplierVariant: {
            supplierVariantId: "wel_4000118155003",
            providerKey: "WEL_4000118155003",
            supplierProductName: "Catan Base Game",
            supplierBrand: "Kosmos",
            price: 40,
            stock: 2,
          },
        },
      ],
      best,
      { requireProductName: false, requireImage: false }
    );
    expect([...best.keys()]).toEqual(["4000118155003"]);
  });
});
