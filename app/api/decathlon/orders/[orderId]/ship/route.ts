import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import { requestSwissPostLabel } from "@/lib/swissPost";
import { getStorageAdapter } from "@/galaxus/storage/storage";
import { DocumentType } from "@prisma/client";
import { buildDecathlonOrdersClient } from "@/decathlon/mirakl/ordersClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const name = pickString(
    source.name,
    source.name1,
    source.full_name,
    fullName,
    source.company,
    source.company_2
  );
  return {
    name,
    email: pickString(source.email),
    phone: pickString(source.phone, source.phone_number, source.mobile, source.mobile_phone),
    address1: pickString(
      source.address1,
      source.street1,
      source.street_1,
      source.address_1,
      source.street
    ),
    address2: pickString(source.address2, source.street2, source.street_2, source.address_2),
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

function isRecipientComplete(recipient: SwissPostRecipient | null | undefined) {
  return Boolean(
    recipient?.name1?.trim() &&
      recipient?.street?.trim() &&
      recipient?.zip?.trim() &&
      recipient?.city?.trim()
  );
}

function buildRecipient(order: any): SwissPostRecipient {
  const rawRecipient = resolveRawRecipient(order);
  const recipientName = pickString(order.recipientName, rawRecipient?.name);
  const recipientAddress1 = pickString(order.recipientAddress1, rawRecipient?.address1);
  const recipientAddress2 = pickString(order.recipientAddress2, rawRecipient?.address2);
  const recipientPostalCode = pickString(order.recipientPostalCode, rawRecipient?.postalCode);
  const recipientCity = pickString(order.recipientCity, rawRecipient?.city);
  const recipientCountry = pickString(order.recipientCountry, rawRecipient?.country);
  const recipientCountryCode = pickString(order.recipientCountryCode, rawRecipient?.countryCode);
  const recipientPhone = pickString(order.recipientPhone, rawRecipient?.phone);
  const recipientEmail = pickString(order.recipientEmail, rawRecipient?.email, order.customerEmail);
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
    const baseStreet = recipientAddress1 ?? "";
    const extraStreet = recipientAddress2 ? String(recipientAddress2).trim() : "";
    const street = extraStreet && !baseStreet.includes(extraStreet)
      ? `${baseStreet}, ${extraStreet}`
      : baseStreet;
    return {
      name1: recipientName ?? "",
      firstName: null,
      name2: null,
      street,
      zip,
      city: recipientCity ?? "",
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
  const baseStreet = order.customerAddress1 ?? "";
  const extraStreet = order.customerAddress2 ? String(order.customerAddress2).trim() : "";
  const street = extraStreet && !baseStreet.includes(extraStreet)
    ? `${baseStreet}, ${extraStreet}`
    : baseStreet;
  return {
    name1: customerName ?? "",
    firstName: null,
    name2: null,
    street,
    zip,
    city: customerCity ?? "",
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
    "A6";
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
      (await (prisma as any).decathlonOrder.findUnique({ where: { id: orderId } })) ??
      (await (prisma as any).decathlonOrder.findUnique({ where: { orderId } }));
    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }
    if (scope === "partner" && partnerKey && order.partnerKey !== partnerKey) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }

    const body = (await request.json().catch(() => ({}))) as { trackingNumber?: string };
    const trackingNumber = String(body?.trackingNumber ?? "").trim() || String(order.orderId ?? "").trim();

    let recipient = buildRecipient(order);
    if (!isRecipientComplete(recipient)) {
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
    const document = await (prisma as any).decathlonOrderDocument.create({
      data: {
        orderId: order.id,
        type: DocumentType.LABEL,
        version: nextVersion,
        storageUrl: stored.storageUrl,
        checksum: null,
      },
    });

    const client = buildDecathlonOrdersClient();
    await client.setTracking(order.orderId, {
      carrier_code: "SWISSPOST",
      carrier_name: "Swiss Post",
      tracking_number: swissPostLabelId,
    });
    await client.shipOrder(order.orderId, {});

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

    return NextResponse.json({
      ok: true,
      documentId: document.id,
      labelUrl: stored.storageUrl,
      trackingNumber: swissPostLabelId,
      shipmentId: shipment.id,
    });
  } catch (error: any) {
    console.error("[DECATHLON][SHIP] Failed:", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Ship failed" }, { status: 500 });
  }
}
