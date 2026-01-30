import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { prisma } from "@/app/lib/prisma";
import {
  buildLineItemsByFulfillmentOrder,
  createFulfillment,
  fetchOrderFulfillmentMap,
  fetchOrderIdByName,
  fetchOrderShippingInfo,
  orderHasTrackingNumber,
} from "@/lib/shopifyFulfillment";
import { requestSwissPostLabel } from "@/lib/swissPost";

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

type OrderMatchSelection = {
  id: string;
  shopifyOrderId: string;
  shopifyOrderName: string | null;
  shopifySku: string | null;
  shopifyProductTitle: string | null;
  shopifySizeEU: string | null;
  stockxTrackingUrl: string | null;
};

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

function buildSwissPostPayload(
  orderInfo: Awaited<ReturnType<typeof fetchOrderShippingInfo>>,
  awb: string
) {
  const language = process.env.SWISS_POST_LANGUAGE || "DE";
  const frankingLicense = process.env.SWISS_POST_FRANKING_LICENSE || "";
  const ppFranking = process.env.SWISS_POST_PP_FRANKING === "1";
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
      attributes: {
        przl: przlValues,
      },
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FulfillStatus =
  | "FULFILLED"
  | "ALREADY_FULFILLED"
  | "NOT_FOUND"
  | "INVALID"
  | "SHOPIFY_ERROR";

const normalizeAwb = (code?: string | null) => {
  if (!code) return "";
  const trimmed = String(code).trim();
  const cleaned = trimmed.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "");
  if (/^\d{13,}$/.test(cleaned)) {
    return cleaned.slice(-12);
  }
  return cleaned;
};

export async function POST(req: NextRequest) {
  try {
    const withContext = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch (err: any) {
        console.error(`[FULFILL-FROM-AWB] ${label} failed:`, err?.message || err);
        if (err?.stack) {
          console.error(`[FULFILL-FROM-AWB] ${label} stack:`, err.stack);
        }
        throw err;
      }
    };
    const requiredKey = process.env.INTERNAL_API_KEY;
    if (requiredKey) {
      const provided = req.headers.get("x-internal-key");
      if (provided !== requiredKey) {
        return NextResponse.json(
          { ok: false, status: "INVALID" as FulfillStatus, error: "Unauthorized" },
          { status: 401 }
        );
      }
    }

    const body = await req.json().catch(() => ({}));
    const awb = normalizeAwb(body?.awb ?? body?.code);
    const trackingCompany = body?.trackingCompany ? String(body.trackingCompany).trim() : null;
    const trackingUrlFromBody = body?.trackingUrl ? String(body.trackingUrl).trim() : null;
    const notifyCustomer = Boolean(body?.notifyCustomer ?? false);
    const swissPostEnabled = Boolean(body?.swissPostEnabled ?? false);
    const swissPostPayload = body?.swissPostPayload ?? null;
    const allowAlreadyFulfilled = Boolean(body?.allowAlreadyFulfilled ?? false);

    if (!awb) {
      return NextResponse.json(
        { ok: false, status: "INVALID" as FulfillStatus, error: "Missing AWB" },
        { status: 400 }
      );
    }

    const matches = (await prisma.orderMatch.findMany({
      where: { stockxAwb: awb },
      select: {
        id: true,
        shopifyOrderId: true,
        shopifyOrderName: true,
        shopifySku: true,
        shopifyProductTitle: true,
        shopifySizeEU: true,
        stockxTrackingUrl: true,
      },
    })) as OrderMatchSelection[];

    if (matches.length === 0) {
      return NextResponse.json(
        { ok: false, status: "NOT_FOUND" as FulfillStatus, awb },
        { status: 404 }
      );
    }

    const uniqueOrderIds = Array.from(
      new Set(matches.map((m) => m.shopifyOrderId).filter(Boolean))
    );

    if (uniqueOrderIds.length > 1) {
      return NextResponse.json(
        {
          ok: false,
          status: "INVALID" as FulfillStatus,
          awb,
          error: "AWB matches multiple Shopify orders",
          orderIds: uniqueOrderIds,
        },
        { status: 409 }
      );
    }

    let shopifyOrderId = uniqueOrderIds[0] || "";
    const shopifyOrderName = matches[0]?.shopifyOrderName || null;
    let trackingUrl = trackingUrlFromBody || matches[0]?.stockxTrackingUrl || null;

    if (!shopifyOrderId && shopifyOrderName) {
      const found = await fetchOrderIdByName(shopifyOrderName);
      shopifyOrderId = found?.id || "";
    }

    if (!shopifyOrderId) {
      return NextResponse.json(
        { ok: false, status: "INVALID" as FulfillStatus, awb, error: "Missing shopifyOrderId" },
        { status: 400 }
      );
    }

    const existing = await prisma.shopifyFulfillmentRecord.findFirst({
      where: { trackingNumber: awb },
    });

    const map = await withContext("fetchOrderFulfillmentMap", () =>
      fetchOrderFulfillmentMap(shopifyOrderId)
    );
    if (!map.order) {
      return NextResponse.json(
        { ok: false, status: "SHOPIFY_ERROR" as FulfillStatus, awb, error: "Order not found" },
        { status: 404 }
      );
    }

    const dbItems = matches.map((m) => ({
      sku: m.shopifySku ?? null,
      title: m.shopifyProductTitle ?? null,
      sizeEU: m.shopifySizeEU ?? null,
      quantity: 1,
      sourceId: m.id,
    }));

    const orderInfo = await withContext("fetchOrderShippingInfo", () =>
      fetchOrderShippingInfo(shopifyOrderId)
    );
    const orderLineItems = orderInfo?.lineItems?.nodes || [];

    const buildResult = buildLineItemsByFulfillmentOrder(
      map.order.fulfillmentOrders.nodes,
      dbItems,
      orderLineItems
    );
    let { lineItemsByFulfillmentOrder, unmatched, warnings, fulfillableFOs } = buildResult;

    if (
      allowAlreadyFulfilled &&
      lineItemsByFulfillmentOrder.length === 0 &&
      fulfillableFOs.length > 0
    ) {
      const remainingCandidates = fulfillableFOs.flatMap((fo) =>
        (fo.lineItems?.nodes || [])
          .filter((li) => Number(li.remainingQuantity ?? 0) > 0)
          .map((li) => ({
            fulfillmentOrderId: fo.id,
            lineItemId: li.id,
            remainingQuantity: Number(li.remainingQuantity ?? 0),
          }))
      );

      if (remainingCandidates.length === 1) {
        const onlyRemaining = remainingCandidates[0];
        lineItemsByFulfillmentOrder = [
          {
            fulfillmentOrderId: onlyRemaining.fulfillmentOrderId,
            fulfillmentOrderLineItems: [
              { id: onlyRemaining.lineItemId, quantity: onlyRemaining.remainingQuantity },
            ],
          },
        ];
        warnings.push(
          "Fallback applied: matched items were already fulfilled, fulfilling the only remaining line item."
        );
      }
    }

    if (lineItemsByFulfillmentOrder.length === 0) {
      if (fulfillableFOs.length === 0) {
        if (!allowAlreadyFulfilled) {
          const hasTracking = await withContext("orderHasTrackingNumber", () =>
            orderHasTrackingNumber(shopifyOrderId, awb)
          );
          if (hasTracking || existing) {
            return NextResponse.json(
              {
                ok: true,
                status: "ALREADY_FULFILLED" as FulfillStatus,
                awb,
                fulfillmentId: null,
                shopifyOrderId,
              },
              { status: 200 }
            );
          }
        }
      }

      return NextResponse.json(
        {
          ok: false,
          status: "INVALID" as FulfillStatus,
          awb,
          error:
            fulfillableFOs.length === 0
              ? "No fulfillable quantities remaining for this order"
              : "No fulfillable line items matched requested SKUs/titles",
          unmatched,
          warnings,
        },
        { status: 422 }
      );
    }

    const shouldCallSwissPost =
      swissPostEnabled || process.env.SWISS_POST_ENABLE === "1";

    let swissPostResult: Awaited<ReturnType<typeof requestSwissPostLabel>> | null = null;
    let swissPostLabelId: string | null = null;
    let swissPostBarcode: string | null = null;
    let swissPostStatus: string | null = null;
    let labelFilePath: string | null = null;
    let printJobResult: PrintJobResult | null = null;
    let trackingNumberForFulfillment = awb;
    let trackingCompanyForFulfillment = trackingCompany || "Swiss Post";

    if (shouldCallSwissPost && process.env.SWISS_POST_LABEL_ENDPOINT) {
      try {
        const payload =
          swissPostPayload && typeof swissPostPayload === "object"
            ? swissPostPayload
            : buildSwissPostPayload(orderInfo, awb);
        console.log("[SWISS POST] payload", payload);
        const swissRes = await withContext("requestSwissPostLabel", () =>
          requestSwissPostLabel(payload)
        );
        console.log("[SWISS POST] response", swissRes);
        swissPostStatus = swissRes.ok ? "OK" : `HTTP_${swissRes.status}`;
        if (!swissRes.ok) {
          return NextResponse.json(
            {
              ok: false,
              status: "SHOPIFY_ERROR" as FulfillStatus,
              awb,
              error: "Swiss Post label generation failed",
              swissPostStatus,
              swissPostResponse: swissRes.data,
            },
            { status: 502 }
          );
        }
        swissPostResult = swissRes;
        const itemData = Array.isArray(swissRes.data?.item)
          ? swissRes.data.item[0]
          : swissRes.data?.item || null;
        swissPostBarcode = itemData?.barcodes?.[0] || null;
        swissPostLabelId = itemData?.identCode || null;
        if (!swissPostLabelId) {
          return NextResponse.json(
            {
              ok: false,
              status: "SHOPIFY_ERROR" as FulfillStatus,
              awb,
              error: "Swiss Post identCode missing from label response",
              swissPostStatus,
              swissPostResponse: swissRes.data,
            },
            { status: 502 }
          );
        }
        trackingNumberForFulfillment = swissPostLabelId;
        trackingCompanyForFulfillment = "Swiss Post";
        trackingUrl = `https://service.post.ch/ekp-web/ui/entry/search/${encodeURIComponent(
          swissPostLabelId
        )}`;

        const labelPayload = extractLabelPayload(swissRes.data);
        if (labelPayload?.base64) {
          try {
            labelFilePath = await persistLabel(
              labelPayload.base64,
              labelPayload.extension,
              `${shopifyOrderId}-${labelPayload.identifier}`
            );
            printJobResult = await submitPrintJob(labelFilePath);
          } catch (persistError: any) {
            console.error(
              "[SWISS POST] Failed to persist/print label:",
              persistError?.message || persistError
            );
          }
        }
      } catch (swissError: any) {
        console.error("[SWISS POST] Error generating label:", swissError);
        return NextResponse.json(
          {
            ok: false,
            status: "SHOPIFY_ERROR" as FulfillStatus,
            awb,
            error: swissError?.message || "Swiss Post error",
          },
          { status: 500 }
        );
      }
    }

    const fulfillmentInput = {
      notifyCustomer,
      trackingInfo: {
        number: trackingNumberForFulfillment,
        url: trackingUrl,
        company: trackingCompanyForFulfillment,
      },
      lineItemsByFulfillmentOrder,
    };

    const result = await withContext("createFulfillment", () =>
      createFulfillment(fulfillmentInput)
    );
    const userErrors = result.fulfillmentCreate.userErrors || [];
    if (userErrors.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          status: "SHOPIFY_ERROR" as FulfillStatus,
          awb,
          userErrors,
        },
        { status: 400 }
      );
    }

    const fulfillment = result.fulfillmentCreate.fulfillment;
    if (!fulfillment) {
      return NextResponse.json(
        { ok: false, status: "SHOPIFY_ERROR" as FulfillStatus, awb, error: "Missing fulfillment" },
        { status: 500 }
      );
    }

    const record = await prisma.shopifyFulfillmentRecord.create({
      data: {
        shopifyOrderId,
        shopifyOrderName: map.order.name,
        trackingNumber: trackingNumberForFulfillment,
        trackingUrl,
        trackingCompany: trackingCompanyForFulfillment,
        status: fulfillment.status,
        sourceAwb: awb,
        swissPostStatus,
        swissPostLabelId,
        swissPostBarcode,
        swissPostResponse: swissPostResult?.data || null,
      },
    });

    
    return NextResponse.json(
      {
        ok: true,
        status: "FULFILLED" as FulfillStatus,
        awb,
        shopifyOrderId,
        shopifyOrderName: map.order.name,
        trackingNumber: trackingNumberForFulfillment,
        trackingCompany: trackingCompanyForFulfillment,
        swissPostLabelId,
        swissPostBarcode,
        swissPostStatus,
        swissPostResponse: swissPostResult?.data || null,
        labelFilePath,
        printJobResult,
        warnings,
        swissPost: shouldCallSwissPost ? "attempted" : "skipped",
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("[FULFILL-FROM-AWB] Error:", error?.message || error);
    if (error?.stack) {
      console.error("[FULFILL-FROM-AWB] Stack:", error.stack);
    }
    return NextResponse.json(
      { ok: false, status: "SHOPIFY_ERROR" as FulfillStatus, error: error.message || "Error" },
      { status: 500 }
    );
  }
}

