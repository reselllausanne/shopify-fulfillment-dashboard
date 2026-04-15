import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { prisma } from "@/app/lib/prisma";
import { getStorageAdapterForUrl } from "@/galaxus/storage/storage";
import { DocumentType } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFile = promisify(execFileCallback);
const LABEL_OUTPUT_DIR =
  process.env.SWISS_POST_LABEL_OUTPUT_DIR ||
  path.join(process.cwd(), "swiss-post-labels");
const PRINT_COMMAND = process.env.SWISS_POST_PRINT_COMMAND || "lp";
const DEFAULT_PRINT_MEDIA = "62x66mm";

type PrintJobResult = {
  ok: boolean;
  skipped?: boolean;
  stdout?: string;
  stderr?: string;
  error?: string;
  message?: string;
};

async function ensureLabelDirectory() {
  try {
    await fs.mkdir(LABEL_OUTPUT_DIR, { recursive: true });
  } catch (error: any) {
    console.error("[SWISS POST] Failed to ensure label directory:", error?.message || error);
  }
}

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 80) || "label";
}

function resolveAutoPrintEnabled() {
  const value = String(process.env.SWISS_POST_AUTO_PRINT || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function resolvePrinterName() {
  return String(process.env.SWISS_POST_PRINTER_NAME || "").trim();
}

async function submitPrintJob(filePath: string): Promise<PrintJobResult> {
  if (!resolveAutoPrintEnabled()) {
    return { ok: false, skipped: true, message: "Auto print disabled" };
  }
  const printerName = resolvePrinterName();
  if (!printerName) {
    return { ok: false, message: "No printer configured (SWISS_POST_PRINTER_NAME)" };
  }

  try {
    const media = String(process.env.SWISS_POST_PRINTER_MEDIA || DEFAULT_PRINT_MEDIA).trim();
    const scaleRaw = Number(process.env.SWISS_POST_PRINT_SCALE || 100);
    const scale = Number.isFinite(scaleRaw) ? Math.max(10, Math.min(200, scaleRaw)) : 100;
    const offsetX = Number(process.env.SWISS_POST_PRINT_OFFSET_X || 0);
    const offsetY = Number(process.env.SWISS_POST_PRINT_OFFSET_Y || 0);

    const args = ["-d", printerName, "-o", "fit-to-page", "-o", `media=${media}`];
    if (scale !== 100) {
      args.push("-o", `scaling=${scale}`);
    }
    if (Number.isFinite(offsetX) && offsetX !== 0) {
      args.push("-o", `page-left=${offsetX}`);
    }
    if (Number.isFinite(offsetY) && offsetY !== 0) {
      args.push("-o", `page-top=${offsetY}`);
    }
    args.push(filePath);
    const run = async (command: string) => {
      const { stdout, stderr } = await execFile(command, args);
      return { ok: true, stdout: stdout?.trim(), stderr: stderr?.trim() } as PrintJobResult;
    };
    try {
      return await run(PRINT_COMMAND);
    } catch (error: any) {
      const message = error?.message || String(error);
      const code = error?.code || "";
      if ((code === "ENOENT" || /ENOENT/i.test(message)) && PRINT_COMMAND === "lp") {
        return await run("/usr/bin/lp");
      }
      throw error;
    }
  } catch (error: any) {
    const message = error?.message || String(error);
    const code = error?.code || "";
    if (code === "ENOENT" || /ENOENT/i.test(message)) {
      return {
        ok: false,
        skipped: true,
        message: `Print command not found (${PRINT_COMMAND}). Install CUPS/lp or set SWISS_POST_PRINT_COMMAND.`,
      };
    }
    console.error("[SWISS POST] Print job failed:", message);
    return { ok: false, error: message };
  }
}

async function resolveDecathlonOrder(orderId: string) {
  return (
    (await (prisma as any).decathlonOrder.findUnique({ where: { id: orderId } })) ??
    (await (prisma as any).decathlonOrder.findUnique({ where: { orderId } }))
  );
}

async function fetchLatestLabelDocument(order: { id: string }) {
  return (prisma as any).decathlonOrderDocument.findFirst({
    where: { orderId: order.id, type: DocumentType.LABEL },
    orderBy: { version: "desc" },
  });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;
    const order = await resolveDecathlonOrder(orderId);
    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }
    const document = await fetchLatestLabelDocument(order);
    if (!document) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "No label PDF on file for this order. If the order was synced from Mirakl without a local label step, generate a new label from Mirakl/Swiss Post or ship again from a machine that stores labels.",
        },
        { status: 404 }
      );
    }
    const storage = getStorageAdapterForUrl(document.storageUrl);
    const file = await storage.getPdf(document.storageUrl);
    const filename = `decathlon-label_${order.orderId || order.id}_v${document.version}.pdf`;
    return new Response(file.content as unknown as BodyInit, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${filename}"`,
        "content-length": String(file.content.length ?? 0),
      },
    });
  } catch (error: any) {
    console.error("[DECATHLON][LABEL][GET]", error);
    const message = error?.message ?? String(error);
    return NextResponse.json(
      {
        ok: false,
        error:
          message.includes("ENOENT") || message.includes("no such file")
            ? `Label file missing on this server (${message}). Old orders may point at another host’s disk or a deleted Supabase object.`
            : message.includes("Supabase download")
              ? message
              : `Could not read label file: ${message}`,
      },
      { status: 502 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;
    const order = await resolveDecathlonOrder(orderId);
    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }
    const document = await fetchLatestLabelDocument(order);
    if (!document) {
      return NextResponse.json({ ok: false, error: "No label document found" }, { status: 404 });
    }
    const storage = getStorageAdapterForUrl(document.storageUrl);
    const file = await storage.getPdf(document.storageUrl);
    await ensureLabelDirectory();
    const safeId = sanitizeFileName(`${order.orderId || order.id}-label`);
    const fileName = `${safeId}-${Date.now()}.pdf`;
    const filePath = path.join(LABEL_OUTPUT_DIR, fileName);
    await fs.writeFile(filePath, file.content);
    const printJobResult = await submitPrintJob(filePath);
    return NextResponse.json({
      ok: true,
      documentId: document.id,
      labelFilePath: filePath,
      printJobResult,
    });
  } catch (error: any) {
    console.error("[DECATHLON][LABEL][PRINT] Failed", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Label print failed" },
      { status: 500 }
    );
  }
}
