import { describe, expect, it } from "vitest";
import { isExlProgressResumable } from "@/app/lib/exlibrisScrape";

const now = new Date("2026-10-08T12:00:00Z");

describe("isExlProgressResumable", () => {
  it("resumes a recent unfinished pass", () => {
    expect(
      isExlProgressResumable({ pendingCategories: ["/de/a/ci/1/"], updatedAt: "2026-10-08T06:00:00Z" }, now, 48)
    ).toBe(true);
  });

  it("starts fresh when the checkpoint is finished", () => {
    expect(isExlProgressResumable({ pendingCategories: [], updatedAt: "2026-10-08T06:00:00Z" }, now, 48)).toBe(false);
  });

  it("starts fresh when the checkpoint is old (Sep 3 stuck run)", () => {
    expect(
      isExlProgressResumable({ pendingCategories: ["/de/a/ci/1/"], updatedAt: "2026-09-03T02:01:33.381Z" }, now, 48)
    ).toBe(false);
  });

  it("starts fresh when updatedAt is missing", () => {
    expect(isExlProgressResumable({ pendingCategories: ["/de/a/ci/1/"], updatedAt: "" }, now, 48)).toBe(false);
  });
});
