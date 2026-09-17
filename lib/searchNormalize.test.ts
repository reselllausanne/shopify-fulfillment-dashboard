import { describe, expect, it } from "vitest";
import {
  compactSearchKey,
  matchesNormalizedSearch,
  rankBySearch,
  searchTokens,
  scoreSearchFields,
} from "@/lib/searchNormalize";

describe("searchNormalize", () => {
  it("folds accents and strips punctuation", () => {
    expect(compactSearchKey("Goubey 32-15")).toBe("goubey3215");
    expect(searchTokens("32 15")).toEqual(["32", "15"]);
  });

  it("matches Goubey 32-15 with query 32 15", () => {
    expect(matchesNormalizedSearch("32 15", "Goubey 32-15")).toBe(true);
    const scored = scoreSearchFields("32 15", [
      { field: "name", value: "Goubey 32-15" },
    ]);
    expect(scored.score).toBeGreaterThan(0);
  });

  it("ranks exact before partial", () => {
    const ranked = rankBySearch("nike dunk", [
      { id: "partial", title: "Nike Dunk Low Retro" },
      { id: "exact", title: "nike dunk" },
    ], (item) => [{ field: "title", value: item.title }]);
    expect(ranked[0]?.item.id).toBe("exact");
  });
});
