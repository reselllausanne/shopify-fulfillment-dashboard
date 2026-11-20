import { describe, expect, it } from "vitest";
import {
  defaultPrintStationConfig,
  parsePrintStationProfiles,
  upsertPrintStationProfile,
} from "@/lib/printStation";

describe("print station profiles", () => {
  it("upsert keys by printerName and keeps other printers", () => {
    const brother = defaultPrintStationConfig({ printerName: "Brother_QL_810W", labelWidthMm: 62 });
    const bixolon = defaultPrintStationConfig({ printerName: "BIXOLON_XD5_40d", dpi: 203 });
    let p = upsertPrintStationProfile({}, brother);
    p = upsertPrintStationProfile(p, bixolon);
    expect(Object.keys(p).sort()).toEqual(["BIXOLON_XD5_40d", "Brother_QL_810W"]);
    p = upsertPrintStationProfile(p, { ...bixolon, dpi: 300 });
    expect(p["BIXOLON_XD5_40d"].dpi).toBe(300);
    expect(p["Brother_QL_810W"].labelWidthMm).toBe(62);
  });

  it("ignores config without printer", () => {
    const empty = {};
    expect(upsertPrintStationProfile(empty, defaultPrintStationConfig())).toBe(empty);
  });

  it("parse survives junk", () => {
    expect(parsePrintStationProfiles("not json")).toEqual({});
    expect(parsePrintStationProfiles(null)).toEqual({});
    const raw = JSON.stringify({ A: { dpi: 203 }, "": { dpi: 1 }, B: null });
    const out = parsePrintStationProfiles(raw);
    expect(Object.keys(out)).toEqual(["A"]);
    expect(out.A.printerName).toBe("A");
    expect(out.A.dpi).toBe(203);
  });
});
