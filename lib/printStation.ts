/**
 * Per-station auto-print architecture.
 *
 * Preferred path for packing desks: QZ Tray (browser → local websocket →
 * OS printer). Each station stores its own printer name in localStorage.
 * Same label PDF/format everywhere; only the queue differs (Brother QL-W810
 * vs another thermal).
 *
 * Fallback chain (certain match only):
 *   1. QZ Tray (client) if configured + reachable
 *   2. Server CUPS (`LOCAL_STATION` + lp) when request hits a packing Mac
 *   3. Browser print popup (existing SCAN_BROWSER_PRINT_*)
 *
 * PrintNode remains an optional cloud alternative for multi-site later;
 * interface is provider-agnostic so we can swap without changing callers.
 */

export type PrintStationProvider = "qz_tray" | "printnode" | "cups" | "browser";

export type PrintStationConfig = {
  stationId: string;
  provider: PrintStationProvider;
  /** OS / QZ printer name, e.g. "Brother_QL_W810W". */
  printerName: string;
  /** Label media hint — same physical format for all stations. */
  labelWidthMm: number;
  labelHeightMm: number;
  autoPrintOnCertainMatch: boolean;
};

export const DEFAULT_LABEL_WIDTH_MM = 62;
export const DEFAULT_LABEL_HEIGHT_MM = 100;

export const PRINT_STATION_STORAGE_KEY = "resell.printStation.v1";

export function defaultPrintStationConfig(
  partial?: Partial<PrintStationConfig>
): PrintStationConfig {
  return {
    stationId: partial?.stationId || "local",
    provider: partial?.provider || "qz_tray",
    printerName: partial?.printerName || "",
    labelWidthMm: partial?.labelWidthMm ?? DEFAULT_LABEL_WIDTH_MM,
    labelHeightMm: partial?.labelHeightMm ?? DEFAULT_LABEL_HEIGHT_MM,
    autoPrintOnCertainMatch: partial?.autoPrintOnCertainMatch ?? true,
  };
}

export type AutoPrintDecision = {
  shouldAutoPrint: boolean;
  reason:
    | "certain_match"
    | "ambiguous_match"
    | "disabled"
    | "no_printer"
    | "uncertain";
};

/** Auto-print only on certain (non-ambiguous) matches when station allows it. */
export function decideStationAutoPrint(params: {
  matchCertainty: "certain" | "ambiguous" | "none";
  config: PrintStationConfig;
}): AutoPrintDecision {
  if (!params.config.autoPrintOnCertainMatch) {
    return { shouldAutoPrint: false, reason: "disabled" };
  }
  if (!String(params.config.printerName || "").trim() && params.config.provider !== "browser") {
    return { shouldAutoPrint: false, reason: "no_printer" };
  }
  if (params.matchCertainty === "certain") {
    return { shouldAutoPrint: true, reason: "certain_match" };
  }
  if (params.matchCertainty === "ambiguous") {
    return { shouldAutoPrint: false, reason: "ambiguous_match" };
  }
  return { shouldAutoPrint: false, reason: "uncertain" };
}

export type LabelPrintJob = {
  base64: string;
  extension: "pdf" | "png" | "zpl";
  jobName: string;
  copies?: number;
};

/**
 * Provider adapter contract — implement QZ / PrintNode / CUPS behind this.
 * Client code calls `tryStationPrint`; failures fall through to browser.
 */
export type PrintStationAdapter = {
  provider: PrintStationProvider;
  isAvailable(): Promise<boolean>;
  print(config: PrintStationConfig, job: LabelPrintJob): Promise<{ ok: boolean; error?: string }>;
};

/** Docs + env hints for operators. */
export const PRINT_STATION_SETUP_NOTES = {
  recommended: "qz_tray" as PrintStationProvider,
  rationale:
    "QZ Tray keeps jobs on the packing station (no cloud hop), supports silent signed print, and works with Brother QL thermal drivers already used via CUPS.",
  alternatives: {
    printnode:
      "Useful if stations are managed centrally via API; requires PrintNode client + cloud routing.",
    cups:
      "Existing LOCAL_STATION path on the packing Mac — keep as server-side fallback.",
    browser: "Current SCAN_BROWSER_PRINT_* popup when local services are down.",
  },
  labelFormat: `${DEFAULT_LABEL_WIDTH_MM}x${DEFAULT_LABEL_HEIGHT_MM}mm PDF (Swiss Post)`,
} as const;
