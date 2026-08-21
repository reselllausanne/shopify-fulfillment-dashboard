import { describe, expect, it } from "vitest";
import { mergeKickdbRawJson } from "@/galaxus/kickdb/rawJsonMerge";

describe("mergeKickdbRawJson", () => {
  it("replaces wholesale when not priceOnly", () => {
    const existing = { gallery: ["a"], variants: [{ id: "1", ask: 10 }] };
    const incoming = { variants: [{ id: "1", ask: 20 }] };
    expect(mergeKickdbRawJson(existing, incoming, false)).toEqual(incoming);
  });

  it("keeps gallery on priceOnly merge", () => {
    const existing = {
      gallery: ["a.jpg"],
      gallery_360: ["b.jpg"],
      variants: [{ id: "1", ask: 10 }],
      name: "old",
    };
    const incoming = {
      name: "new",
      variants: [{ id: "1", ask: 99 }],
      gallery: [],
      gallery_360: [],
    };
    expect(mergeKickdbRawJson(existing, incoming, true)).toEqual({
      gallery: ["a.jpg"],
      gallery_360: ["b.jpg"],
      variants: [{ id: "1", ask: 99 }],
      name: "new",
    });
  });

  it("uses incoming when no existing raw on priceOnly", () => {
    const incoming = { variants: [{ id: "1", ask: 5 }] };
    expect(mergeKickdbRawJson(null, incoming, true)).toEqual(incoming);
  });
});
