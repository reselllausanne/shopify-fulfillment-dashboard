"use client";

/**
 * Browser-side print-station preferences + QZ Tray hook (optional global).
 * Falls back to returning { ok:false } so callers use browser print.
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

/**
 * Attempt station auto-print for a certain match.
 * Returns ok:false when QZ unavailable — caller should use browser/CUPS fallback.
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
