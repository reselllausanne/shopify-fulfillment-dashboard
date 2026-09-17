import { describe, expect, it } from "vitest";
import {
  decideStationAutoPrint,
  defaultPrintStationConfig,
  PRINT_STATION_SETUP_NOTES,
} from "@/lib/printStation";

describe("printStation", () => {
  it("auto-prints only on certain match", () => {
    const config = defaultPrintStationConfig({
      printerName: "Brother_QL_W810W",
      autoPrintOnCertainMatch: true,
    });
    expect(
      decideStationAutoPrint({ matchCertainty: "certain", config }).shouldAutoPrint
    ).toBe(true);
    expect(
      decideStationAutoPrint({ matchCertainty: "ambiguous", config }).shouldAutoPrint
    ).toBe(false);
  });

  it("documents QZ Tray as recommended", () => {
    expect(PRINT_STATION_SETUP_NOTES.recommended).toBe("qz_tray");
  });
});
