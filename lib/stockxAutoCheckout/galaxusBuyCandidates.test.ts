import { describe, expect, it } from "vitest";
import {
  galaxusBuySizeEuOrOs,
  galaxusTitleMatchesProductName,
  sizeEuFromGalaxusLine,
} from "@/lib/stockxAutoCheckout/galaxusBuyCandidates";

describe("sizeEuFromGalaxusLine", () => {
  it("reads line.size", () => {
    expect(sizeEuFromGalaxusLine({ size: "EU 44.5" })).toBe("44.5");
    expect(sizeEuFromGalaxusLine({ size: "44" })).toBe("44");
  });

  it("parses trailing (44.5) from product name", () => {
    expect(
      sizeEuFromGalaxusLine({ productName: "New Balance BB480LGW (44.5)" })
    ).toBe("44.5");
  });

  it("parses (EU 39)", () => {
    expect(
      sizeEuFromGalaxusLine({ productName: "Converse Run Star Hike Ox (EU 39)" })
    ).toBe("39");
  });

  it("parses One size / OS / O/S from sizeRaw", () => {
    expect(sizeEuFromGalaxusLine({ size: "One size" })).toBe("OS");
    expect(sizeEuFromGalaxusLine({ size: "ONE SIZE" })).toBe("OS");
    expect(sizeEuFromGalaxusLine({ size: "OS" })).toBe("OS");
    expect(sizeEuFromGalaxusLine({ size: "O/S" })).toBe("OS");
    expect(sizeEuFromGalaxusLine({ size: "onesize" })).toBe("OS");
  });

  it("parses One size from title (Arc'teryx class)", () => {
    expect(
      sizeEuFromGalaxusLine({
        productName: "Arc'teryx Bird Head Toque (One size)",
      })
    ).toBe("OS");
    expect(
      sizeEuFromGalaxusLine({
        productName: "Supreme Backpack",
        description: "One size",
      })
    ).toBe("OS");
  });

  it("LEGO / Jellycat without size → null (caller forces OS after slug)", () => {
    expect(sizeEuFromGalaxusLine({ productName: "LEGO City Space Shuttle" })).toBeNull();
    expect(
      sizeEuFromGalaxusLine({ productName: "Jellycat Bashful Bunny Medium" })
    ).toBeNull();
    expect(sizeEuFromGalaxusLine({ size: "", productName: "LEGO Technic" })).toBeNull();
  });
});

describe("galaxusBuySizeEuOrOs", () => {
  it("forces OS when size empty (LEGO / plush / collectibles / skate deck)", () => {
    expect(galaxusBuySizeEuOrOs(null)).toBe("OS");
    expect(galaxusBuySizeEuOrOs("")).toBe("OS");
    expect(galaxusBuySizeEuOrOs(undefined)).toBe("OS");
    expect(
      galaxusBuySizeEuOrOs(
        sizeEuFromGalaxusLine({ productName: "LEGO City Space Shuttle" })
      )
    ).toBe("OS");
    expect(
      galaxusBuySizeEuOrOs(
        sizeEuFromGalaxusLine({ productName: "Jellycat Bashful Bunny" })
      )
    ).toBe("OS");
    expect(
      galaxusBuySizeEuOrOs(
        sizeEuFromGalaxusLine({ size: null, productName: "Skate deck blank" })
      )
    ).toBe("OS");
  });

  it("keeps numeric / explicit OS", () => {
    expect(galaxusBuySizeEuOrOs("44.5")).toBe("44.5");
    expect(galaxusBuySizeEuOrOs("OS")).toBe("OS");
    expect(
      galaxusBuySizeEuOrOs(sizeEuFromGalaxusLine({ size: "One size" }))
    ).toBe("OS");
  });
});

describe("galaxusTitleMatchesProductName", () => {
  it("matches Li-Ning with doubled brand", () => {
    expect(
      galaxusTitleMatchesProductName(
        "Li Ning Li-Ning Way of Wade D'Angelo Russell Dlo 1 Lunar Rock (43)",
        "Li-Ning Way of Wade D'Angelo Russell Dlo 1 Lunar Rock"
      )
    ).toBe(true);
  });
  it("matches ASICS with dash and slash", () => {
    expect(
      galaxusTitleMatchesProductName(
        "ASICS Superblast 3 - cobalt burst/light orange (40.5)",
        "ASICS Superblast 3 Cobalt Burst Light Orange"
      )
    ).toBe(true);
  });
  it("rejects other colorway", () => {
    expect(
      galaxusTitleMatchesProductName(
        "ASICS Superblast 3 - cobalt burst/light orange (40.5)",
        "ASICS Superblast 3 Black White"
      )
    ).toBe(false);
  });
});

describe("galaxusTitleMatchesProductName brand prefix", () => {
  it("accepts a Galaxus brand word missing from the StockX name (Onitsuka)", () => {
    expect(
      galaxusTitleMatchesProductName(
        "ASICS Onitsuka Tiger Mexico 66 Black White (37)",
        "Onitsuka Tiger Mexico 66 Black White"
      )
    ).toBe(true);
  });
  it("still rejects a different model", () => {
    expect(
      galaxusTitleMatchesProductName(
        "ASICS Onitsuka Tiger Mexico 66 Black White (37)",
        "Onitsuka Tiger Mexico 66 Deluxe NM Black White"
      )
    ).toBe(false);
  });
  it("rejects long unrelated prefixes", () => {
    expect(galaxusTitleMatchesProductName("Some Very Long Prefix Mexico 66 Black White", "Mexico 66 Black White")).toBe(false);
  });
});
