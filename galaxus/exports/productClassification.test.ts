import { describe, expect, it } from "vitest";
import { classifyGalaxusProductKind } from "@/galaxus/exports/productClassification";

describe("classifyGalaxusProductKind — Pokémon", () => {
  it("keeps sealed Pokémon product as trading cards", () => {
    expect(
      classifyGalaxusProductKind({ title: "Pokemon TCG Scarlet & Violet Booster Box", supplierKey: "stx" })
    ).toBe("tradingcard");
  });

  it("treats sized Pokémon collabs as footwear / apparel", () => {
    expect(
      classifyGalaxusProductKind({ title: "adidas Originals x Pokemon Samba OG Mewtwo", sizeRaw: "37 1/3", supplierKey: "ner" })
    ).toBe("sneakers");
    expect(
      classifyGalaxusProductKind({ title: "Puma Suede Pokémon Pikachu", sizeRaw: "EU 43", supplierKey: "stx" })
    ).toBe("sneakers");
    expect(
      classifyGalaxusProductKind({ title: "Daniel Arsham x Pokemon x Uniqlo Crystal Pokedex Tee White", sizeRaw: "M", supplierKey: "stx" })
    ).not.toBe("tradingcard");
  });
});
