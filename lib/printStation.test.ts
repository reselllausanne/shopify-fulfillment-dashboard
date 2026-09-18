import { describe, expect, it } from "vitest";
import {
  decideStationAutoPrint,
  defaultPrintStationConfig,
  PRINT_STATION_SETUP_NOTES,
} from "@/lib/printStation";

describe("printStation", () => {
  it("default config disables auto-print until operator opts in", () => {
    const config = defaultPrintStationConfig();
    expect(config.autoPrintOnCertainMatch).toBe(false);
    expect(config.silentPrintValidated).toBe(false);
    expect(
      decideStationAutoPrint({ matchCertainty: "certain", config }).shouldAutoPrint
    ).toBe(false);
  });

  it("refuses silent auto-print without validation, even when enabled", () => {
    const config = defaultPrintStationConfig({
      printerName: "Brother_QL_W810W",
      autoPrintOnCertainMatch: true,
      silentPrintValidated: false,
    });
    const decision = decideStationAutoPrint({ matchCertainty: "certain", config });
    expect(decision.shouldAutoPrint).toBe(false);
    expect(decision.reason).toBe("silent_not_validated");
  });

  it("auto-prints only on certain match once validated + enabled", () => {
    const config = defaultPrintStationConfig({
      printerName: "Brother_QL_W810W",
      autoPrintOnCertainMatch: true,
      silentPrintValidated: true,
    });
    expect(
      decideStationAutoPrint({ matchCertainty: "certain", config }).shouldAutoPrint
    ).toBe(true);
    expect(
      decideStationAutoPrint({ matchCertainty: "ambiguous", config }).shouldAutoPrint
    ).toBe(false);
    expect(
      decideStationAutoPrint({ matchCertainty: "none", config }).shouldAutoPrint
    ).toBe(false);
  });

  it("refuses when no printer is configured", () => {
    const config = defaultPrintStationConfig({
      autoPrintOnCertainMatch: true,
      silentPrintValidated: true,
      printerName: "",
    });
    const decision = decideStationAutoPrint({ matchCertainty: "certain", config });
    expect(decision.shouldAutoPrint).toBe(false);
    expect(decision.reason).toBe("no_printer");
  });

  it("documents QZ Tray as recommended", () => {
    expect(PRINT_STATION_SETUP_NOTES.recommended).toBe("qz_tray");
  });
});
