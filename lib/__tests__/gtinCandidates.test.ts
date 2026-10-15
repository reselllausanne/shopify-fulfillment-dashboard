import { describe, expect, it } from "vitest";
import { expandGtinCandidates } from "@/lib/gtinCandidates";

describe("expandGtinCandidates", () => {
  it("adds EAN-13 leading zero for 12-digit UPC", () => {
    const out = expandGtinCandidates(["904767103035"]);
    expect(out).toContain("904767103035");
    expect(out).toContain("0904767103035");
  });
});
