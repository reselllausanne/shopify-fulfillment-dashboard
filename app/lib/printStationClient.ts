"use client";

/**
 * Browser-side print-station preferences + QZ Tray hook (optional global).
 * Falls back to returning { ok:false } so callers use browser print.
 *
 * HONESTY CONTRACT — we never claim silent print is ready unless BOTH:
 *   1. Operator clicked Activate (autoPrint + silentPrintValidated).
 *   2. `window.qz` exists and its websocket is active on `localhost`.
 *
 * Probe must NOT call connect() while inactive — that spams QZ "Allow" prompts.
 */

import {
  PRINT_STATION_STORAGE_KEY,
  defaultPrintStationConfig,
  decideStationAutoPrint,
  type LabelPrintJob,
  type PrintStationConfig,
} from "@/lib/printStation";

const QZ_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/qz-tray@2.2.5/qz-tray.min.js";

declare global {
  interface Window {
    qz?: {
      websocket: {
        connect: (opts?: Record<string, unknown>) => Promise<void>;
        disconnect?: () => Promise<void>;
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

export function isPrintStationActivated(config?: PrintStationConfig): boolean {
  const cfg = config ?? loadPrintStationConfig();
  return Boolean(cfg.autoPrintOnCertainMatch && cfg.silentPrintValidated);
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

/** Load QZ Tray browser lib once (no connect). */
export async function loadQzTrayScript(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (window.qz?.websocket) return true;
  const existing = document.querySelector<HTMLScriptElement>("script[data-qz-tray]");
  if (existing) {
    await new Promise<void>((resolve, reject) => {
      if (window.qz?.websocket) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("QZ script load failed")), {
        once: true,
      });
    });
    return Boolean(window.qz?.websocket);
  }
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = QZ_SCRIPT_URL;
    script.async = true;
    script.dataset.qzTray = "1";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load QZ Tray script"));
    document.head.appendChild(script);
  });
  return Boolean(window.qz?.websocket);
}

export type PrintStationProbeStatus = {
  activated: boolean;
  qzInstalled: boolean;
  qzConnected: boolean;
  printerConfigured: boolean;
  printerName: string;
  silentPrintValidated: boolean;
  autoPrintOn: boolean;
  /** True iff we would silent-print right now on a certain match. */
  readyForSilentPrint: boolean;
  reason:
    | "ready"
    | "off"
    | "qz_not_installed"
    | "qz_not_connected"
    | "no_printer"
    | "silent_not_validated"
    | "auto_off";
};

/**
 * Probe station state. Never connects while inactive (avoids Allow spam).
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
      qzInstalled = await loadQzTrayScript();
    } catch {
      qzInstalled = false;
    }
  }

  let qzConnected = false;
  if (qzInstalled && typeof window !== "undefined" && window.qz?.websocket) {
    if (shouldConnect) {
      qzConnected = await ensureQzConnected();
    } else {
      qzConnected = window.qz.websocket.isActive();
    }
  }

  const printerName = String(cfg.printerName || "").trim();
  const printerConfigured = Boolean(printerName) || cfg.provider === "browser";

  let reason: PrintStationProbeStatus["reason"];
  if (!cfg.autoPrintOnCertainMatch) reason = "off";
  else if (!cfg.silentPrintValidated) reason = "silent_not_validated";
  else if (!qzInstalled) reason = "qz_not_installed";
  else if (!qzConnected) reason = "qz_not_connected";
  else if (!printerConfigured) reason = "no_printer";
  else reason = "ready";

  return {
    activated,
    qzInstalled,
    qzConnected,
    printerConfigured,
    printerName,
    silentPrintValidated: Boolean(cfg.silentPrintValidated),
    autoPrintOn: Boolean(cfg.autoPrintOnCertainMatch),
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
 * Operator clicked Activate: load QZ → connect (Allow prompt) → pick printer → save on.
 */
export async function activatePrintStation(options?: {
  printerName?: string;
}): Promise<ActivatePrintStationResult> {
  try {
    const loaded = await loadQzTrayScript();
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

    const found = await window.qz.printers.find();
    const printers = (Array.isArray(found) ? found : found ? [found] : []).map(String);
    const preferred = String(options?.printerName || "").trim();
    const picked =
      (preferred && printers.includes(preferred) ? preferred : null) ||
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
      autoPrintOnCertainMatch: true,
      silentPrintValidated: true,
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
    autoPrintOnCertainMatch: false,
    silentPrintValidated: false,
  });
  savePrintStationConfig(next);
  return next;
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

  if (config.provider === "qz_tray") {
    if (typeof window === "undefined" || !window.qz) {
      try {
        await loadQzTrayScript();
      } catch {
        // fall through
      }
    }
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

  return {
    ok: false,
    skipped: true,
    reason: `provider_${config.provider}_not_client_wired`,
  };
}
