import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { prisma } from "@/app/lib/prisma";
import { fetchOrderIdByName, fetchOrderShippingInfo } from "@/lib/shopifyFulfillment";
import { requestSwissPostLabel } from "@/lib/swissPost";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFile = promisify(execFileCallback);
const LABEL_OUTPUT_DIR =
  process.env.SWISS_POST_LABEL_OUTPUT_DIR ||
  path.join(process.cwd(), "swiss-post-labels");
const PRINT_COMMAND = process.env.SWISS_POST_PRINT_COMMAND || "lp";
const DEFAULT_PRINT_MEDIA = "62x82.74mm";

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

function getLabelFileExtension(format?: string) {
  const cleaned = String(format || "pdf").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (["pdf", "jpg", "jpeg", "png", "gif", "svg"].includes(cleaned)) {
    return cleaned;
  }
  return "pdf";
}

async function persistLabel(base64: string, extension: string, identifier: string) {
  await ensureLabelDirectory();
  const safeId = sanitizeFileName(identifier || Date.now().toString());
  const fileName = `${safeId}-${Date.now()}.${extension}`;
  const filePath = path.join(LABEL_OUTPUT_DIR, fileName);
  const buffer = Buffer.from(base64, "base64");
  await fs.writeFile(filePath, buffer);
  return filePath;
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
    const { stdout, stderr } = await execFile(PRINT_COMMAND, args);
    return { ok: true, stdout: stdout?.trim(), stderr: stderr?.trim() };
  } catch (error: any) {
    console.error("[SWISS POST] Print job failed:", error?.message || error);
    return { ok: false, error: error?.message || String(error) };
  }
}

function extractLabelPayload(response: any) {
  if (!response) return null;
  const item = Array.isArray(response.item) ? response.item[0] : response.item;
  if (!item) return null;
  const labelEntry = Array.isArray(item.label) ? item.label[0] : item.label;
  if (!labelEntry) return null;
  const base64 =
    typeof labelEntry === "string"
      ? labelEntry
      : labelEntry?.content ?? labelEntry?.data ?? labelEntry?.value;
  if (!base64) {
    return null;
  }
  const format =
    labelEntry?.format ||
    labelEntry?.type ||
    labelEntry?.fileType ||
    labelEntry?.imageFileType ||
    "pdf";
  return {
    base64,
    extension: getLabelFileExtension(format),
    identifier: item.itemID || item.identCode || response?.itemId || "label",
  };
}

type SwissPostShippingOption = {
  serviceCodes: string[];
  signatureRequired: boolean;
};

const SHIPPING_LINE_TO_SWISSPOST_MAP: Record<string, SwissPostShippingOption> = {
  "Livraison Offerte": { serviceCodes: ["ECO"], signatureRequired: false },
  "Sous signature": { serviceCodes: ["SI", "ECO"], signatureRequired: true },
};

const getActiveShippingLine = (
  orderInfo: Awaited<ReturnType<typeof fetchOrderShippingInfo>> | null
) => orderInfo?.shippingLines?.find((line) => !line.isRemoved) || null;

type SwissPostRecipient = {
  name1?: string | null;
  firstName?: string | null;
  name2?: string | null;
  street?: string | null;
  zip?: string | null;
  city?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
};

const normalizeAwb = (code?: string | null) => {
  if (!code) return "";
  const trimmed = String(code).trim();
  const cleaned = trimmed.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "");
  if (/^\d{13,}$/.test(cleaned)) {
    return cleaned.slice(-12);
  }
  return cleaned;
};

function toRecipient(orderInfo: Awaited<ReturnType<typeof fetchOrderShippingInfo>>): SwissPostRecipient {
  const address = orderInfo?.shippingAddress;
  const fullName =
    address?.name ||
    [address?.firstName, address?.lastName].filter(Boolean).join(" ").trim() ||
    null;

  return {
    name1: fullName,
    firstName: address?.firstName || null,
    name2: address?.lastName || null,
    street: address?.address1 || null,
    zip: address?.zip || null,
    city: address?.city || null,
    country: address?.countryCodeV2 || address?.country || null,
    phone: null,
    email: orderInfo?.email || null,
  };
}

function buildSwissPostPayload(orderInfo: Awaited<ReturnType<typeof fetchOrderShippingInfo>>, awb: string) {
  const language = process.env.SWISS_POST_LANGUAGE || "DE";
  const frankingLicense = process.env.SWISS_POST_FRANKING_LICENSE || "";
  const ppFranking = process.env.SWISS_POST_PP_FRANKING === "1";
  const customerSystem = process.env.SWISS_POST_CUSTOMER_SYSTEM || null;
  const sendingID = process.env.SWISS_POST_SENDING_ID || "";
  const imageFileType = process.env.SWISS_POST_IMAGE_FILE_TYPE || "PNG";
  const imageResolution = Number(process.env.SWISS_POST_IMAGE_RESOLUTION || 300);
  const notificationServiceCode = Number(process.env.SWISS_POST_NOTIFICATION_SERVICE || 0);
  const allowedNotifications = [1, 2, 4, 32, 64, 128, 256];
  const notificationService =
    allowedNotifications.includes(notificationServiceCode) && notificationServiceCode > 0
      ? String(notificationServiceCode)
      : null;

  const sender = {
    name1: process.env.SWISS_POST_CUSTOMER_NAME1 || "",
    name2: process.env.SWISS_POST_CUSTOMER_NAME2 || "",
    street: process.env.SWISS_POST_CUSTOMER_STREET || "",
    zip: process.env.SWISS_POST_CUSTOMER_ZIP || "",
    city: process.env.SWISS_POST_CUSTOMER_CITY || "",
    country: process.env.SWISS_POST_CUSTOMER_COUNTRY || "CH",
    domicilePostOffice: process.env.SWISS_POST_CUSTOMER_DOMICILE_PO || "",
    pobox: process.env.SWISS_POST_CUSTOMER_POBOX || "",
    logo: process.env.SWISS_POST_CUSTOMER_LOGO || "",
    logoFormat: process.env.SWISS_POST_CUSTOMER_LOGO_FORMAT || "PNG",
    logoRotation: Number(process.env.SWISS_POST_CUSTOMER_LOGO_ROTATION || 0),
    logoAspectRatio: process.env.SWISS_POST_CUSTOMER_LOGO_ASPECT || "EXPAND",
    logoHorizontalAlign: process.env.SWISS_POST_CUSTOMER_LOGO_HALIGN || "WITH_CONTENT",
    logoVerticalAlign: process.env.SWISS_POST_CUSTOMER_LOGO_VALIGN || "TOP",
  };

  const recipient = toRecipient(orderInfo);
  const today = new Date();
  const dispatchDate = today.toISOString().slice(0, 10);
  const dispatchTime = today.toTimeString().slice(0, 8);
  const activeShippingLine = getActiveShippingLine(orderInfo);
  const shippingOption = activeShippingLine
    ? SHIPPING_LINE_TO_SWISSPOST_MAP[activeShippingLine.title]
    : null;
  const basePrzlValues = (process.env.SWISS_POST_PRZL || "ECO")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const przlValues = shippingOption?.serviceCodes?.length
    ? shippingOption.serviceCodes
    : basePrzlValues.length
    ? basePrzlValues
    : ["ECO"];
  const attributesPayload = {
    przl: przlValues,
  };

  console.log("[SWISS POST] attributes payload", attributesPayload);

  return {
    language,
    frankingLicense,
    ppFranking,
    labelDefinition: {
      labelLayout: process.env.SWISS_POST_LABEL_LAYOUT || "A7",
      printAddresses: process.env.SWISS_POST_LABEL_PRINT_ADDRESSES || "ONLY_RECIPIENT",
      imageFileType: (process.env.SWISS_POST_IMAGE_FILE_TYPE || "JPG").toUpperCase(),
      imageResolution,
      printPreview: process.env.SWISS_POST_LABEL_PRINT_PREVIEW === "1",
      
    },
    customer: sender,
    item: {
      itemID: `${orderInfo?.id?.split("/").pop() || awb}-${Date.now()}-${Math.floor(
        Math.random() * 1000
      )}`,
      recipient,
      attributes: attributesPayload,
      notification:
          notificationService &&
          (recipient.email || recipient.phone)
            ? [
                {
                  communication: {
                    email: recipient.email || "",
                    mobile: null,
                  },
                  service: notificationService,
                  freeText1: null,
                  freeText2: null,
                  
                  language,
                  type: "EMAIL",
                },
              ]
            : [],
    },
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const awb = normalizeAwb(body?.awb ?? body?.code);

    if (!awb) {
      return NextResponse.json({ ok: false, error: "Missing AWB" }, { status: 400 });
    }

    const matches = await prisma.orderMatch.findMany({
      where: { stockxAwb: awb },
      select: {
        shopifyOrderId: true,
        shopifyOrderName: true,
      },
    });

    if (matches.length === 0) {
      return NextResponse.json({ ok: false, error: "AWB not found" }, { status: 404 });
    }

    let shopifyOrderId = matches[0]?.shopifyOrderId || "";
    const shopifyOrderName = matches[0]?.shopifyOrderName || null;

    if (!shopifyOrderId && shopifyOrderName) {
      const found = await fetchOrderIdByName(shopifyOrderName);
      shopifyOrderId = found?.id || "";
    }

    if (!shopifyOrderId) {
      return NextResponse.json({ ok: false, error: "Missing shopifyOrderId" }, { status: 400 });
    }

    const orderInfo = await fetchOrderShippingInfo(shopifyOrderId);
    const payload = buildSwissPostPayload(orderInfo, awb);
    console.log("[SWISS POST] payload", payload);

    const swissRes = await requestSwissPostLabel(payload);
    console.log("[SWISS POST] response", swissRes);
    const labelPayload = extractLabelPayload(swissRes.data);
    let labelFilePath: string | null = null;
    let printJobResult: PrintJobResult | null = null;

    if (labelPayload?.base64) {
      try {
        labelFilePath = await persistLabel(
          labelPayload.base64,
          labelPayload.extension,
          `${shopifyOrderId}-${labelPayload.identifier}`
        );
        console.log("[SWISS POST] saved label to", labelFilePath);
      } catch (persistError: any) {
        console.error("[SWISS POST] Failed to persist label:", persistError?.message || persistError);
      }

      if (labelFilePath) {
        printJobResult = await submitPrintJob(labelFilePath);
        console.log("[SWISS POST] print job result", printJobResult);
      }
    }

    return NextResponse.json(
      {
        ok: swissRes.ok,
        status: swissRes.ok ? "OK" : `HTTP_${swissRes.status}`,
        awb,
        shopifyOrderId,
        response: swissRes.data,
        labelFilePath,
        printJobResult,
      },
      { status: swissRes.ok ? 200 : 502 }
    );
  } catch (error: any) {
    console.error("[SWISS POST] Error:", error?.message || error);
    if (error?.stack) {
      console.error("[SWISS POST] Stack:", error.stack);
    }
    return NextResponse.json(
      { ok: false, error: error?.message || "Error" },
      { status: 500 }
    );
  }
}

