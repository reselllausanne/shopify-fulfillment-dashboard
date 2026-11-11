import { describe, expect, it } from "vitest";
import { convertEuToUs } from "@/lib/stockxAutoCheckout/sizeUsFallback";

describe("convertEuToUs assumeUsIfSmall", () => {
  const title = "361 Degrees Joker 1 GT SE NYC";
  it("returns null without the flag when brand has no chart", () => {
    expect(convertEuToUs("11", { title })).toBeNull();
  });
  it("treats small numeric label as US when no chart hit", () => {
    expect(convertEuToUs("11", { title, assumeUsIfSmall: true })).toBe("11");
    expect(convertEuToUs("9.5", { title, assumeUsIfSmall: true })).toBe("9.5");
  });
  it("adds W suffix for women's titles", () => {
    expect(convertEuToUs("8", { title: "361 Degrees Wmns Runner", assumeUsIfSmall: true })).toBe("8W");
  });
  it("never treats an adult EU size as US", () => {
    expect(convertEuToUs("44", { title, assumeUsIfSmall: true })).toBeNull();
  });
  it("chart hit still wins", () => {
    expect(convertEuToUs("48", { title: "adidas Top Ten Hi", assumeUsIfSmall: true })).toBe("13");
  });
});
