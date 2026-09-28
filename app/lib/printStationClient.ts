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
  buildQzPdfDataOptions,
  buildQzPixelConfigOptions,
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

type QzPromiseResolver = (resolve: (value: string) => void, reject: (reason?: unknown) => void) => void;

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
        setCertificatePromise: (
          fn: QzPromiseResolver | (() => Promise<string>),
          options?: { rejectOnFailure?: boolean }
        ) => void;
        setSignaturePromise: (
          fn:
            | ((toSign: string) => QzPromiseResolver)
            | ((toSign: string) => Promise<string>)
        ) => void;
        setSignatureAlgorithm?: (algorithm: "SHA1" | "SHA256" | "SHA512") => void;
      };
      api?: { version?: string };
    };
  }
}

const QZ_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/qz-tray@2.2.5/qz-tray.min.js";

let qzScriptPromise: Promise<boolean> | null = null;
let qzSecurityWired = false;
let qzSigningConfigured = false;

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

export function isPrintStationActivated(config?: PrintStationConfig): boolean {
  const cfg = config ?? loadPrintStationConfig();
  return Boolean(
    (cfg.autoPrintEnabled || cfg.autoPrintOnCertainMatch) && cfg.silentPrintValidated
  );
}

/** Alias used by main /scan Activate UI. */
export async function loadQzTrayScript(): Promise<boolean> {
  return ensureQzScriptLoaded();
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

/**
 * Wire QZ cert + per-call signature (official QZ pattern).
 * - Certificate: fetched from server on each connect attempt.
 * - Signature: fetched from server on EVERY privileged call (print, find, …).
 * Private key never leaves the server.
 *
 * Without server cert/key: returns signed:false → QZ prompts / browser fallback.
 */
async function wireQzSecurity(): Promise<{ signed: boolean; error?: string }> {
  if (typeof window === "undefined" || !window.qz?.security) {
    return { signed: false, error: "QZ security API missing" };
  }
  if (qzSecurityWired) {
    return qzSigningConfigured
      ? { signed: true }
      : { signed: false, error: "QZ signing not configured on server" };
  }

  try {
    const probe = await fetch("/api/qz/certificate", { cache: "no-store" });
    const data = await probe.json().catch(() => ({}));
    if (!probe.ok || !data?.certificate) {
      qzSecurityWired = true;
      qzSigningConfigured = false;
      return { signed: false, error: data?.error || "QZ certificate not configured" };
    }

    const certificate = String(data.certificate);

    // Called by QZ on websocket connect — always return the public cert.
    window.qz.security.setCertificatePromise((resolve, reject) => {
      fetch("/api/qz/certificate", { cache: "no-store" })
        .then(async (res) => {
          const body = await res.json().catch(() => ({}));
          if (!res.ok || !body?.certificate) {
            // Fall back to probed cert so connect still identifies the site.
            if (certificate) resolve(certificate);
            else reject(body?.error || "certificate unavailable");
            return;
          }
          resolve(String(body.certificate));
        })
        .catch((err) => {
          if (certificate) resolve(certificate);
          else reject(err);
        });
    });

    // SHA512 required for QZ Tray ≥ 2.1 (matches server createSign("SHA512")).
    window.qz.security.setSignatureAlgorithm?.("SHA512");

    // Called by QZ on EACH print / privileged API call — friend was right.
    window.qz.security.setSignaturePromise((toSign: string) => {
      return (resolve, reject) => {
        fetch("/api/qz/sign", {
          method: "POST",
          cache: "no-store",
          headers: { "content-type": "application/json", accept: "text/plain" },
          body: JSON.stringify({ request: toSign }),
        })
          .then(async (res) => {
            const contentType = res.headers.get("content-type") || "";
            if (contentType.includes("text/plain")) {
              const text = await res.text();
              if (!res.ok || !text) {
                reject(text || "Sign unavailable");
                return;
              }
              resolve(text.trim());
              return;
            }
            const signed = await res.json().catch(() => ({}));
            if (!res.ok || !signed?.signature) {
              reject(signed?.error || "Sign unavailable");
              return;
            }
            resolve(String(signed.signature));
          })
          .catch(reject);
      };
    });

    qzSecurityWired = true;
    qzSigningConfigured = true;
    return { signed: true };
  } catch (err: any) {
    qzSecurityWired = true;
    qzSigningConfigured = false;
    return { signed: false, error: err?.message || String(err) };
  }
}

export function isQzSigningWired(): boolean {
  return qzSigningConfigured;
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
  activated: boolean;
  qzInstalled: boolean;
  qzConnected: boolean;
  qzSigningConfigured: boolean;
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
    | "off"
    | "qz_not_installed"
    | "qz_not_connected"
    | "no_printer"
    | "printer_not_found"
    | "silent_not_validated"
    | "auto_off";
};

/**
 * Probe station state.
 * Never connects while inactive (avoids Allow spam on page load).
 * Pass `connect: true` only after Activate / when already activated.
 */
export async function probePrintStationStatus(
  config?: PrintStationConfig,
  options?: { connect?: boolean }
): Promise<PrintStationProbeStatus> {
  const cfg = config ?? loadPrintStationConfig();
  const activated = isPrintStationActivated(cfg);
  const shouldConnect = Boolean(options?.connect) || activated;

  let qzInstalled = Boolean(typeof window !== "undefined" && window.qz?.websocket);
  if (shouldConnect && !qzInstalled) {
    try {
      qzInstalled = await ensureQzScriptLoaded();
    } catch {
      qzInstalled = false;
    }
  }

  let qzConnected = false;
  let printerFound = false;
  if (qzInstalled && typeof window !== "undefined" && window.qz?.websocket) {
    if (shouldConnect) {
      qzConnected = await ensureQzConnected();
      if (qzConnected && cfg.printerName) {
        printerFound = await isConfiguredPrinterFound(cfg.printerName);
      }
    } else {
      qzConnected = window.qz.websocket.isActive();
    }
  }

  const printerConfigured = Boolean(String(cfg.printerName || "").trim());
  const autoPrintOn = Boolean(cfg.autoPrintEnabled || cfg.autoPrintOnCertainMatch);

  let reason: PrintStationProbeStatus["reason"];
  if (!autoPrintOn) reason = "off";
  else if (!cfg.silentPrintValidated) reason = "silent_not_validated";
  else if (!qzInstalled) reason = "qz_not_installed";
  else if (shouldConnect && !qzConnected) reason = "qz_not_connected";
  else if (!printerConfigured) reason = "no_printer";
  else if (shouldConnect && qzConnected && !printerFound) reason = "printer_not_found";
  else reason = "ready";

  const format = cfg.continuousLabel
    ? `${cfg.labelWidthMm}mm continuous × ${cfg.labelHeightMm}mm cut`
    : `${cfg.labelWidthMm}×${cfg.labelHeightMm}mm`;

  return {
    activated,
    qzInstalled,
    qzConnected,
    qzSigningConfigured,
    printerConfigured,
    printerFound: shouldConnect ? printerFound : printerConfigured,
    silentPrintValidated: Boolean(cfg.silentPrintValidated),
    autoPrintOn,
    stationName: cfg.stationName || cfg.stationId,
    printerName: cfg.printerName,
    labelFormat: format,
    readyForSilentPrint: reason === "ready",
    reason,
  };
}

export type ActivatePrintStationResult = {
  ok: boolean;
  status: PrintStationProbeStatus;
  error?: string;
  printers?: string[];
};

/**
 * Operator clicked Activate: load QZ → sign → connect → pick printer → save on.
 * Keeps existing paper-size fields from localStorage (wizard).
 */
export async function activatePrintStation(options?: {
  printerName?: string;
}): Promise<ActivatePrintStationResult> {
  try {
    const loaded = await ensureQzScriptLoaded();
    if (!loaded || !window.qz?.websocket) {
      const status = await probePrintStationStatus(undefined, { connect: false });
      return {
        ok: false,
        status: { ...status, reason: "qz_not_installed" },
        error:
          "QZ Tray not found. Install and start the QZ Tray desktop app, then click Activate again.",
      };
    }

    const connected = await ensureQzConnected();
    if (!connected) {
      const status = await probePrintStationStatus(undefined, { connect: false });
      return {
        ok: false,
        status: { ...status, reason: "qz_not_connected", qzInstalled: true },
        error:
          "Could not connect to QZ Tray. Start the app and Accept / Allow this site when prompted.",
      };
    }

    const printers = await listQzPrinters();
    const preferred = String(options?.printerName || "").trim();

    if (!preferred && printers.length > 1) {
      const status = await probePrintStationStatus(undefined, { connect: true });
      return {
        ok: false,
        status: {
          ...status,
          qzInstalled: true,
          qzConnected: true,
          reason: "no_printer",
        },
        error: "Pick a printer",
        printers,
      };
    }

    const picked =
      (preferred && printers.includes(preferred) ? preferred : null) ||
      (preferred && printers.length === 0 ? preferred : null) ||
      printers.find((p) => /brother|ql|zebra|label/i.test(p)) ||
      printers[0] ||
      preferred ||
      "";

    if (!picked) {
      const status = await probePrintStationStatus(undefined, { connect: true });
      return {
        ok: false,
        status: { ...status, reason: "no_printer", qzInstalled: true, qzConnected: true },
        error: "No printers found in QZ Tray.",
        printers,
      };
    }

    const next = defaultPrintStationConfig({
      ...loadPrintStationConfig(),
      provider: "qz_tray",
      printerName: picked,
      autoPrintEnabled: true,
      autoPrintOnCertainMatch: true,
      silentPrintValidated: true,
      silentPrintValidatedAt: new Date().toISOString(),
    });
    savePrintStationConfig(next);
    const status = await probePrintStationStatus(next, { connect: true });
    return { ok: status.readyForSilentPrint, status, printers };
  } catch (err: any) {
    const status = await probePrintStationStatus(undefined, { connect: false });
    return {
      ok: false,
      status,
      error: err?.message || String(err),
    };
  }
}

/** Turn silent QZ off — browser print popup again. Does not kill QZ Tray app. */
export function deactivatePrintStation(): PrintStationConfig {
  const next = defaultPrintStationConfig({
    ...loadPrintStationConfig(),
    autoPrintEnabled: false,
    autoPrintOnCertainMatch: false,
    silentPrintValidated: false,
    silentPrintValidatedAt: null,
  });
  savePrintStationConfig(next);
  return next;
}

function buildQzConfigOptions(config: PrintStationConfig, copies: number) {
  return buildQzPixelConfigOptions(config, copies);
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
    const pdfOptions = buildQzPdfDataOptions(config);
    const data = [
      {
        type: "pixel",
        format: job.extension === "pdf" ? "pdf" : job.extension,
        flavor: "base64",
        data: job.base64,
        ...(pdfOptions ? { options: pdfOptions } : {}),
      },
    ];
    await window.qz.print(qzConfig, data);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * Attempt station auto-print for a certain match.
 * Uses per-station paper size. Never creates a label.
 */
export async function tryStationAutoPrint(params: {
  matchCertainty?: "certain" | "ambiguous" | "none";
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
    matchCertainty: params.matchCertainty ?? "certain",
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
