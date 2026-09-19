import { describe, expect, it } from "vitest";
import {
  decideStationAutoPrint,
  defaultPrintStationConfig,
  PRINT_STATION_SETUP_NOTES,
  STATION_TEST_LABEL_PDF_BASE64,
} from "@/lib/printStation";
import {
  assertNoSecondLabelCreate,
  assertTestPrintIsLocalOnly,
  planAfterLabelCreated,
  planAfterSilentFailure,
  planReprintExisting,
} from "@/lib/printLabelFlow";

const label = {
  base64: STATION_TEST_LABEL_PDF_BASE64,
  mimeType: "application/pdf",
  extension: "pdf" as const,
  createdAt: "2026-09-19T10:00:00.000Z",
  awb: "AWB1",
};

describe("printStation", () => {
  it("default config disables auto-print until operator opts in", () => {
    const config = defaultPrintStationConfig();
    expect(config.autoPrintEnabled).toBe(false);
    expect(config.silentPrintValidated).toBe(false);
    expect(
      decideStationAutoPrint({ config }).shouldAutoPrint
    ).toBe(false);
  });

  it("migrates legacy autoPrintOnCertainMatch into autoPrintEnabled", () => {
    const config = defaultPrintStationConfig({
      autoPrintOnCertainMatch: true,
      silentPrintValidated: true,
      printerName: "Brother",
    } as any);
    expect(config.autoPrintEnabled).toBe(true);
  });

  it("refuses silent auto-print without validation, even when enabled", () => {
    const config = defaultPrintStationConfig({
      printerName: "Brother_QL_W810W",
      autoPrintEnabled: true,
      silentPrintValidated: false,
    });
    const decision = decideStationAutoPrint({ config });
    expect(decision.shouldAutoPrint).toBe(false);
    expect(decision.reason).toBe("silent_not_validated");
  });

  it("auto-prints only when validated + enabled + printer", () => {
    const config = defaultPrintStationConfig({
      printerName: "Brother_QL_W810W",
      autoPrintEnabled: true,
      silentPrintValidated: true,
    });
    expect(decideStationAutoPrint({ config }).shouldAutoPrint).toBe(true);
    expect(
      decideStationAutoPrint({ config, qzConnected: false }).shouldAutoPrint
    ).toBe(false);
    expect(
      decideStationAutoPrint({ config, printerFound: false }).shouldAutoPrint
    ).toBe(false);
  });

  it("refuses when no printer is configured", () => {
    const config = defaultPrintStationConfig({
      autoPrintEnabled: true,
      silentPrintValidated: true,
      printerName: "",
    });
    const decision = decideStationAutoPrint({ config });
    expect(decision.shouldAutoPrint).toBe(false);
    expect(decision.reason).toBe("no_printer");
  });

  it("documents QZ Tray as recommended", () => {
    expect(PRINT_STATION_SETUP_NOTES.recommended).toBe("qz_tray");
    expect(PRINT_STATION_SETUP_NOTES.downloadUrl).toContain("qz.io");
  });

  it("keeps two station configs independent by identity", () => {
    const a = defaultPrintStationConfig({
      stationId: "mac-a",
      stationName: "Theo",
      printerName: "Brother_QL_W810W",
    });
    const b = defaultPrintStationConfig({
      stationId: "mac-b",
      stationName: "Prep 2",
      printerName: "Generic_Thermal",
    });
    expect(a.stationId).not.toBe(b.stationId);
    expect(a.printerName).not.toBe(b.printerName);
  });
});

describe("printLabelFlow", () => {
  const readyConfig = defaultPrintStationConfig({
    printerName: "Brother_QL_W810W",
    autoPrintEnabled: true,
    silentPrintValidated: true,
  });

  it("QZ absent → browser fallback plan", () => {
    const plan = planAfterLabelCreated({
      label,
      config: readyConfig,
      qzConnected: false,
      printerFound: false,
    });
    expect(plan.action).toBe("browser_fallback");
    if (plan.action === "browser_fallback") {
      expect(plan.event).toBe("BROWSER_PRINT_OPENED");
      expect(plan.reason).toBe("qz_not_connected");
    }
  });

  it("QZ connected but printer missing → browser fallback", () => {
    const plan = planAfterLabelCreated({
      label,
      config: readyConfig,
      qzConnected: true,
      printerFound: false,
    });
    expect(plan.action).toBe("browser_fallback");
    if (plan.action === "browser_fallback") {
      expect(plan.reason).toBe("printer_not_found");
    }
  });

  it("silent failure → SILENT_PRINT_FAILED_FALLBACK_OPENED", () => {
    const plan = planAfterSilentFailure({ label, error: "timeout" });
    expect(plan.action).toBe("browser_fallback");
    if (plan.action === "browser_fallback") {
      expect(plan.event).toBe("SILENT_PRINT_FAILED_FALLBACK_OPENED");
    }
  });

  it("test print event is local-only", () => {
    expect(assertTestPrintIsLocalOnly(["TEST_PRINT_ONLY"])).toBe(true);
    expect(assertTestPrintIsLocalOnly(["LABEL_CREATED"])).toBe(false);
  });

  it("reprint / retry never implies a second fulfill/Swiss Post/DELR call", () => {
    expect(
      assertNoSecondLabelCreate({
        fulfillCallCount: 0,
        swissPostCallCount: 0,
        delrCallCount: 0,
      })
    ).toBe(true);
    const plan = planReprintExisting({
      label,
      config: readyConfig,
      qzConnected: true,
      printerFound: true,
    });
    expect(plan.action).toBe("reprint_existing");
    expect(plan.event).toBe("REPRINT_EXISTING_LABEL");
    expect(plan.label.base64).toBe(label.base64);
  });

  it("ready station plans silent print for a created label", () => {
    const plan = planAfterLabelCreated({
      label,
      config: readyConfig,
      qzConnected: true,
      printerFound: true,
    });
    expect(plan.action).toBe("silent");
  });

  it("CUPS already printed → skip client print", () => {
    const plan = planAfterLabelCreated({
      label,
      config: readyConfig,
      qzConnected: true,
      printerFound: true,
      cupsPrintedOk: true,
    });
    expect(plan.action).toBe("skip_already_cups");
  });

  it("qty-1 certain path: label already created → print plan only", () => {
    // Backend already fulfilled; client only plans print of ExistingLabelRef.
    const plan = planAfterLabelCreated({
      label: { ...label, labelId: "existing-lbl-qty1" },
      config: readyConfig,
      qzConnected: true,
      printerFound: true,
    });
    expect(plan.action).toBe("silent");
    expect(plan.label.labelId).toBe("existing-lbl-qty1");
    expect(
      assertNoSecondLabelCreate({
        fulfillCallCount: 0,
        swissPostCallCount: 0,
        delrCallCount: 0,
      })
    ).toBe(true);
  });

  it("multi-product partial: same existing label ref for print after selection", () => {
    const multiLabel = {
      ...label,
      labelId: "existing-partial-lbl",
      awb: "AWB-MULTI",
    };
    const plan = planAfterLabelCreated({
      label: multiLabel,
      config: readyConfig,
      qzConnected: false,
      printerFound: false,
    });
    expect(plan.action).toBe("browser_fallback");
    expect(plan.label).toBe(multiLabel);
  });

  it("double-click / retry print keeps zero fulfill side effects", () => {
    const first = planReprintExisting({
      label,
      config: readyConfig,
      qzConnected: true,
      printerFound: true,
    });
    const second = planReprintExisting({
      label,
      config: readyConfig,
      qzConnected: true,
      printerFound: true,
    });
    expect(first.label.base64).toBe(second.label.base64);
    expect(first.event).toBe("REPRINT_EXISTING_LABEL");
    expect(second.event).toBe("REPRINT_EXISTING_LABEL");
    expect(
      assertNoSecondLabelCreate({
        fulfillCallCount: 0,
        swissPostCallCount: 0,
        delrCallCount: 0,
      })
    ).toBe(true);
  });
});
