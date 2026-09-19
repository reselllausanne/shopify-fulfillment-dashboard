/**
 * Per-station auto-print architecture.
 *
 * Preferred path for packing desks: QZ Tray (browser → local websocket →
 * OS printer). Each station stores its own printer name in localStorage.
 * Same label PDF/format everywhere; only the queue differs (Brother QL-W810
 * vs another thermal).
 *
 * Fallback chain (certain match only):
 *   1. QZ Tray (client) if configured + validated silent print
 *   2. Server CUPS (`LOCAL_STATION` + lp) when request hits a packing Mac
 *   3. Browser print popup (existing SCAN_BROWSER_PRINT_*)
 *
 * HONESTY CONTRACT — this module never claims silent print works unless the
 * station operator has explicitly confirmed a physical test print
 * (`silentPrintValidated`) for THIS install. Default config disables
 * auto-print until QZ has been proven end to end on the specific printer.
 *
 * Creating a Swiss Post / Shopify / DELR label is a BACKEND operation.
 * Printing is a SEPARATE local operation. Print failures must never create
 * a second label.
 */

export type PrintStationProvider = "qz_tray" | "printnode" | "cups" | "browser";

export type PrintLabelOrientation = "portrait" | "landscape";

export type PrintStationConfig = {
  stationId: string;
  /** Human name shown on /scan, e.g. "Theo - maison". */
  stationName: string;
  provider: PrintStationProvider;
  /** OS / QZ printer name, e.g. "Brother_QL_W810W". */
  printerName: string;
  /** Label media hint — same physical format for all stations. */
  labelWidthMm: number;
  labelHeightMm: number;
  /** Continuous roll (ignore height for media selection). */
  continuousLabel: boolean;
  orientation: PrintLabelOrientation;
  /** Optional driver DPI (null = let QZ/driver choose). */
  dpi: number | null;
  /**
   * Auto-print after a successful backend label create.
   * DEFAULT FALSE — operator must opt in after a confirmed test print.
   */
  autoPrintEnabled: boolean;
  /**
   * Operator confirmed a physical test label on this station
   * (QZ Tray installed, printer found, format OK). Required for silent print.
   */
  silentPrintValidated: boolean;
  /** ISO timestamp of last successful test confirmation. */
  silentPrintValidatedAt: string | null;
};

/** @deprecated Prefer autoPrintEnabled — kept for localStorage migration. */
export type LegacyPrintStationConfig = PrintStationConfig & {
  autoPrintOnCertainMatch?: boolean;
};

export const DEFAULT_LABEL_WIDTH_MM = 62;
export const DEFAULT_LABEL_HEIGHT_MM = 100;

export const PRINT_STATION_STORAGE_KEY = "resell.printStation.v1";

export const QZ_TRAY_DOWNLOAD_URL = "https://qz.io/download/";

export const LABEL_PRESETS = [
  { id: "62x100", label: "62 × 100 mm (Swiss Post / Brother QL)", widthMm: 62, heightMm: 100, continuous: false },
  { id: "62x29", label: "62 × 29 mm", widthMm: 62, heightMm: 29, continuous: false },
  { id: "62-cont", label: "62 mm continuous", widthMm: 62, heightMm: 100, continuous: true },
  { id: "custom", label: "Custom", widthMm: 62, heightMm: 100, continuous: false },
] as const;

export function newStationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `station-${Date.now().toString(36)}`;
}

export function defaultPrintStationConfig(
  partial?: Partial<PrintStationConfig> & { autoPrintOnCertainMatch?: boolean }
): PrintStationConfig {
  const autoPrintEnabled =
    partial?.autoPrintEnabled ??
    partial?.autoPrintOnCertainMatch ??
    false;
  return {
    stationId: partial?.stationId || newStationId(),
    stationName: String(partial?.stationName ?? "").trim(),
    provider: partial?.provider || "qz_tray",
    printerName: partial?.printerName || "",
    labelWidthMm: partial?.labelWidthMm ?? DEFAULT_LABEL_WIDTH_MM,
    labelHeightMm: partial?.labelHeightMm ?? DEFAULT_LABEL_HEIGHT_MM,
    continuousLabel: partial?.continuousLabel ?? false,
    orientation: partial?.orientation === "landscape" ? "landscape" : "portrait",
    dpi:
      partial?.dpi != null && Number.isFinite(Number(partial.dpi)) && Number(partial.dpi) > 0
        ? Math.round(Number(partial.dpi))
        : null,
    autoPrintEnabled,
    silentPrintValidated: partial?.silentPrintValidated ?? false,
    silentPrintValidatedAt: partial?.silentPrintValidatedAt ?? null,
  };
}

export type AutoPrintDecision = {
  shouldAutoPrint: boolean;
  reason:
    | "ready"
    | "disabled"
    | "no_printer"
    | "silent_not_validated"
    | "qz_not_connected"
    | "printer_not_found"
    | "uncertain";
};

/**
 * Pure config gate for silent auto-print (does not probe live QZ).
 * Live connectivity is checked by the client before printing.
 */
export function decideStationAutoPrint(params: {
  config: PrintStationConfig;
  qzConnected?: boolean;
  printerFound?: boolean;
}): AutoPrintDecision {
  if (!params.config.autoPrintEnabled) {
    return { shouldAutoPrint: false, reason: "disabled" };
  }
  if (!params.config.silentPrintValidated) {
    return { shouldAutoPrint: false, reason: "silent_not_validated" };
  }
  if (!String(params.config.printerName || "").trim() && params.config.provider !== "browser") {
    return { shouldAutoPrint: false, reason: "no_printer" };
  }
  if (params.qzConnected === false) {
    return { shouldAutoPrint: false, reason: "qz_not_connected" };
  }
  if (params.printerFound === false) {
    return { shouldAutoPrint: false, reason: "printer_not_found" };
  }
  return { shouldAutoPrint: true, reason: "ready" };
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

export type PrintFlowEvent =
  | "LABEL_CREATED"
  | "SILENT_PRINT_SUCCEEDED"
  | "SILENT_PRINT_FAILED_FALLBACK_OPENED"
  | "BROWSER_PRINT_OPENED"
  | "REPRINT_EXISTING_LABEL"
  | "TEST_PRINT_ONLY";

export type ExistingLabelRef = {
  base64: string;
  mimeType: string;
  extension?: "pdf" | "png";
  filename?: string | null;
  /** Opaque id from backend when available — never used to create a new label. */
  labelId?: string | null;
  /** AWB / scan code for display only. */
  awb?: string | null;
  createdAt: string;
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
  downloadUrl: QZ_TRAY_DOWNLOAD_URL,
} as const;

/**
 * Minimal valid PDF used only for station test prints.
 * Does NOT call Swiss Post / Shopify / DELR / fulfill-from-awb.
 */
export const STATION_TEST_LABEL_PDF_BASE64 =
  "JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCjIgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFszIDAgUl0KL0NvdW50IDEKPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL1BhZ2UKL1BhcmVudCAyIDAgUgovTWVkaWFCb3ggWzAgMCA0NDAgNzA5XQovQ29udGVudHMgNCAwIFIKL1Jlc291cmNlczogPDwKL0ZvbnQgPDwKL0YxIDUgMCBSCj4+Cj4+Cj4+CmVuZG9iago0IDAgb2JqCjw8Ci9MZW5ndGggODgKPj4Kc3RyZWFtCkJUCi9GMSAyNCBUZgo1MCA2NTAgVGQKKFRFU1QgTEFCRUwpIFRqCjUwIDYwMCBUZAooUmVzZWxsIHByaW50IHN0YXRpb24pIFRqCkVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PAovVHlwZSAvRm9udAovU3VidHlwZSAvVHlwZTEKL0Jhc2VGb250IC9IZWx2ZXRpY2EKPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxNSAwMDAwMCBuIAowMDAwMDAwMDY0IDAwMDAwIG4gCjAwMDAwMDAxMjEgMDAwMDAgbiAKMDAwMDAwMDI2NCAwMDAwMCBuIAowMDAwMDAwNDAzIDAwMDAwIG4gCnRyYWlsZXIKPDwKL1NpemUgNgovUm9vdCAxIDAgUgo+PgpzdGFydHhyZWYKNDc4CiUlRU9GCg==";
