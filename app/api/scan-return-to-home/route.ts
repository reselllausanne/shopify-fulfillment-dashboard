import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import {
  findStockxInboundHomeRouteByCode,
  normalizeInboundHomeAwb,
} from "@/app/lib/stockxInboundHomeRoutes";
import { resolveFulfillmentHomeAddress } from "@/app/lib/fulfillmentHomeAddress";
import {
  getStaffRoleFromRequest,
  resolveSwissPostFrankingLicenseForRole,
} from "@/app/lib/staffAuth";
import { requestSwissPostLabel } from "@/lib/swissPost";
import {
  buildSwissPostPayloadToHome,
  extractSwissPostLabelPayload,
} from "@/lib/swissPostHomeLabel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFile = promisify(execFileCallback);
const LABEL_OUTPUT_DIR =
  process.env.SWISS_POST_LABEL_OUTPUT_DIR ||
  path.join(process.cwd(), "swiss-post-labels");
const PRINT_COMMAND = process.env.SWISS_POST_PRINT_COMMAND || "lp";

function extensionToMimeType(extension: string) {
  const ext = String(extension || "").trim().toLowerCase();
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return "application/octet-stream";
}

function resolveBrowserPrintConfig() {
  const bool = (raw: string | undefined, fallback: boolean) => {
    const value = String(raw || "").trim().toLowerCase();
    if (!value) return fallback;
    if (["1", "true", "yes", "on"].includes(value)) return true;
    if (["0", "false", "no", "off"].includes(value)) return false;
    return fallback;
  };
  const num = (raw: string | undefined, fallback: number) => {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    enabled: bool(process.env.SCAN_BROWSER_PRINT_ENABLED, true),
    widthMm: num(process.env.SCAN_BROWSER_PRINT_WIDTH_MM, 62),
    heightMm: num(process.env.SCAN_BROWSER_PRINT_HEIGHT_MM, 86),
    marginMm: num(process.env.SCAN_BROWSER_PRINT_MARGIN_MM, 0),
  };
}

async function persistLabel(base64: string, extension: string, identifier: string) {
  await fs.mkdir(LABEL_OUTPUT_DIR, { recursive: true });
  const safeId = identifier.replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 80) || "home-label";
  const filePath = path.join(LABEL_OUTPUT_DIR, `${safeId}-${Date.now()}.${extension}`);
  await fs.writeFile(filePath, Buffer.from(base64, "base64"));
  return filePath;
}

async function maybePrintLabel(filePath: string) {
  const enabled = ["1", "true", "yes"].includes(
    String(process.env.SWISS_POST_AUTO_PRINT || "").trim().toLowerCase()
  );
  const printer = String(process.env.SWISS_POST_PRINTER_NAME || "").trim();
  if (!enabled || !printer) {
    return { ok: false, skipped: true, message: "Auto print disabled" };
  }
  try {
    const { stdout, stderr } = await execFile(PRINT_COMMAND, ["-d", printer, filePath]);
    return { ok: true, stdout: stdout?.trim(), stderr: stderr?.trim() };
  } catch (error: any) {
    return { ok: false, error: error?.message || String(error) };
  }
}

export async function POST(req: NextRequest) {
  try {
    const staffRole = await getStaffRoleFromRequest(req);
    if (!staffRole) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const rawCode = String(body?.code ?? body?.awb ?? "").trim();
    const awb = normalizeInboundHomeAwb(rawCode) || rawCode;
    const includeLabelData = Boolean(body?.includeLabelData ?? true);

    if (!rawCode) {
      return NextResponse.json({ ok: false, error: "Missing code" }, { status: 400 });
    }

    const route = await findStockxInboundHomeRouteByCode(rawCode);
    if (!route) {
      return NextResponse.json(
        { ok: false, error: "No inbound home route for this StockX scan" },
        { status: 404 }
      );
    }

    if (!process.env.SWISS_POST_LABEL_ENDPOINT) {
      return NextResponse.json(
        { ok: false, error: "SWISS_POST_LABEL_ENDPOINT not configured" },
        { status: 503 }
      );
    }

    const frankingLicense = resolveSwissPostFrankingLicenseForRole(staffRole);
    const payload = buildSwissPostPayloadToHome({
      reference: route.stockxOrderNumber || awb,
      frankingLicenseOverride: frankingLicense,
    });
    const swissRes = await requestSwissPostLabel(payload);
    if (!swissRes.ok) {
      return NextResponse.json(
        { ok: false, error: "Swiss Post label generation failed", swissPost: swissRes.data },
        { status: 502 }
      );
    }

    const labelPayload = extractSwissPostLabelPayload(swissRes.data);
    if (!labelPayload?.base64) {
      return NextResponse.json(
        { ok: false, error: "Swiss Post label missing content", swissPost: swissRes.data },
        { status: 502 }
      );
    }

    const labelFilePath = await persistLabel(
      labelPayload.base64,
      labelPayload.extension,
      route.stockxOrderNumber
    );
    const printJobResult = await maybePrintLabel(labelFilePath);

    return NextResponse.json({
      ok: true,
      route: {
        id: route.id,
        stockxOrderNumber: route.stockxOrderNumber,
        stockxAwb: route.stockxAwb,
      },
      home: resolveFulfillmentHomeAddress(),
      identCode: labelPayload.identCode,
      labelFilePath,
      printJobResult,
      labelData: includeLabelData
        ? {
            base64: labelPayload.base64,
            mimeType: extensionToMimeType(labelPayload.extension),
            extension: labelPayload.extension,
          }
        : null,
      browserPrintConfig: resolveBrowserPrintConfig(),
    });
  } catch (error: any) {
    console.error("[SCAN-RETURN-TO-HOME]", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to generate home label" },
      { status: 500 }
    );
  }
}
