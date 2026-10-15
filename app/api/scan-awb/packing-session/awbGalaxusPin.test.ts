import { describe, expect, it } from "vitest";
import {
  awbAlreadyInPackingSession,
  filterGalaxusLinesForAwbPin,
} from "@/app/api/scan-awb/packing-session/awbGalaxusPin";

describe("filterGalaxusLinesForAwbPin", () => {
  const lines = [
    { id: "line-a", order: { galaxusOrderId: "111" } },
    { id: "line-b", order: { galaxusOrderId: "222" } },
  ];

  it("returns all lines when no pin", () => {
    expect(filterGalaxusLinesForAwbPin(lines, null)).toHaveLength(2);
  });

  it("restricts to pinned Galaxus order ref", () => {
    expect(
      filterGalaxusLinesForAwbPin(lines, { galaxusOrderRef: "111" }).map((l) => l.id)
    ).toEqual(["line-a"]);
  });

  it("restricts to pinned line when provided", () => {
    expect(
      filterGalaxusLinesForAwbPin(lines, {
        galaxusOrderRef: "111",
        galaxusOrderLineId: "line-a",
      })
    ).toHaveLength(1);
  });
});

describe("awbAlreadyInPackingSession", () => {
  it("detects duplicate AWB in session scan codes", () => {
    expect(
      awbAlreadyInPackingSession({
        awbCandidates: ["190108095494"],
        sessionScanCodes: ["190108095494"],
        normalize: (raw) => [raw.replace(/\s/g, "")],
      })
    ).toBe(true);
  });

  it("allows new AWB", () => {
    expect(
      awbAlreadyInPackingSession({
        awbCandidates: ["190108095494"],
        sessionScanCodes: ["198686785967"],
        normalize: (raw) => [raw],
      })
    ).toBe(false);
  });
});
