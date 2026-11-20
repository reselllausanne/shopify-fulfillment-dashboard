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
  /** Label media — per station (Brother 62×100 vs other thermal). */
  labelWidthMm: number;
  labelHeightMm: number;
  /** Continuous roll — height still used as cut length for QZ. */
  continuousLabel: boolean;
  orientation: PrintLabelOrientation;
  /** Optional driver DPI (null = let QZ/driver choose). Brother QL ≈ 300. */
  dpi: number | null;
  /** Margins in mm (per station). */
  marginTopMm: number;
  marginRightMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  /** Scale PDF to configured size (QZ scaleContent). Default true. */
  scaleContent: boolean;
  /**
   * If true, do not send size{} to QZ — use printer driver default paper.
   * Useful when the OS already has the correct Brother DK roll selected.
   */
  useDriverPaperSize: boolean;
  /**
   * Auto-print after a successful backend label create.
   * DEFAULT FALSE — operator must opt in after a confirmed test print.
   */
  autoPrintEnabled: boolean;
  /**
   * Legacy alias kept in sync with autoPrintEnabled (main Activate UI).
   * @deprecated Prefer autoPrintEnabled
   */
  autoPrintOnCertainMatch: boolean;
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

/** Saved per-printer configs on this browser (printerName → config). */
export const PRINT_STATION_PROFILES_STORAGE_KEY = "resell.printStation.profiles.v1";

export type PrintStationProfiles = Record<string, PrintStationConfig>;

/** Parse stored profiles; drops junk entries. Pure. */
export function parsePrintStationProfiles(raw: string | null | undefined): PrintStationProfiles {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<PrintStationConfig>>;
    if (!parsed || typeof parsed !== "object") return {};
    const out: PrintStationProfiles = {};
    for (const [name, cfg] of Object.entries(parsed)) {
      if (!name.trim() || !cfg || typeof cfg !== "object") continue;
      out[name] = defaultPrintStationConfig({ ...cfg, printerName: name });
    }
    return out;
  } catch {
    return {};
  }
}

/** Add/replace the profile keyed by config.printerName. No printer → unchanged. Pure. */
export function upsertPrintStationProfile(
  profiles: PrintStationProfiles,
  config: PrintStationConfig
): PrintStationProfiles {
  const name = String(config.printerName || "").trim();
  if (!name) return profiles;
  return { ...profiles, [name]: { ...config, printerName: name } };
}

export const QZ_TRAY_DOWNLOAD_URL = "https://qz.io/download/";

export const LABEL_PRESETS = [
  {
    // QZ ignores the CUPS queue paper and prints on A4 when no size is sent, so the
    // size is explicit here; scaleContent fits the PDF to it (like lp fit-to-page).
    id: "bixolon-4x5",
    label: "BIXOLON 4 × 5 po (102 × 127 mm, portrait, ajusté)",
    widthMm: 102,
    heightMm: 127,
    continuous: false,
    dpi: 203,
    extra: {
      useDriverPaperSize: false,
      scaleContent: true,
      orientation: "portrait",
    } as Partial<PrintStationConfig>,
  },
  {
    id: "62x100",
    label: "62 × 100 mm (Swiss Post / Brother QL)",
    widthMm: 62,
    heightMm: 100,
    continuous: false,
    dpi: 300,
  },
  {
    id: "62x29",
    label: "62 × 29 mm (Brother DK)",
    widthMm: 62,
    heightMm: 29,
    continuous: false,
    dpi: 300,
  },
  {
    id: "58x40",
    label: "58 × 40 mm (thermique générique)",
    widthMm: 58,
    heightMm: 40,
    continuous: false,
    dpi: 203,
  },
  {
    id: "80x50",
    label: "80 × 50 mm (thermique)",
    widthMm: 80,
    heightMm: 50,
    continuous: false,
    dpi: 203,
  },
  {
    id: "62-cont",
    label: "62 mm continuous (hauteur = coupe)",
    widthMm: 62,
    heightMm: 100,
    continuous: true,
    dpi: 300,
  },
  {
    id: "custom",
    label: "Custom (largeur / hauteur / DPI)",
    widthMm: 62,
    heightMm: 100,
    continuous: false,
    dpi: null as number | null,
  },
] as const;

/**
 * Pure QZ pixel config from station settings.
 *
 * IMPORTANT: with `units: "mm"`, QZ treats `density` as dots-per-mm, NOT DPI.
 * Sending density: 300 with mm units (≈ 7620 DPI) breaks Brother/thermal jobs.
 * We either omit density (driver default) or convert DPI → dpmm.
 */
export function buildQzPixelConfigOptions(
  config: PrintStationConfig,
  copies: number
): Record<string, unknown> {
  const opts: Record<string, unknown> = {
    units: "mm",
    copies: Math.max(1, copies || 1),
    orientation: config.orientation,
    // Autoscale + custom size is a common QZ/thermal failure mode.
    scaleContent: config.scaleContent === true,
    colorType: "grayscale",
    margins: {
      top: config.marginTopMm || 0,
      right: config.marginRightMm || 0,
      bottom: config.marginBottomMm || 0,
      left: config.marginLeftMm || 0,
    },
  };

  // Default path: let the OS/Brother driver pick the roll — most reliable.
  if (config.useDriverPaperSize) {
    return opts;
  }

  const width = Number(config.labelWidthMm);
  const height = Number(config.labelHeightMm);
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    opts.size = { width, height };
  }

  if (config.dpi != null && Number.isFinite(config.dpi) && config.dpi > 0) {
    // DPI → dots per mm (units are mm)
    opts.density = Number(config.dpi) / 25.4;
  }

  return opts;
}

/** PDF data options — only when forcing custom size (not driver paper). */
export function buildQzPdfDataOptions(config: PrintStationConfig): Record<string, unknown> | undefined {
  if (config.useDriverPaperSize) return undefined;
  const width = Number(config.labelWidthMm);
  const height = Number(config.labelHeightMm);
  if (!(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0)) {
    return undefined;
  }
  return {
    pageWidth: width,
    pageHeight: height,
    ignoreTransparency: true,
  };
}

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
  const numOr = (v: unknown, fallback: number) =>
    v != null && Number.isFinite(Number(v)) ? Number(v) : fallback;

  return {
    stationId: partial?.stationId || newStationId(),
    stationName: String(partial?.stationName ?? "").trim(),
    provider: partial?.provider || "qz_tray",
    printerName: partial?.printerName || "",
    labelWidthMm: numOr(partial?.labelWidthMm, DEFAULT_LABEL_WIDTH_MM),
    labelHeightMm: numOr(partial?.labelHeightMm, DEFAULT_LABEL_HEIGHT_MM),
    continuousLabel: partial?.continuousLabel ?? false,
    orientation: partial?.orientation === "landscape" ? "landscape" : "portrait",
    dpi:
      partial?.dpi != null && Number.isFinite(Number(partial.dpi)) && Number(partial.dpi) > 0
        ? Math.round(Number(partial.dpi))
        : null,
    marginTopMm: numOr(partial?.marginTopMm, 0),
    marginRightMm: numOr(partial?.marginRightMm, 0),
    marginBottomMm: numOr(partial?.marginBottomMm, 0),
    marginLeftMm: numOr(partial?.marginLeftMm, 0),
    // Off by default — scaleContent+custom size breaks many thermals in QZ.
    scaleContent: partial?.scaleContent === true,
    // On by default — OS/Brother roll is the reliable path; mm is optional override.
    useDriverPaperSize: partial?.useDriverPaperSize !== false,
    autoPrintEnabled,
    autoPrintOnCertainMatch: autoPrintEnabled,
    silentPrintValidated: partial?.silentPrintValidated ?? false,
    silentPrintValidatedAt: partial?.silentPrintValidatedAt ?? null,
  };
}

export type AutoPrintDecision = {
  shouldAutoPrint: boolean;
  reason:
    | "ready"
    | "certain_match"
    | "ambiguous_match"
    | "disabled"
    | "off"
    | "no_printer"
    | "silent_not_validated"
    | "qz_not_connected"
    | "printer_not_found"
    | "uncertain";
};

/**
 * Pure config gate for silent auto-print (does not probe live QZ).
 * Accepts main's matchCertainty and/or live qzConnected/printerFound flags.
 */
export function decideStationAutoPrint(params: {
  config: PrintStationConfig;
  matchCertainty?: "certain" | "ambiguous" | "none";
  qzConnected?: boolean;
  printerFound?: boolean;
}): AutoPrintDecision {
  const enabled =
    params.config.autoPrintEnabled || params.config.autoPrintOnCertainMatch;
  if (!enabled) {
    return { shouldAutoPrint: false, reason: "off" };
  }
  if (!params.config.silentPrintValidated) {
    return { shouldAutoPrint: false, reason: "silent_not_validated" };
  }
  if (!String(params.config.printerName || "").trim() && params.config.provider !== "browser") {
    return { shouldAutoPrint: false, reason: "no_printer" };
  }
  if (params.matchCertainty === "ambiguous") {
    return { shouldAutoPrint: false, reason: "ambiguous_match" };
  }
  if (params.matchCertainty === "none") {
    return { shouldAutoPrint: false, reason: "uncertain" };
  }
  if (params.qzConnected === false) {
    return { shouldAutoPrint: false, reason: "qz_not_connected" };
  }
  if (params.printerFound === false) {
    return { shouldAutoPrint: false, reason: "printer_not_found" };
  }
  if (params.matchCertainty === "certain") {
    return { shouldAutoPrint: true, reason: "certain_match" };
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
 * Fake Swiss Post label (all zeros) for station test prints: same page size as the
 * real one (297 x 209 pt, landscape) so test = real layout/rotation/centering.
 * Border + corner marks show clipping/centering. Does NOT call Swiss Post / Shopify / DELR.
 */
export function buildTestLabelPdf(): string {
  const W = 297;
  const H = 209;
  const bars: string[] = [];
  // Fake barcode: deterministic bar widths.
  let x = 20;
  const widths = [2, 1, 3, 1, 2, 2, 1, 3, 2, 1, 1, 3, 2, 1, 2, 3, 1, 1, 2, 2];
  for (let i = 0; i < 38; i++) {
    const w = widths[i % widths.length];
    if (i % 2 === 0) bars.push(`${x} 100 ${w} 60 re f`);
    x += w + 1;
  }
  const content = [
    "2 w 4 4 289 201 re S", // border (clipping check)
    "0 0 12 12 re f", // corner marks
    `${W - 12} 0 12 12 re f`,
    `0 ${H - 12} 12 12 re f`,
    `${W - 12} ${H - 12} 12 12 re f`,
    ...bars,
    "BT /F1 16 Tf 20 175 Td (TEST LABEL - SWISS POST) Tj ET",
    "BT /F1 18 Tf 20 75 Td (99.60.000000.00000000) Tj ET",
    "BT /F1 11 Tf 20 55 Td (Max Muster) Tj 0 -14 Td (Teststrasse 0) Tj 0 -14 Td (0000 Testort) Tj ET",
  ].join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}

export const STATION_TEST_LABEL_PDF_BASE64 = (() => {
  const pdf = buildTestLabelPdf();
  return typeof btoa === "function"
    ? btoa(pdf)
    : Buffer.from(pdf, "binary").toString("base64");
})();
