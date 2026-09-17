"use client";

/**
 * Browser-side print-station preferences + QZ Tray hook (optional global).
 * Falls back to returning { ok:false } so callers use browser print.
 *
 * HONESTY CONTRACT — we never claim silent print is ready unless BOTH:
 *   1. `window.qz` exists and its websocket is active on `localhost`.
 *   2. The operator has ticked `silentPrintValidated` in the station config.
 * Missing either → we refuse to silent-print and let the UI show the browser
 * label popup / status pill.
 */

import {
  PRINT_STATION_STORAGE_KEY,
  defaultPrintStationConfig,
  decideStationAutoPrint,
  type LabelPrintJob,
  type PrintStationConfig,
} from "@/lib/printStation";

declare global {
  interface Window {
    qz?: {
      websocket: {
        connect: () => Promise<void>;
        isActive: () => boolean;
      };
      printers: { find: (name?: string) => Promise<string | string[]> };
      configs: { create: (printer: string, options?: Record<string, unknown>) => unknown };
      print: (config: unknown, data: unknown[]) => Promise<void>;
    };
  }
}

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

async function ensureQzConnected(): Promise<boolean> {
  const qz = typeof window !== "undefined" ? window.qz : undefined;
  if (!qz?.websocket) return false;
  try {
    if (!qz.websocket.isActive()) {
      await qz.websocket.connect();
    }
    return qz.websocket.isActive();
  } catch {
    return false;
  }
}

export type PrintStationProbeStatus = {
  qzInstalled: boolean;
  qzConnected: boolean;
  printerConfigured: boolean;
  silentPrintValidated: boolean;
  autoPrintOn: boolean;
  /** True iff we would silent-print right now on a certain match. */
  readyForSilentPrint: boolean;
  reason:
    | "ready"
    | "qz_not_installed"
    | "qz_not_connected"
    | "no_printer"
    | "silent_not_validated"
    | "auto_off";
};

/**
 * Probe the local station without printing anything. Meant for a status pill
 * on the scan page so operators see the real state (QZ up? validated?)
 * instead of assuming silent print is armed.
 */
export async function probePrintStationStatus(
  config?: PrintStationConfig
): Promise<PrintStationProbeStatus> {
  const cfg = config ?? loadPrintStationConfig();
  const qz = typeof window !== "undefined" ? window.qz : undefined;
  const qzInstalled = Boolean(qz?.websocket);
  let qzConnected = false;
  if (qzInstalled) {
    qzConnected = await ensureQzConnected();
  }
  const printerConfigured =
    Boolean(String(cfg.printerName || "").trim()) || cfg.provider === "browser";

  let reason: PrintStationProbeStatus["reason"];
  if (!cfg.autoPrintOnCertainMatch) reason = "auto_off";
  else if (!cfg.silentPrintValidated) reason = "silent_not_validated";
  else if (!qzInstalled) reason = "qz_not_installed";
  else if (!qzConnected) reason = "qz_not_connected";
  else if (!printerConfigured) reason = "no_printer";
  else reason = "ready";

  return {
    qzInstalled,
    qzConnected,
    printerConfigured,
    silentPrintValidated: Boolean(cfg.silentPrintValidated),
    autoPrintOn: Boolean(cfg.autoPrintOnCertainMatch),
    readyForSilentPrint: reason === "ready",
    reason,
  };
}

/**
 * Attempt station auto-print for a certain match.
 * Returns ok:false when QZ unavailable OR silent print not validated —
 * caller should use browser/CUPS fallback.
 */
export async function tryStationAutoPrint(params: {
  matchCertainty: "certain" | "ambiguous" | "none";
  job: LabelPrintJob;
  config?: PrintStationConfig;
}): Promise<{ ok: boolean; skipped?: boolean; error?: string; reason?: string }> {
  const config = params.config ?? loadPrintStationConfig();
  const decision = decideStationAutoPrint({
    matchCertainty: params.matchCertainty,
    config,
  });
  if (!decision.shouldAutoPrint) {
    return { ok: false, skipped: true, reason: decision.reason };
  }

  // Extra client-side guard: never silent-print without a live `window.qz`.
  if (config.provider === "qz_tray") {
    if (typeof window === "undefined" || !window.qz) {
      return {
        ok: false,
        error: "QZ Tray not installed on this station",
        reason: "qz_unavailable",
      };
    }
    if (!config.silentPrintValidated) {
      return {
        ok: false,
        error: "Silent print not validated on this station",
        reason: "silent_not_validated",
      };
    }
    const ready = await ensureQzConnected();
    if (!ready || !window.qz) {
      return { ok: false, error: "QZ Tray unavailable", reason: "qz_unavailable" };
    }
    try {
      const printer =
        config.printerName ||
        (await window.qz.printers.find().then((r) => (Array.isArray(r) ? r[0] : r)));
      if (!printer) {
        return { ok: false, error: "No QZ printer found", reason: "no_printer" };
      }
      const qzConfig = window.qz.configs.create(String(printer), {
        size: { width: config.labelWidthMm, height: config.labelHeightMm },
        units: "mm",
        copies: params.job.copies ?? 1,
      });
      const data =
        params.job.extension === "pdf"
          ? [
              {
                type: "pixel",
                format: "pdf",
                flavor: "base64",
                data: params.job.base64,
              },
            ]
          : [
              {
                type: "pixel",
                format: params.job.extension,
                flavor: "base64",
                data: params.job.base64,
              },
            ];
      await window.qz.print(qzConfig, data);
      return { ok: true, reason: "qz_tray" };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err), reason: "qz_error" };
    }
  }

  // PrintNode / other providers: not wired yet — signal fallback.
  return {
    ok: false,
    skipped: true,
    reason: `provider_${config.provider}_not_client_wired`,
  };
}
