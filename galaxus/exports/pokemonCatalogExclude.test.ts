import { describe, expect, it } from "vitest";
import {
  classifyPokemonCatalog,
  shouldExcludeNonStxPokemon,
} from "./pokemonCatalogExclude";

describe("pokemon catalog exclude", () => {
  it("never excludes stx even with booster title", () => {
    const row = {
      supplierKey: "stx",
      title: "Pokémon Scarlet & Violet Booster Display",
      brand: "The Pokémon Company International",
      productType: "Trading Cards",
      categories: ["Pokemon", "Displays"],
    };
    expect(classifyPokemonCatalog(row).excluded).toBe(false);
    expect(shouldExcludeNonStxPokemon(row)).toBe(false);
    expect(classifyPokemonCatalog(row).reason).toBe("stx_pokemon_allowed");
  });

  it("excludes WEL by brand without relying on title alone", () => {
    const d = classifyPokemonCatalog({
      supplierKey: "wel",
      title: "Perfect Order",
      brand: "The Pokémon Company International",
      productType: "TCG",
    });
    expect(d.excluded).toBe(true);
    expect(d.reason).toBe("brand_pokemon");
  });

  it("excludes category Pokémon on BWZ", () => {
    const d = classifyPokemonCatalog({
      providerKey: "BWZ_123",
      title: "Sammelkarten Box",
      brand: "Nintendo",
      categories: ["Pokémon", "Displays"],
    });
    expect(d.excluded).toBe(true);
    expect(d.reason).toBe("category_or_product_type_pokemon");
  });

  it("excludes booster signature on FAN", () => {
    const d = classifyPokemonCatalog({
      supplierVariantId: "fan_400",
      title: "Pokemon 151 Elite Trainer Box",
      brand: "",
    });
    expect(d.excluded).toBe(true);
    expect(d.reason).toBe("title_product_signature");
  });

  it("marks bare Pokémon title uncertain but still excluded", () => {
    const d = classifyPokemonCatalog({
      supplierKey: "haw",
      title: "Pokémon",
      brand: "Sony",
    });
    expect(d.excluded).toBe(true);
    expect(d.confidence).toBe("uncertain");
  });

  it("does not match pocket or unrelated titles", () => {
    expect(
      shouldExcludeNonStxPokemon({
        supplierKey: "ven",
        title: "Fiskars Gartenschere",
        brand: "Fiskars",
        productType: "Garten",
      })
    ).toBe(false);
  });
});
