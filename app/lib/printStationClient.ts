"use client";

/**
 * Browser-side print-station preferences + QZ Tray bridge.
 * Falls back to { ok:false } so callers open the browser PDF popup.
 *
 * HONESTY CONTRACT — never claim silent print is ready unless BOTH:
 *   1. `window.qz` exists and its websocket is active on localhost.
 *   2. The operator confirmed a physical test (`silentPrintValidated`).
 *   3. The configured printer is present in the QZ printer list.
 *
 * Creating labels is backend-only. This module only prints an existing PDF.
 */

import {
  PRINT_STATION_STORAGE_KEY,
  QZ_TRAY_DOWNLOAD_URL,
  STATION_TEST_LABEL_PDF_BASE64,
  defaultPrintStationConfig,
  decideStationAutoPrint,
  type ExistingLabelRef,
  type LabelPrintJob,
  type PrintFlowEvent,
  type PrintStationConfig,
} from "@/lib/printStation";
import {
  planAfterLabelCreated,
  planAfterSilentFailure,
  planReprintExisting,
} from "@/lib/printLabelFlow";

declare global {
  interface Window {
    qz?: {
      websocket: {
        connect: (opts?: Record<string, unknown>) => Promise<void>;
        disconnect?: () => Promise<void>;
        isActive: () => boolean;
      };
      printers: {
        find: (name?: string) => Promise<string | string[]>;
        getDefault?: () => Promise<string>;
      };
      configs: {
        create: (printer: string, options?: Record<string, unknown>) => unknown;
      };
      print: (config: unknown, data: unknown[]) => Promise<void>;
      security?: {
        setCertificatePromise: (fn: () => Promise<string>) => void;
        setSignaturePromise: (fn: (toSign: string) => Promise<string>) => void;
      };
      api?: { version?: string };
    };
  }
}

const QZ_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/qz-tray@2.2.4/qz-tray.js";

let qzScriptPromise: Promise<boolean> | null = null;
let qzSecurityWired = false;

export function loadPrintStationConfig(): PrintStationConfig {
  if (typeof window === "undefined") return defaultPrintStationConfig();
  try {
    const raw = window.localStorage.getItem(PRINT_STATION_STORAGE_KEY);
    if (!raw) return defaultPrintStationConfig();
    return defaultPrintStationConfig(JSON.parse(raw) as Partial<PrintStationConfig>);
  } catch {
    return defaultPrintStationConfig();
  }
}

export function savePrintStationConfig(config: PrintStationConfig): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PRINT_STATION_STORAGE_KEY, JSON.stringify(config));
}

export function clearPrintStationConfig(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(PRINT_STATION_STORAGE_KEY);
}

export async function ensureQzScriptLoaded(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (window.qz?.websocket) return true;
  if (qzScriptPromise) return qzScriptPromise;

  qzScriptPromise = new Promise<boolean>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-qz-tray]");
    if (existing) {
      existing.addEventListener("load", () => resolve(Boolean(window.qz?.websocket)));
      existing.addEventListener("error", () => resolve(false));
      if (window.qz?.websocket) resolve(true);
      return;
    }
    const script = document.createElement("script");
    script.src = QZ_SCRIPT_URL;
    script.async = true;
    script.dataset.qzTray = "1";
    script.onload = () => resolve(Boolean(window.qz?.websocket));
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });

  return qzScriptPromise;
}

async function wireQzSecurity(): Promise<{ signed: boolean; error?: string }> {
  if (typeof window === "undefined" || !window.qz?.security) {
    return { signed: false, error: "QZ security API missing" };
  }
  if (qzSecurityWired) return { signed: true };

  // Probe once — if server has no cert/key, leave QZ unsigned (prompt / fail → browser).
  try {
    const probe = await fetch("/api/qz/certificate");
    const data = await probe.json().catch(() => ({}));
    if (!probe.ok || !data?.certificate) {
      return { signed: false, error: data?.error || "QZ certificate not configured" };
    }
    window.qz.security.setCertificatePromise(async () => String(data.certificate));
    window.qz.security.setSignaturePromise((toSign: string) =>
      fetch("/api/qz/sign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request: toSign }),
      }).then(async (res) => {
        const signed = await res.json();
        if (!res.ok || !signed?.signature) {
          throw new Error(signed?.error || "Sign unavailable");
        }
        return String(signed.signature);
      })
    );
    qzSecurityWired = true;
    return { signed: true };
  } catch (err: any) {
    return { signed: false, error: err?.message || String(err) };
  }
}

export async function ensureQzConnected(): Promise<boolean> {
  const loaded = await ensureQzScriptLoaded();
  if (!loaded) return false;
  const qz = window.qz;
  if (!qz?.websocket) return false;
  await wireQzSecurity();
  try {
    if (!qz.websocket.isActive()) {
      await qz.websocket.connect();
    }
    return qz.websocket.isActive();
  } catch {
    return false;
  }
}

export async function listQzPrinters(): Promise<string[]> {
  const connected = await ensureQzConnected();
  if (!connected || !window.qz) return [];
  try {
    const found = await window.qz.printers.find();
    if (Array.isArray(found)) return found.map(String);
    if (found) return [String(found)];
    return [];
  } catch {
    return [];
  }
}

export async function isConfiguredPrinterFound(
  printerName: string,
  printers?: string[]
): Promise<boolean> {
  const name = String(printerName || "").trim().toLowerCase();
  if (!name) return false;
  const list = printers ?? (await listQzPrinters());
  return list.some((p) => String(p).trim().toLowerCase() === name);
}

export type PrintStationProbeStatus = {
  qzInstalled: boolean;
  qzConnected: boolean;
  printerConfigured: boolean;
  printerFound: boolean;
  silentPrintValidated: boolean;
  autoPrintOn: boolean;
  stationName: string;
  printerName: string;
  labelFormat: string;
  /** True iff we would silent-print right now. */
  readyForSilentPrint: boolean;
  reason:
    | "ready"
    | "qz_not_installed"
    | "qz_not_connected"
    | "no_printer"
    | "printer_not_found"
    | "silent_not_validated"
    | "auto_off";
};

export async function probePrintStationStatus(
  config?: PrintStationConfig
): Promise<PrintStationProbeStatus> {
  const cfg = config ?? loadPrintStationConfig();
  await ensureQzScriptLoaded();
  const qz = typeof window !== "undefined" ? window.qz : undefined;
  const qzInstalled = Boolean(qz?.websocket);
  let qzConnected = false;
  let printerFound = false;
  if (qzInstalled) {
    qzConnected = await ensureQzConnected();
    if (qzConnected && cfg.printerName) {
      printerFound = await isConfiguredPrinterFound(cfg.printerName);
    }
  }
  const printerConfigured = Boolean(String(cfg.printerName || "").trim());

  let reason: PrintStationProbeStatus["reason"];
  if (!cfg.autoPrintEnabled) reason = "auto_off";
  else if (!cfg.silentPrintValidated) reason = "silent_not_validated";
  else if (!qzInstalled) reason = "qz_not_installed";
  else if (!qzConnected) reason = "qz_not_connected";
  else if (!printerConfigured) reason = "no_printer";
  else if (!printerFound) reason = "printer_not_found";
  else reason = "ready";

  const format = cfg.continuousLabel
    ? `${cfg.labelWidthMm}mm continuous`
    : `${cfg.labelWidthMm}×${cfg.labelHeightMm}mm`;

  return {
    qzInstalled,
    qzConnected,
    printerConfigured,
    printerFound,
    silentPrintValidated: Boolean(cfg.silentPrintValidated),
    autoPrintOn: Boolean(cfg.autoPrintEnabled),
    stationName: cfg.stationName || cfg.stationId,
    printerName: cfg.printerName,
    labelFormat: format,
    readyForSilentPrint: reason === "ready",
    reason,
  };
}

function buildQzConfigOptions(config: PrintStationConfig, copies: number) {
  const opts: Record<string, unknown> = {
    units: "mm",
    copies,
    orientation: config.orientation,
    size: {
      width: config.labelWidthMm,
      height: config.continuousLabel ? "" : config.labelHeightMm,
    },
  };
  if (config.dpi) {
    opts.density = config.dpi;
  }
  return opts;
}

async function qzPrintPdf(
  config: PrintStationConfig,
  job: LabelPrintJob
): Promise<{ ok: boolean; error?: string }> {
  const ready = await ensureQzConnected();
  if (!ready || !window.qz) {
    return { ok: false, error: "QZ Tray unavailable" };
  }
  const printer = String(config.printerName || "").trim();
  if (!printer) return { ok: false, error: "No printer configured" };
  const found = await isConfiguredPrinterFound(printer);
  if (!found) return { ok: false, error: `Printer not found: ${printer}` };

  try {
    const qzConfig = window.qz.configs.create(
      printer,
      buildQzConfigOptions(config, job.copies ?? 1)
    );
    const data = [
      {
        type: "pixel",
        format: job.extension === "pdf" ? "pdf" : job.extension,
        flavor: "base64",
        data: job.base64,
      },
    ];
    await window.qz.print(qzConfig, data);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * Attempt station silent print. Never creates a label.
 */
export async function tryStationAutoPrint(params: {
  job: LabelPrintJob;
  config?: PrintStationConfig;
}): Promise<{ ok: boolean; skipped?: boolean; error?: string; reason?: string }> {
  const config = params.config ?? loadPrintStationConfig();
  const qzConnected = await ensureQzConnected();
  const printerFound = qzConnected
    ? await isConfiguredPrinterFound(config.printerName)
    : false;
  const decision = decideStationAutoPrint({
    config,
    qzConnected,
    printerFound,
  });
  if (!decision.shouldAutoPrint) {
    return { ok: false, skipped: true, reason: decision.reason };
  }

  if (config.provider !== "qz_tray") {
    return {
      ok: false,
      skipped: true,
      reason: `provider_${config.provider}_not_client_wired`,
    };
  }

  const printed = await qzPrintPdf(config, params.job);
  if (!printed.ok) {
    return { ok: false, error: printed.error, reason: "qz_error" };
  }
  return { ok: true, reason: "qz_tray" };
}

/**
 * Station test print — local PDF only. Never calls fulfill / Swiss Post / DELR.
 */
export async function printStationTestLabel(
  config?: PrintStationConfig
): Promise<{ ok: boolean; error?: string; event: PrintFlowEvent }> {
  const cfg = config ?? loadPrintStationConfig();
  const job: LabelPrintJob = {
    base64: STATION_TEST_LABEL_PDF_BASE64,
    extension: "pdf",
    jobName: `station-test-${cfg.stationId}`,
    copies: 1,
  };
  const printed = await qzPrintPdf(cfg, job);
  if (!printed.ok) {
    return { ok: false, error: printed.error, event: "TEST_PRINT_ONLY" };
  }
  return { ok: true, event: "TEST_PRINT_ONLY" };
}

export type PresentExistingLabelResult = {
  events: PrintFlowEvent[];
  usedSilent: boolean;
  usedBrowserFallback: boolean;
  printConfirmed: boolean;
  error?: string;
};

/**
 * After backend returns an existing label: silent print or browser fallback.
 * Never calls fulfill APIs.
 */
export async function presentExistingLabel(params: {
  label: ExistingLabelRef;
  config?: PrintStationConfig;
  cupsPrintedOk?: boolean;
  openBrowserPrint: (label: ExistingLabelRef) => boolean;
  onEvent?: (event: PrintFlowEvent, detail?: string) => void;
  /** When true, skip auto decision and treat as reprint of same bytes. */
  isReprint?: boolean;
}): Promise<PresentExistingLabelResult> {
  const config = params.config ?? loadPrintStationConfig();
  const events: PrintFlowEvent[] = [];
  const emit = (event: PrintFlowEvent, detail?: string) => {
    events.push(event);
    params.onEvent?.(event, detail);
  };

  if (!params.isReprint) {
    emit("LABEL_CREATED");
  }

  if (params.cupsPrintedOk) {
    return {
      events,
      usedSilent: false,
      usedBrowserFallback: false,
      printConfirmed: true,
    };
  }

  const qzConnected = await ensureQzConnected();
  const printerFound = qzConnected
    ? await isConfiguredPrinterFound(config.printerName)
    : false;

  const plan = params.isReprint
    ? planReprintExisting({
        label: params.label,
        config,
        qzConnected,
        printerFound,
      })
    : planAfterLabelCreated({
        label: params.label,
        config,
        qzConnected,
        printerFound,
        cupsPrintedOk: false,
      });

  if (plan.action === "silent" || (plan.action === "reprint_existing" && plan.preferSilent)) {
    const job: LabelPrintJob = {
      base64: params.label.base64,
      extension: params.label.extension === "png" ? "png" : "pdf",
      jobName: params.label.filename || params.label.awb || "label",
      copies: 1,
    };
    const printed = await qzPrintPdf(config, job);
    if (printed.ok) {
      emit(params.isReprint ? "REPRINT_EXISTING_LABEL" : "SILENT_PRINT_SUCCEEDED");
      return {
        events,
        usedSilent: true,
        usedBrowserFallback: false,
        printConfirmed: true,
      };
    }
    const failPlan = planAfterSilentFailure({
      label: params.label,
      error: printed.error || "qz_error",
    });
    emit(failPlan.event, failPlan.reason);
    const opened = params.openBrowserPrint(params.label);
    if (!opened) {
      return {
        events,
        usedSilent: false,
        usedBrowserFallback: false,
        printConfirmed: false,
        error: printed.error || "silent failed and browser popup blocked",
      };
    }
    return {
      events,
      usedSilent: false,
      usedBrowserFallback: true,
      printConfirmed: false,
      error: printed.error,
    };
  }

  if (params.isReprint) {
    emit("REPRINT_EXISTING_LABEL");
  } else if (plan.action === "browser_fallback") {
    emit(plan.event, plan.reason);
  }

  const opened = params.openBrowserPrint(params.label);
  if (!opened) {
    return {
      events,
      usedSilent: false,
      usedBrowserFallback: false,
      printConfirmed: false,
      error: "browser popup blocked",
    };
  }
  if (!params.isReprint && plan.action !== "browser_fallback") {
    emit("BROWSER_PRINT_OPENED");
  }
  return {
    events,
    usedSilent: false,
    usedBrowserFallback: true,
    printConfirmed: false,
  };
}

export { QZ_TRAY_DOWNLOAD_URL };
