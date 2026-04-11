import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import { uploadDelrForShipment } from "@/galaxus/warehouse/delr";
import { generateSsccLabelPdf } from "@/galaxus/labels/ssccLabel";
import { getStorageAdapter } from "@/galaxus/storage/storage";
import { requestSwissPostLabel } from "@/lib/swissPost";
import { DocumentType } from "@prisma/client";

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
    identifier: item.itemID || item.identCode || response?.itemId || "label",
  };
}

function buildRecipient(order: any) {
  const hasRecipient =
    Boolean(order?.recipientName) ||
    Boolean(order?.recipientAddress1) ||
    Boolean(order?.recipientPostalCode) ||
    Boolean(order?.recipientCity) ||
    Boolean(order?.recipientCountry);
  if (hasRecipient) {
    return {
      name1: order.recipientName ?? order.customerName ?? "",
      firstName: null,
      name2: null,
      street: order.recipientAddress1 ?? "",
      zip: order.recipientPostalCode ?? "",
      city: order.recipientCity ?? "",
      country: order.recipientCountryCode ?? order.recipientCountry ?? "CH",
      phone: order.recipientPhone ?? null,
      email: order.recipientEmail ?? order.customerEmail ?? null,
    };
  }
  return {
    name1: order.customerName ?? "",
    firstName: null,
    name2: null,
    street: order.customerAddress1 ?? "",
    zip: order.customerPostalCode ?? "",
    city: order.customerCity ?? "",
    country: order.customerCountryCode ?? order.customerCountry ?? "CH",
    phone: null,
    email: order.customerEmail ?? null,
  };
}

function buildSwissPostPayload(order: any, trackingNumber: string) {
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

  const recipient = buildRecipient(order);
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
      itemID: `${order?.galaxusOrderId || trackingNumber}-${Date.now()}-${Math.floor(
        Math.random() * 1000
      )}`,
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
  req: NextRequest,
  { params }: { params: Promise<{ shipmentId: string }> }
) {
  try {
    const session = await getPartnerSession(req);
    if (!session) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { shipmentId } = await params;
    const body = await req.json().catch(() => ({}));
    const trackingNumber = body?.trackingNumber ? String(body.trackingNumber).trim() : "";
    const carrier = body?.carrier ? String(body.carrier).trim() : "";
    const forceLabels = Boolean(body?.forceLabels);
    const forceDelr = Boolean(body?.forceDelr);

    if (!shipmentId || !trackingNumber) {
      return NextResponse.json(
        { ok: false, error: "shipmentId and trackingNumber are required" },
        { status: 400 }
      );
    }

    const providerKey = normalizeProviderKey(session.partnerKey);
    if (!providerKey) {
      return NextResponse.json({ ok: false, error: "Invalid partner key" }, { status: 400 });
    }

    const shipment = await (prisma as any).shipment.findFirst({
      where: { id: shipmentId, providerKey },
      include: { order: true },
    });
    if (!shipment || !shipment.order) {
      return NextResponse.json({ ok: false, error: "Shipment not found" }, { status: 404 });
    }

    await (prisma as any).shipment.update({
      where: { id: shipmentId },
      data: {
        trackingNumber,
        carrierFinal: carrier || shipment.carrierFinal || null,
        carrierRaw: carrier || shipment.carrierRaw || null,
        shippedAt: new Date(),
        status: "FULFILLED",
      },
    });

    const delr = await uploadDelrForShipment(shipmentId, { force: forceDelr });
    if (delr.status === "error") {
      return NextResponse.json({ ok: false, error: delr.message ?? "DELR upload failed", delr }, { status: 409 });
    }

    let ssccLabel: { labelPdfUrl?: string | null; labelZpl?: string | null } | null = null;
    if (shipment.packageId && (forceLabels || !shipment.labelPdfUrl)) {
      const label = await generateSsccLabelPdf(shipment.order, shipment.packageId, {
        shipmentId: shipment.dispatchNotificationId ?? shipment.shipmentId ?? shipment.order.galaxusOrderId,
        orderNumbers: [shipment.order.orderNumber ?? shipment.order.galaxusOrderId].filter(Boolean),
      });
      const storage = getStorageAdapter();
      const key = `galaxus/${shipment.order.galaxusOrderId}/shipments/${shipment.id}/sscc-label.pdf`;
      const stored = await storage.uploadPdf(key, label.pdf);
      const updated = await prisma.shipment.update({
        where: { id: shipmentId },
        data: {
          labelZpl: label.zpl,
          labelPdfUrl: stored.storageUrl,
          labelGeneratedAt: new Date(),
        } as unknown as Record<string, unknown>,
      });
      ssccLabel = { labelPdfUrl: updated.labelPdfUrl, labelZpl: updated.labelZpl };
    }

    let shippingLabelUrl: string | null = null;
    const existingShipping = await prisma.document.findFirst({
      where: {
        shipmentId,
        type: DocumentType.LABEL,
        storageUrl: { contains: "shipping-labels" },
      },
      orderBy: { createdAt: "desc" },
    });
    if (existingShipping && !forceLabels) {
      shippingLabelUrl = `/api/galaxus/documents/${existingShipping.id}`;
    } else {
      const payload = buildSwissPostPayload(shipment.order, trackingNumber);
      const swissRes = await requestSwissPostLabel(payload);
      if (!swissRes.ok) {
        return NextResponse.json(
          { ok: false, error: "Swiss Post label generation failed", swissPost: swissRes.data },
          { status: 502 }
        );
      }
      const labelPayload = extractLabelPayload(swissRes.data);
      if (!labelPayload?.base64) {
        return NextResponse.json(
          { ok: false, error: "Swiss Post label missing content" },
          { status: 502 }
        );
      }
      const buffer = Buffer.from(labelPayload.base64, "base64");
      const storage = getStorageAdapter();
      const existingDocs = await prisma.document.findMany({
        where: { shipmentId, type: DocumentType.LABEL },
        orderBy: { version: "desc" },
        take: 1,
      });
      const nextVersion = existingDocs[0]?.version ? existingDocs[0].version + 1 : 1;
      const key = `galaxus/${shipment.order.galaxusOrderId}/shipping-labels/${shipment.id}/v${nextVersion}.${labelPayload.extension}`;
      const stored = await storage.uploadPdf(key, buffer);
      const document = await prisma.document.create({
        data: {
          orderId: shipment.orderId,
          shipmentId,
          type: DocumentType.LABEL,
          version: nextVersion,
          storageUrl: stored.storageUrl,
          checksum: null,
        },
      });
      shippingLabelUrl = `/api/galaxus/documents/${document.id}`;
    }

    await (prisma as any).partnerOrder.updateMany({
      where: { partnerId: session.partnerId, galaxusOrderId: shipment.order.galaxusOrderId },
      data: { status: "FULFILLED", confirmedAt: new Date(), trackingNumber },
    });

    return NextResponse.json({
      ok: true,
      shipmentId,
      delr,
      ssccLabel,
      shippingLabelUrl,
    });
  } catch (error: any) {
    console.error("[PARTNER][SHIPMENT][FULFILL] Failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
