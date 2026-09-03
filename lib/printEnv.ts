import "server-only";

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  resolvePrintEnvFlag,
  submitLpJob,
  type LpJobResult,
} from "@/lib/cupsLpPrint";

/**
 * Local-station detection.
 *
 * The packing Mac sets `LOCAL_STATION=1` in its local `.env`. VPS keeps it unset,
 * so callers fall back to the browser popup + role-gated CUPS behavior that was
 * shipping before this helper existed.
 */
export function isLocalStation(): boolean {
  return resolvePrintEnvFlag(process.env.LOCAL_STATION);
}

/**
 * Resolve the CUPS queue name for the local station.
 *
 * Precedence: `LOCAL_PRINTER_NAME` (dedicated override) → `SWISS_POST_PRINTER_NAME`
 * (existing Swiss Post queue already used by the auto-print path). Never invent
 * a new env var when the Swiss Post one already covers the same queue.
 */
export function resolveLocalPrinterName(): string {
  return String(
    process.env.LOCAL_PRINTER_NAME ||
      process.env.SWISS_POST_PRINTER_NAME ||
      ""
  ).trim();
}

function sanitizeJobName(value: string) {
  return String(value || "").replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 80) || "label";
}

function normalizeExtension(value: string | undefined) {
  const ext = String(value || "pdf").toLowerCase().replace(/[^a-z0-9]/g, "");
  return ext || "pdf";
}

/**
 * Send a base64 label to the local CUPS queue via `lp`.
 *
 * Writes the decoded bytes to `$TMPDIR/<job>-<ts>.<ext>`, submits it with
 * `submitLpJob`, then unlinks the file. Never throws — returns
 * `{ ok:false, error }` on failure so the API route can surface it.
 */
export async function printLabelLocally(options: {
  base64: string;
  extension: string;
  jobName: string;
  printerName?: string;
  media?: string;
  /** Label physical width in mm (from browserPrintConfig). Used to build Custom.WxHmm media. */
  widthMm?: number;
  /** Label physical height in mm (from browserPrintConfig). Used to build Custom.WxHmm media. */
  heightMm?: number;
  scale?: number;
  offsetX?: number;
  offsetY?: number;
  fitToPage?: boolean;
}): Promise<LpJobResult> {
  const printerName = String(
    options.printerName ?? resolveLocalPrinterName()
  ).trim();
  if (!printerName) {
    return {
      ok: false,
      skipped: true,
      message:
        "No local printer configured (set LOCAL_PRINTER_NAME or SWISS_POST_PRINTER_NAME).",
    };
  }
  const base64 = String(options.base64 || "").trim();
  if (!base64) {
    return { ok: false, error: "Empty label payload" };
  }

  const safeName = sanitizeJobName(options.jobName);
  const extension = normalizeExtension(options.extension);
  const filePath = path.join(
    os.tmpdir(),
    `${safeName}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}.${extension}`
  );

  try {
    await fs.writeFile(filePath, Buffer.from(base64, "base64"));
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }

  // Prefer explicit Custom.WxHmm media derived from the label physical size so
  // label printers (Brother QL, Zebra …) don't stretch a 62×100 label to A4.
  const widthMm = Number(options.widthMm ?? 0);
  const heightMm = Number(options.heightMm ?? 0);
  const hasCustomSize =
    Number.isFinite(widthMm) && Number.isFinite(heightMm) && widthMm > 0 && heightMm > 0;
  const envMedia = String(process.env.SWISS_POST_PRINTER_MEDIA ?? "").trim();
  const media =
    options.media ??
    (hasCustomSize
      ? `Custom.${Math.round(widthMm)}x${Math.round(heightMm)}mm`
      : envMedia || "Custom.62x100mm");
  // Swiss Post PDFs are larger than the Brother DK roll — fit into the physical
  // label. Stretch bug only happened when media was wrong (A4 / 102×152).
  const fitEnvRaw = String(process.env.SWISS_POST_PRINT_FIT_TO_PAGE ?? "").trim();
  const fitToPage =
    typeof options.fitToPage === "boolean"
      ? options.fitToPage
      : fitEnvRaw
        ? resolvePrintEnvFlag(fitEnvRaw)
        : true;
  const scaleRaw =
    options.scale ?? Number(process.env.SWISS_POST_PRINT_SCALE ?? 100);
  const offsetX =
    options.offsetX ?? Number(process.env.SWISS_POST_PRINT_OFFSET_X ?? 0);
  const offsetY =
    options.offsetY ?? Number(process.env.SWISS_POST_PRINT_OFFSET_Y ?? 0);

  try {
    return await submitLpJob({
      filePath,
      printerName,
      media: String(media),
      scale: Number(scaleRaw),
      offsetX,
      offsetY,
      fitToPage,
    });
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  } finally {
    fs.unlink(filePath).catch(() => {
      // Best effort cleanup — leaving a temp file is not fatal.
    });
  }
}

/**
 * No-op unless `isLocalStation()`. Handy for API routes that want to plumb
 * the local print step behind a single guard.
 */
export async function maybePrintLabelLocally(options: {
  base64: string;
  extension: string;
  jobName: string;
  printerName?: string;
  media?: string;
  widthMm?: number;
  heightMm?: number;
  scale?: number;
  fitToPage?: boolean;
}): Promise<LpJobResult> {
  if (!isLocalStation()) {
    return { ok: false, skipped: true, message: "LOCAL_STATION not set" };
  }
  return printLabelLocally(options);
}

/**
 * Packing-station CUPS label auto-print.
 *
 * Only when `LOCAL_STATION=1` (packing Mac with Brother on CUPS).
 * VPS must never treat `SWISS_POST_AUTO_PRINT=1` as CUPS — that path has no
 * local printer and used to disable the browser label popup for nothing.
 */
export function shouldAutoPrintShippingLabel(): boolean {
  return isLocalStation();
}

/**
 * A4 packing slip / delivery note on the second printer (HP), same env as Decathlon.
 * `DECATHLON_PACKING_SLIP_AUTO_PRINT` + `DECATHLON_PACKING_SLIP_PRINTER_NAME`.
 */
export function shouldAutoPrintPackingDocument(): boolean {
  if (String(process.env.NODE_ENV ?? "").toLowerCase() === "test") return false;
  return resolvePrintEnvFlag(process.env.DECATHLON_PACKING_SLIP_AUTO_PRINT);
}

export function resolvePackingDocumentPrinterName(): string {
  return String(process.env.DECATHLON_PACKING_SLIP_PRINTER_NAME ?? "").trim();
}

/**
 * Send an A4 PDF (delivery note / packing slip) to the HP queue.
 * Never throws — returns `{ ok:false }` / skipped on misconfig.
 */
export async function printPackingDocumentLocally(options: {
  base64?: string;
  buffer?: Buffer;
  jobName: string;
}): Promise<LpJobResult> {
  if (!shouldAutoPrintPackingDocument()) {
    return { ok: false, skipped: true, message: "Packing-doc auto print disabled" };
  }
  const printerName = resolvePackingDocumentPrinterName();
  if (!printerName) {
    return {
      ok: false,
      skipped: true,
      message: "No packing-doc printer (DECATHLON_PACKING_SLIP_PRINTER_NAME)",
    };
  }

  let bytes: Buffer | null = null;
  if (options.buffer && options.buffer.length > 0) {
    bytes = options.buffer;
  } else if (options.base64) {
    bytes = Buffer.from(String(options.base64).trim(), "base64");
  }
  if (!bytes || bytes.length === 0) {
    return { ok: false, error: "Empty packing document payload" };
  }

  const safeName = sanitizeJobName(options.jobName);
  const filePath = path.join(
    os.tmpdir(),
    `${safeName}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}.pdf`
  );

  try {
    await fs.writeFile(filePath, bytes);
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }

  const media = String(process.env.DECATHLON_PACKING_SLIP_PRINTER_MEDIA || "A4").trim();
  const scaleRaw = Number(process.env.DECATHLON_PACKING_SLIP_PRINT_SCALE || 100);
  const scale = Number.isFinite(scaleRaw) ? scaleRaw : 100;

  try {
    return await submitLpJob({
      filePath,
      printerName,
      media,
      scale,
      offsetX: Number(process.env.DECATHLON_PACKING_SLIP_PRINT_OFFSET_X || 0),
      offsetY: Number(process.env.DECATHLON_PACKING_SLIP_PRINT_OFFSET_Y || 0),
      fitToPage: true,
    });
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  } finally {
    fs.unlink(filePath).catch(() => {});
  }
}
