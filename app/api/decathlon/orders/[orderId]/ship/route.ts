import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import { requestSwissPostLabel } from "@/lib/swissPost";
import { getStorageAdapter } from "@/galaxus/storage/storage";
import { DocumentType, Prisma } from "@prisma/client";
import { buildDecathlonOrdersClient } from "@/decathlon/mirakl/ordersClient";
import { canPartnerAccessDecathlonOrder } from "@/decathlon/orders/partnerLineScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Prisma `create` must not pass `miraklShipmentId` when the local generated client predates that field
 * (otherwise: Unknown argument `miraklShipmentId`). If the DB column exists (after migrate), set it via raw SQL.
 */
async function tryPersistMiraklShipmentId(shipmentId: string, miraklShipmentId: string | null) {
  const mid = String(miraklShipmentId ?? "").trim();
  if (!mid) return;
  try {
    await prisma.$executeRaw(
      Prisma.sql`UPDATE "public"."DecathlonShipment" SET "miraklShipmentId" = ${mid} WHERE "id" = ${shipmentId}`
    );
  } catch (e: any) {
    console.warn(
      "[DECATHLON][SHIP] miraklShipmentId column update skipped (optional — run `npx prisma migrate deploy` && `npx prisma generate`):",
      e?.message ?? e
    );
  }
}

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

function isMiraklMultiShipmentTrackingError(message: string): boolean {
  const msg = message.toLowerCase();
  return msg.includes("several shipments") || msg.includes("multiple shipments");
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
        ok: true,
        skipped: true,
        message: `No ${PRINT_COMMAND} on this host (typical on a VPS: no local CUPS). Label is stored — use SWISS_POST_AUTO_PRINT=0 on the server, or print the PDF from your machine.`,
      };
    }
    console.error("[SWISS POST] Print job failed:", message);
    return { ok: false, error: message };
  }
}

function getLabelFileExtension(format?: string) {
  const cleaned = String(format || "pdf").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (["pdf", "jpg", "jpeg", "png", "gif", "svg"].includes(cleaned)) {
    return cleaned;
  }
  return "pdf";
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
  if (!base64) return null;
  const format =
    labelEntry?.format ||
    labelEntry?.type ||
    labelEntry?.fileType ||
    labelEntry?.imageFileType ||
    "pdf";
  return {
    base64,
    extension: getLabelFileExtension(format),
  };
}

function extractSwissPostTracking(response: any): string | null {
  if (!response) return null;
  const item = Array.isArray(response.item) ? response.item[0] : response.item;
  if (!item) return null;
  const direct =
    item?.identCode ||
    item?.identcode ||
    item?.barcode ||
    (Array.isArray(item?.barcodes) ? item.barcodes[0] : null);
  if (direct) return String(direct).trim();
  const labelEntry = Array.isArray(item?.label) ? item.label[0] : item.label;
  const nested =
    labelEntry?.identCode ||
    labelEntry?.identcode ||
    labelEntry?.barcode ||
    (Array.isArray(labelEntry?.barcodes) ? labelEntry.barcodes[0] : null);
  if (nested) return String(nested).trim();
  return null;
}

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

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function buildFullName(first: unknown, last: unknown): string | null {
  const parts = [first, last].map((value) => String(value ?? "").trim()).filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

function normalizeAddressLines(
  source: any,
  names?: { firstName?: string | null; lastName?: string | null; fullName?: string | null }
) {
  const ignore = new Set(
    [names?.firstName, names?.lastName, names?.fullName]
      .map((value) => String(value ?? "").trim().toLowerCase())
      .filter(Boolean)
  );
  const normalize = (value: unknown) => {
    const text = String(value ?? "").trim();
    if (!text) return null;
    if (ignore.has(text.toLowerCase())) return null;
    return text;
  };
  const pickFirst = (values: unknown[]) => {
    for (const value of values) {
      const candidate = normalize(value);
      if (candidate) return candidate;
    }
    return null;
  };
  const line1 = pickFirst([
    source?.street_1,
    source?.street1,
    source?.address1,
    source?.address_1,
    source?.street,
  ]);
  const line2 = pickFirst([source?.street_2, source?.street2, source?.address2, source?.address_2]);
  if (line1 && line2) {
    const lower1 = line1.toLowerCase();
    const lower2 = line2.toLowerCase();
    if (lower1.includes(lower2)) return { address1: line1, address2: null };
    if (lower2.includes(lower1)) return { address1: line2, address2: null };
    if (line1.length <= 4 && line2.length >= 6) {
      return { address1: `${line1} ${line2}`.trim(), address2: null };
    }
  }
  return { address1: line1 ?? null, address2: line2 ?? null };
}

function resolveRawRecipient(order: any) {
  const raw = order?.rawJson;
  if (!raw || typeof raw !== "object") return null;
  const source =
    raw?.shipping_address ??
    raw?.shippingAddress ??
    raw?.shipping ??
    raw?.delivery_address ??
    raw?.deliveryAddress ??
    raw?.delivery ??
    raw?.customer?.shipping_address ??
    raw?.customer?.shippingAddress ??
    raw?.customer?.delivery_address ??
    raw?.customer?.deliveryAddress ??
    raw?.customer?.delivery ??
    raw?.customer?.billing_address ??
    raw?.customer?.billingAddress ??
    null;
  if (!source || typeof source !== "object") return null;
  const firstName = pickString(source.firstname, source.first_name, source.firstName);
  const lastName = pickString(source.lastname, source.last_name, source.lastName);
  const fullName = buildFullName(firstName, lastName);
  const name = pickString(fullName, source.name, source.name1, source.full_name, source.company, source.company_2);
  const { address1, address2 } = normalizeAddressLines(source, { firstName, lastName, fullName });
  return {
    name,
    email: pickString(source.email),
    phone: pickString(source.phone, source.phone_number, source.mobile, source.mobile_phone),
    address1,
    address2,
    postalCode: pickString(source.zip_code, source.zipCode, source.zip, source.postal_code, source.postcode),
    city: pickString(source.city, source.town),
    country: pickString(source.country, source.country_code, source.countryCode, source.country_iso_code),
    countryCode: pickString(source.country_code, source.countryCode, source.country_iso_code, source.country),
  };
}

function normalizeCountryCode(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return upper;
  const iso3: Record<string, string> = { CHE: "CH", DEU: "DE", FRA: "FR", ITA: "IT", AUT: "AT" };
  if (iso3[upper]) return iso3[upper];
  const lower = raw.toLowerCase();
  if (["schweiz", "suisse", "svizzera", "switzerland", "swiss"].includes(lower)) return "CH";
  if (["deutschland", "germany"].includes(lower)) return "DE";
  if (["france"].includes(lower)) return "FR";
  if (["italy", "italia"].includes(lower)) return "IT";
  if (["austria", "österreich", "osterreich"].includes(lower)) return "AT";
  return null;
}

function normalizePostalCode(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return raw.replace(/^CH[\s-]*/i, "").trim();
}

function extractOrderDetails(payload: any) {
  if (!payload) return null;
  if (payload?.order) return payload.order;
  if (payload?.orders && Array.isArray(payload.orders) && payload.orders[0]) return payload.orders[0];
  return payload;
}

function normalizeMiraklOrderStateFromPayload(order: Record<string, unknown> | null | undefined): string {
  if (!order || typeof order !== "object") return "";
  const o = order as Record<string, unknown>;
  const statusObj = o.status && typeof o.status === "object" ? (o.status as Record<string, unknown>) : null;
  const raw = String(
    o.order_state ??
      o.order_state_code ??
      o.orderState ??
      o.state ??
      statusObj?.state ??
      statusObj?.order_state ??
      o.status ??
      ""
  ).trim();
  return raw.toUpperCase();
}

/**
 * Mirakl PUT /ship rejected because the order is already SHIPPED (expected prior state SHIPPING).
 * Happens when a previous run marked Mirakl shipped but local DB persist failed.
 */
function isMiraklAlreadyShippedTransitionError(message: string): boolean {
  const m = String(message ?? "");
  return /current status is\s*['"]?SHIPPED['"]?/i.test(m) && /SHIPPING/i.test(m);
}

function isMiraklShippingRequiredError(message: string): boolean {
  const m = String(message ?? "");
  return /status must be ['"]?SHIPPING['"]?/i.test(m) && /RECEIVED/i.test(m);
}

function buildMiraklAcceptPayload(lines: any[]) {
  const orderLines = (lines ?? [])
    .map((line) => ({
      order_line_id: String(line?.orderLineId ?? "").trim(),
      accepted: true,
    }))
    .filter((line) => line.order_line_id);
  return { order_lines: orderLines };
}

type MiraklOrdersClient = ReturnType<typeof buildDecathlonOrdersClient>;

async function tryResolveMiraklShipmentMeta(
  client: MiraklOrdersClient,
  miraklOrderId: string
): Promise<{ miraklShipmentId: string | null; trackingNumber: string | null }> {
  try {
    const listed = await client.listShipments(miraklOrderId);
    const rows = (listed as { data?: unknown[] })?.data ?? [];
    const first = Array.isArray(rows) ? rows[0] : null;
    if (!first || typeof first !== "object") return { miraklShipmentId: null, trackingNumber: null };
    const row = first as { id?: unknown; tracking?: { tracking_number?: unknown } };
    return {
      miraklShipmentId: String(row.id ?? "").trim() || null,
      trackingNumber: String(row.tracking?.tracking_number ?? "").trim() || null,
    };
  } catch {
    return { miraklShipmentId: null, trackingNumber: null };
  }
}

/** Units already recorded on local DecathlonShipmentLines for the given order lines (by internal line id). */
function localShippedUnitsForLines(
  order: { shipments?: unknown[] },
  internalLineIds: Set<string>
): number {
  const shipments = Array.isArray(order.shipments) ? order.shipments : [];
  const shipmentLines = shipments.flatMap((s: any) => (Array.isArray(s?.lines) ? s.lines : []));
  let sum = 0;
  for (const sl of shipmentLines) {
    const id = String((sl as { orderLineId?: unknown }).orderLineId ?? "").trim();
    if (!id || !internalLineIds.has(id)) continue;
    const q = Number((sl as { quantity?: unknown }).quantity ?? 0);
    if (Number.isFinite(q) && q > 0) sum += q;
  }
  return sum;
}

function isRecipientComplete(recipient: SwissPostRecipient | null | undefined) {
  return Boolean(
    recipient?.name1?.trim() &&
      recipient?.street?.trim() &&
      recipient?.zip?.trim() &&
      recipient?.city?.trim()
  );
}

const SWISS_POST_FIELD_MAX = 35;

/**
 * Swiss Post fields (street, name2, addressSuffix) are capped at 35 chars each.
 * Split address1 + address2 across street / addressSuffix / name2 so nothing overflows.
 */
function fitAddress(address1: string, address2: string): {
  street: string;
  addressSuffix: string | null;
  name2: string | null;
} {
  const a1 = address1.trim();
  const a2 = address2.trim();

  if (a1.length <= SWISS_POST_FIELD_MAX && !a2) {
    return { street: a1, addressSuffix: null, name2: null };
  }

  if (a1.length <= SWISS_POST_FIELD_MAX && a2.length <= SWISS_POST_FIELD_MAX) {
    return { street: a1, addressSuffix: a2, name2: null };
  }

  if (a1.length <= SWISS_POST_FIELD_MAX && a2.length > SWISS_POST_FIELD_MAX) {
    return {
      street: a1,
      addressSuffix: a2.slice(0, SWISS_POST_FIELD_MAX),
      name2: a2.length > SWISS_POST_FIELD_MAX ? a2.slice(SWISS_POST_FIELD_MAX, SWISS_POST_FIELD_MAX * 2).trim() || null : null,
    };
  }

  const street = a1.slice(0, SWISS_POST_FIELD_MAX);
  const overflow = a1.slice(SWISS_POST_FIELD_MAX).trim();
  const suffix = (overflow ? `${overflow} ${a2}`.trim() : a2).slice(0, SWISS_POST_FIELD_MAX) || null;
  return { street, addressSuffix: suffix, name2: null };
}

function buildRecipient(order: any): SwissPostRecipient & { addressSuffix?: string | null } {
  const rawRecipient = resolveRawRecipient(order);
  const recipientName = pickString(rawRecipient?.name, order.recipientName);
  const recipientAddress1 = pickString(rawRecipient?.address1, order.recipientAddress1);
  const recipientAddress2 = pickString(rawRecipient?.address2, order.recipientAddress2);
  const recipientPostalCode = pickString(rawRecipient?.postalCode, order.recipientPostalCode);
  const recipientCity = pickString(rawRecipient?.city, order.recipientCity);
  const recipientCountry = pickString(rawRecipient?.country, order.recipientCountry);
  const recipientCountryCode = pickString(rawRecipient?.countryCode, order.recipientCountryCode);
  const recipientPhone = pickString(rawRecipient?.phone, order.recipientPhone);
  const recipientEmail = pickString(rawRecipient?.email, order.recipientEmail, order.customerEmail);
  const hasRecipient = Boolean(
    recipientName ||
      recipientAddress1 ||
      recipientPostalCode ||
      recipientCity ||
      recipientCountry ||
      recipientCountryCode
  );
  if (hasRecipient) {
    const country = normalizeCountryCode(recipientCountryCode ?? recipientCountry) ?? "CH";
    const zip = normalizePostalCode(recipientPostalCode) ?? "";
    const { street, addressSuffix, name2 } = fitAddress(recipientAddress1 ?? "", recipientAddress2 ?? "");
    return {
      name1: (recipientName ?? "").slice(0, SWISS_POST_FIELD_MAX),
      firstName: null,
      name2,
      street,
      addressSuffix,
      zip,
      city: (recipientCity ?? "").slice(0, SWISS_POST_FIELD_MAX),
      country,
      phone: recipientPhone ?? null,
      email: recipientEmail ?? null,
    };
  }
  const customerName = pickString(order.customerName);
  const customerCity = pickString(order.customerCity);
  const customerPhone = pickString(order.customerPhone);
  const country = normalizeCountryCode(order.customerCountryCode ?? order.customerCountry) ?? "CH";
  const zip = normalizePostalCode(order.customerPostalCode) ?? "";
  const { street, addressSuffix, name2 } = fitAddress(order.customerAddress1 ?? "", order.customerAddress2 ?? "");
  return {
    name1: (customerName ?? "").slice(0, SWISS_POST_FIELD_MAX),
    firstName: null,
    name2,
    street,
    addressSuffix,
    zip,
    city: (customerCity ?? "").slice(0, SWISS_POST_FIELD_MAX),
    country,
    phone: customerPhone ?? null,
    email: order.customerEmail ?? null,
  };
}

function buildSwissPostPayload(order: any, trackingNumber: string, recipientOverride?: SwissPostRecipient) {
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
  const basePrzlValues = (process.env.SWISS_POST_PRZL || "ECO")
    .split(",")
    .map((value: string) => value.trim())
    .filter(Boolean);
  const przlValues = basePrzlValues.length ? basePrzlValues : ["ECO"];

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

  const recipient = recipientOverride ?? buildRecipient(order);
  const labelLayout =
    process.env.DECATHLON_SWISS_POST_LABEL_LAYOUT ||
    process.env.SWISS_POST_LABEL_LAYOUT ||
    "A7";
  return {
    language,
    frankingLicense,
    ppFranking,
    labelDefinition: {
      labelLayout,
      printAddresses: process.env.SWISS_POST_LABEL_PRINT_ADDRESSES || "ONLY_RECIPIENT",
      imageFileType: (process.env.SWISS_POST_IMAGE_FILE_TYPE || "JPG").toUpperCase(),
      imageResolution,
      printPreview: process.env.SWISS_POST_LABEL_PRINT_PREVIEW === "1",
    },
    customer: sender,
    item: {
      itemID: `${order?.orderId || trackingNumber}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      recipient,
      attributes: { przl: przlValues },
      notification:
        notificationService && (recipient.email || recipient.phone)
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;
    const { searchParams } = new URL(request.url);
    const scope = String(searchParams.get("scope") ?? "").trim().toLowerCase();
    const partnerSession = scope === "partner" ? await getPartnerSession(request) : null;
    const partnerKey = normalizeProviderKey(partnerSession?.partnerKey ?? null);
    if (scope === "partner" && !partnerSession) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (scope === "partner" && !partnerKey) {
      return NextResponse.json({ ok: false, error: "Partner key missing" }, { status: 400 });
    }
    const order =
      (await (prisma as any).decathlonOrder.findUnique({
        where: { id: orderId },
        include: { lines: true, shipments: { include: { lines: true } } },
      })) ??
      (await (prisma as any).decathlonOrder.findUnique({
        where: { orderId },
        include: { lines: true, shipments: { include: { lines: true } } },
      }));
    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }
    if (scope === "partner" && partnerKey && !canPartnerAccessDecathlonOrder(order, partnerKey)) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      trackingNumber?: string;
      items?: Array<{ lineId?: string; orderLineId?: string; quantity?: number }>;
    };
    const trackingNumber = String(body?.trackingNumber ?? "").trim() || String(order.orderId ?? "").trim();

    const orderLines = Array.isArray(order.lines) ? order.lines : [];
    if (orderLines.length === 0) {
      return NextResponse.json({ ok: false, error: "Order has no lines" }, { status: 400 });
    }

    const shipmentLines = (order.shipments ?? []).flatMap((shipment: any) => shipment.lines ?? []);
    const shippedByLineId = new Map<string, number>();
    for (const line of shipmentLines) {
      const lineId = String(line.orderLineId ?? "").trim();
      if (!lineId) continue;
      const qty = Number(line.quantity ?? 0);
      shippedByLineId.set(lineId, (shippedByLineId.get(lineId) ?? 0) + (Number.isFinite(qty) ? qty : 0));
    }
    const hasLegacyShipment = shipmentLines.length === 0 && (order.shipments ?? []).some((s: any) => s.shippedAt);
    if (hasLegacyShipment) {
      return NextResponse.json({ ok: false, error: "Order already shipped" }, { status: 400 });
    }

    const resolveRemainingQty = (line: any) => {
      const ordered = Number(line?.quantity ?? 0);
      const shipped = shippedByLineId.get(line.id) ?? 0;
      if (!Number.isFinite(ordered)) return 0;
      return Math.max(ordered - shipped, 0);
    };

    const normalizeQty = (value: unknown) => {
      const parsed = Number.parseInt(String(value ?? ""), 10);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const requestedItems = Array.isArray(body.items) ? body.items : [];
    const itemsProvided = requestedItems.length > 0;
    const itemsToShip: Array<{ line: any; quantity: number }> = [];

    if (itemsProvided) {
      const requestedByLine = new Map<string, { line: any; quantity: number }>();
      for (const item of requestedItems) {
        const quantity = normalizeQty(item?.quantity);
        if (quantity <= 0) {
          return NextResponse.json({ ok: false, error: "Invalid shipment quantity" }, { status: 400 });
        }
        const line = item?.lineId
          ? orderLines.find((l: any) => l.id === item.lineId)
          : item?.orderLineId
            ? orderLines.find((l: any) => l.orderLineId === item.orderLineId)
            : null;
        if (!line) {
          return NextResponse.json({ ok: false, error: "Order line not found" }, { status: 400 });
        }
        const miraklLineId = String(line.orderLineId ?? "").trim();
        if (!miraklLineId) {
          return NextResponse.json({ ok: false, error: "Order line is missing Mirakl id" }, { status: 400 });
        }
        const remaining = resolveRemainingQty(line);
        if (remaining <= 0) {
          return NextResponse.json({ ok: false, error: "Order line already shipped" }, { status: 400 });
        }
        const existing = requestedByLine.get(line.id);
        const nextQty = (existing?.quantity ?? 0) + quantity;
        if (nextQty > remaining) {
          return NextResponse.json({ ok: false, error: "Shipment exceeds remaining quantity" }, { status: 400 });
        }
        requestedByLine.set(line.id, { line, quantity: nextQty });
      }
      itemsToShip.push(...requestedByLine.values());
    } else {
      for (const line of orderLines) {
        if (scope === "partner" && partnerKey) {
          const sku = String(line.offerSku ?? "").toUpperCase();
          if (!sku.startsWith(`${partnerKey}_`)) continue;
        }
        const remaining = resolveRemainingQty(line);
        if (remaining > 0) {
          itemsToShip.push({ line, quantity: remaining });
        }
      }
    }

    if (itemsToShip.length === 0) {
      return NextResponse.json({ ok: false, error: "No remaining quantity to ship" }, { status: 400 });
    }

    // Mirakl is already SHIPPED but local DB still shows remaining units (partial/stale rows, or persist failed after Mirakl ship).
    if (!itemsProvided) {
      try {
        const peekClient = buildDecathlonOrdersClient();
        const livePayload = await peekClient.getOrder(order.orderId);
        const liveOrder = extractOrderDetails(livePayload) as Record<string, unknown> | null | undefined;
        const liveState = normalizeMiraklOrderStateFromPayload(liveOrder ?? null);
        if (liveState === "SHIPPED") {
          const internalIds = new Set(
            itemsToShip.map(({ line }) => String(line?.id ?? "").trim()).filter(Boolean)
          );
          const targetUnits = itemsToShip.reduce((s, { quantity }) => s + quantity, 0);
          const shippedLocal = localShippedUnitsForLines(order, internalIds);

          if (targetUnits > 0 && shippedLocal >= targetUnits) {
            await (prisma as any).decathlonOrder.update({
              where: { id: order.id },
              data: { orderState: "SHIPPED" },
            });
            return NextResponse.json({
              ok: true,
              reconciled: true,
              alreadyInSync: true,
              message:
                "Mirakl is already SHIPPED and local shipment lines already cover these units — refreshed order state only (no Swiss Post label).",
            });
          }

          if (targetUnits > 0 && shippedLocal < targetUnits) {
            const meta = await tryResolveMiraklShipmentMeta(peekClient, order.orderId);
            const tracking =
              meta.trackingNumber ||
              String(body?.trackingNumber ?? "").trim() ||
              String(order.orderId ?? "").trim();
            const shipment = await (prisma as any).decathlonShipment.create({
              data: {
                orderId: order.id,
                carrierFinal: "swisspost",
                carrierRaw: "swisspost",
                trackingNumber: tracking,
                shippedAt: new Date(),
                labelGeneratedAt: null,
              },
            });
            await tryPersistMiraklShipmentId(shipment.id, meta.miraklShipmentId);
            await (prisma as any).decathlonShipmentLine.createMany({
              data: itemsToShip.map(({ line, quantity }) => ({
                shipmentId: shipment.id,
                orderLineId: line.id,
                quantity,
              })),
            });
            await (prisma as any).decathlonOrder.update({
              where: { id: order.id },
              data: { orderState: "SHIPPED" },
            });
            return NextResponse.json({
              ok: true,
              reconciled: true,
              shipmentId: shipment.id,
              trackingNumber: tracking,
              miraklShipmentId: meta.miraklShipmentId,
              message:
                "Mirakl order was already SHIPPED; local DB was behind — synced remaining lines without calling Mirakl ship or Swiss Post.",
            });
          }
        }
      } catch (reconcileProbeErr) {
        console.warn("[DECATHLON][SHIP] Mirakl SHIPPED preflight skipped:", reconcileProbeErr);
      }
    }

    let recipient = buildRecipient(order);
    const recipientLocked = Boolean((order as any).recipientAddressLocked);
    if (recipientLocked && !isRecipientComplete(recipient)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Recipient address is locked but incomplete. Update the address before generating the label.",
        },
        { status: 400 }
      );
    }
    if (!recipientLocked && !isRecipientComplete(recipient)) {
      try {
        const client = buildDecathlonOrdersClient();
        const detailsPayload = await client.getOrder(order.orderId);
        const detailsOrder = extractOrderDetails(detailsPayload);
        if (detailsOrder) {
          const enrichedOrder = { ...order, rawJson: detailsOrder };
          const enrichedRecipient = buildRecipient(enrichedOrder);
          if (isRecipientComplete(enrichedRecipient)) {
            recipient = enrichedRecipient;
            const rawRecipient = resolveRawRecipient(enrichedOrder);
            await (prisma as any).decathlonOrder.update({
              where: { id: order.id },
              data: {
                recipientName: pickString(order.recipientName, rawRecipient?.name),
                recipientEmail: pickString(order.recipientEmail, rawRecipient?.email),
                recipientPhone: pickString(order.recipientPhone, rawRecipient?.phone),
                recipientAddress1: pickString(order.recipientAddress1, rawRecipient?.address1),
                recipientAddress2: pickString(order.recipientAddress2, rawRecipient?.address2),
                recipientPostalCode: pickString(order.recipientPostalCode, rawRecipient?.postalCode),
                recipientCity: pickString(order.recipientCity, rawRecipient?.city),
                recipientCountry: pickString(order.recipientCountry, rawRecipient?.country),
                recipientCountryCode: pickString(
                  order.recipientCountryCode,
                  rawRecipient?.countryCode
                ),
                rawJson: detailsOrder,
              },
            });
          }
        }
      } catch (detailError) {
        console.warn("[DECATHLON][SHIP] Failed to load order details for recipient fallback", detailError);
      }
    }

    const payload = buildSwissPostPayload(order, trackingNumber, recipient);
    const swissRes = await requestSwissPostLabel(payload);
    if (!swissRes.ok) {
      return NextResponse.json(
        { ok: false, error: "Swiss Post label generation failed", swissPost: swissRes.data },
        { status: 502 }
      );
    }
    const swissPostLabelId = extractSwissPostTracking(swissRes.data);
    if (!swissPostLabelId) {
      return NextResponse.json(
        { ok: false, error: "Swiss Post identCode missing from label response", swissPost: swissRes.data },
        { status: 502 }
      );
    }
    const labelPayload = extractLabelPayload(swissRes.data);
    if (!labelPayload?.base64) {
      return NextResponse.json({ ok: false, error: "Swiss Post label missing content" }, { status: 502 });
    }

    const buffer = Buffer.from(labelPayload.base64, "base64");
    const storage = getStorageAdapter();
    const existingDocs = await (prisma as any).decathlonOrderDocument.findMany({
      where: { orderId: order.id, type: DocumentType.LABEL },
      orderBy: { version: "desc" },
      take: 1,
    });
    const nextVersion = existingDocs[0]?.version ? existingDocs[0].version + 1 : 1;
    const key = `decathlon/${order.orderId}/shipping-labels/v${nextVersion}.${labelPayload.extension}`;
    const stored = await storage.uploadPdf(key, buffer);
    const client = buildDecathlonOrdersClient();
    let miraklShipmentId: string | null = null;
    const hasPriorShipments = (order.shipments ?? []).some(
      (s: any) => Boolean(s?.shippedAt || s?.trackingNumber || s?.miraklShipmentId)
    );
    const shouldCreateShipment = itemsProvided || hasPriorShipments;
    const createShipment = async () => {
      try {
        const st01 = await client.createShipments({
          shipments: [
            {
              order_id: order.orderId,
              shipment_lines: itemsToShip.map(({ line, quantity }) => ({
                order_line_id: String(line.orderLineId ?? "").trim(),
                quantity,
              })),
              tracking: {
                carrier_code: "SWISSPOST",
                carrier_name: "Swiss Post",
                tracking_number: swissPostLabelId,
              },
              shipped: true,
            },
          ],
        });
        miraklShipmentId = String(st01?.shipment_success?.[0]?.id ?? "").trim() || null;
      } catch (stErr: any) {
        const msg = String(stErr?.message ?? stErr);
        if (isMiraklShippingRequiredError(msg)) {
          const payload = buildMiraklAcceptPayload(orderLines);
          if (payload.order_lines.length) {
            try {
              await client.acceptOrder(order.orderId, payload);
            } catch (acceptErr: any) {
              console.warn(
                "[DECATHLON][SHIP] acceptOrder failed before retrying createShipments:",
                acceptErr?.message ?? acceptErr
              );
            }
            const retry = await client.createShipments({
              shipments: [
                {
                  order_id: order.orderId,
                  shipment_lines: itemsToShip.map(({ line, quantity }) => ({
                    order_line_id: String(line.orderLineId ?? "").trim(),
                    quantity,
                  })),
                  tracking: {
                    carrier_code: "SWISSPOST",
                    carrier_name: "Swiss Post",
                    tracking_number: swissPostLabelId,
                  },
                  shipped: true,
                },
              ],
            });
            miraklShipmentId = String(retry?.shipment_success?.[0]?.id ?? "").trim() || null;
            return;
          }
        }
        if (!isMiraklAlreadyShippedTransitionError(msg)) throw stErr;
        const meta = await tryResolveMiraklShipmentMeta(client, order.orderId);
        miraklShipmentId = meta.miraklShipmentId;
        console.warn("[DECATHLON][SHIP] createShipments skipped (Mirakl already terminal); persisting local rows.", {
          orderId: order.orderId,
        });
      }
    };

    if (shouldCreateShipment) {
      await createShipment();
    } else {
      try {
        await client.setTracking(order.orderId, {
          carrier_code: "SWISSPOST",
          carrier_name: "Swiss Post",
          tracking_number: swissPostLabelId,
        });
        try {
          await client.shipOrder(order.orderId, {});
        } catch (shipErr: any) {
          const msg = String(shipErr?.message ?? shipErr);
          if (!isMiraklAlreadyShippedTransitionError(msg)) throw shipErr;
          const meta = await tryResolveMiraklShipmentMeta(client, order.orderId);
          miraklShipmentId = meta.miraklShipmentId;
          console.warn("[DECATHLON][SHIP] shipOrder skipped (already SHIPPED on Mirakl); persisting local shipment.", {
            orderId: order.orderId,
          });
        }
      } catch (trackErr: any) {
        const msg = String(trackErr?.message ?? trackErr);
        if (!isMiraklMultiShipmentTrackingError(msg)) throw trackErr;
        await createShipment();
      }
    }

    const shipment = await (prisma as any).decathlonShipment.create({
      data: {
        orderId: order.id,
        carrierFinal: "swisspost",
        carrierRaw: "swisspost",
        trackingNumber: swissPostLabelId,
        shippedAt: new Date(),
        labelGeneratedAt: new Date(),
      },
    });
    await tryPersistMiraklShipmentId(shipment.id, miraklShipmentId);

    await (prisma as any).decathlonShipmentLine.createMany({
      data: itemsToShip.map(({ line, quantity }) => ({
        shipmentId: shipment.id,
        orderLineId: line.id,
        quantity,
      })),
    });

    const document = await (prisma as any).decathlonOrderDocument.create({
      data: {
        orderId: order.id,
        shipmentId: shipment.id,
        type: DocumentType.LABEL,
        version: nextVersion,
        storageUrl: stored.storageUrl,
        checksum: null,
      },
    });

    let printJobResult: PrintJobResult | null = null;
    if (resolveAutoPrintEnabled()) {
      try {
        await ensureLabelDirectory();
        const safeId = sanitizeFileName(`${order.orderId || order.id}-label`);
        const fileName = `${safeId}-${Date.now()}.${labelPayload.extension}`;
        const filePath = path.join(LABEL_OUTPUT_DIR, fileName);
        await fs.writeFile(filePath, buffer);
        printJobResult = await submitPrintJob(filePath);
      } catch (error: any) {
        const message = error?.message ?? String(error);
        printJobResult = { ok: false, error: message };
      }
    }

    return NextResponse.json({
      ok: true,
      documentId: document.id,
      labelUrl: stored.storageUrl,
      trackingNumber: swissPostLabelId,
      shipmentId: shipment.id,
      miraklShipmentId,
      printJobResult,
    });
  } catch (error: any) {
    console.error("[DECATHLON][SHIP] Failed:", error);
    const code = String(error?.code ?? "");
    const msg = String(error?.message ?? error ?? "Ship failed");
    const migrationHint =
      code === "P2022" || /column .*does not exist|does not exist in the current database/i.test(msg)
        ? " Run `npx prisma migrate deploy` (or `migrate dev`) so the DB matches the Prisma schema, then restart `next dev`."
        : "";
    return NextResponse.json({ ok: false, error: `${msg}${migrationHint}` }, { status: 500 });
  }
}
