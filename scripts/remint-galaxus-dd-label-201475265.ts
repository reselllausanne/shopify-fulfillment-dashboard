/**
 * One-shot: remint corrected Swiss Post label for Galaxus DD order 201475265
 * (FR street comma bug). Writes PDF under /tmp and stores a new Document version.
 *
 *   npx tsx scripts/remint-galaxus-dd-label-201475265.ts
 */
import "dotenv/config";
import fs from "node:fs/promises";
import { DocumentType } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { requestSwissPostLabel, normalizeSwissPostRecipientPhone } from "@/lib/swissPost";
import { buildSwissPostRecipientFromGalaxusOrder } from "@/lib/swissPostRecipient";
import { getStorageAdapter } from "@/galaxus/storage/storage";

const ORDER_REF = "201475265";

function getLabelFileExtension(format?: string) {
  const cleaned = String(format || "pdf").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (["pdf", "jpg", "jpeg", "png", "gif", "svg"].includes(cleaned)) return cleaned;
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
    labelEntry?.format || labelEntry?.type || labelEntry?.fileType || labelEntry?.imageFileType || "pdf";
  return { base64, extension: getLabelFileExtension(format) };
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
  return nested ? String(nested).trim() : null;
}

function buildPayload(order: any) {
  const language = process.env.SWISS_POST_LANGUAGE || "DE";
  const frankingLicense = process.env.SWISS_POST_FRANKING_LICENSE || "";
  const ppFranking = process.env.SWISS_POST_PP_FRANKING === "1";
  const imageResolution = Number(process.env.SWISS_POST_IMAGE_RESOLUTION || 300);
  const basePrzlValues = (process.env.SWISS_POST_PRZL || "ECO")
    .split(",")
    .map((v: string) => v.trim())
    .filter(Boolean);
  const przlValues = basePrzlValues.length ? basePrzlValues : ["ECO"];
  const recipient = buildSwissPostRecipientFromGalaxusOrder(order);
  // DB often stores CH mobiles as 4179… without leading +. Swiss Post wants +41… / 0…
  const rawPhone = String(recipient.phone ?? "").replace(/[^\d+]/g, "");
  let phone: string | null = normalizeSwissPostRecipientPhone(recipient.phone, recipient.country);
  if (!phone && /^41\d{8,12}$/.test(rawPhone)) phone = `+${rawPhone}`;
  if (!phone && rawPhone) phone = normalizeSwissPostRecipientPhone(`+${rawPhone.replace(/^\+/, "")}`, recipient.country);

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
    customer: {
      name1: process.env.SWISS_POST_CUSTOMER_NAME1 || "",
      name2: process.env.SWISS_POST_CUSTOMER_NAME2 || "",
      street: process.env.SWISS_POST_CUSTOMER_STREET || "",
      zip: process.env.SWISS_POST_CUSTOMER_ZIP || "",
      city: process.env.SWISS_POST_CUSTOMER_CITY || "",
      country: process.env.SWISS_POST_CUSTOMER_COUNTRY || "CH",
      domicilePostOffice: process.env.SWISS_POST_CUSTOMER_DOMICILE_PO || "",
      pobox: process.env.SWISS_POST_CUSTOMER_POBOX || "",
    },
    item: {
      itemID: `${order.galaxusOrderId}-remint-${Date.now()}`,
      recipient: {
        personallyAddressed: recipient.personallyAddressed,
        name1: recipient.name1,
        firstName: recipient.firstName,
        name2: recipient.name2,
        name3: recipient.name3,
        street: recipient.street,
        zip: recipient.zip,
        city: recipient.city,
        country: recipient.country,
        phone,
        email: recipient.email?.includes("noreply") ? null : recipient.email,
      },
      attributes: { przl: przlValues },
      notification: [],
    },
  };
}

async function main() {
  const order = await prisma.galaxusOrder.findFirst({ where: { galaxusOrderId: ORDER_REF } });
  if (!order) throw new Error(`Order ${ORDER_REF} not found`);

  const preview = buildSwissPostRecipientFromGalaxusOrder(order);
  console.log("[remint] recipient", JSON.stringify(preview));

  const payload = buildPayload(order);
  const swiss = await requestSwissPostLabel(payload);
  if (!swiss?.ok) {
    console.error("[remint] Swiss Post failed", JSON.stringify(swiss).slice(0, 2500));
    process.exit(1);
  }

  const tracking = extractSwissPostTracking(swiss.data);
  const label = extractLabelPayload(swiss.data);
  if (!label?.base64) {
    const item = Array.isArray(swiss.data?.item) ? swiss.data.item[0] : swiss.data?.item;
    console.error(
      "[remint] no label payload; dump",
      JSON.stringify(
        {
          dataKeys: swiss.data ? Object.keys(swiss.data) : null,
          itemKeys: item ? Object.keys(item) : null,
          label: item?.label,
          messages: swiss.data?.messages ?? swiss.data?.message ?? swiss.data?.errors,
          rawSlice: JSON.stringify(swiss.data).slice(0, 2500),
        },
        null,
        2
      )
    );
    process.exit(1);
  }
  console.log("[remint] tracking", tracking);

  const buf = Buffer.from(label.base64, "base64");
  const localPath = `/tmp/galaxus-${ORDER_REF}-corrected-label.${label.extension}`;
  await fs.writeFile(localPath, buf);
  console.log("[remint] wrote", localPath, buf.length, "bytes");

  const shipment = await prisma.shipment.findFirst({
    where: { orderId: order.id },
    orderBy: { createdAt: "desc" },
  });
  if (!shipment) throw new Error("No shipment");

  const existing = await prisma.document.findFirst({
    where: {
      shipmentId: shipment.id,
      type: DocumentType.LABEL,
      storageUrl: { contains: "shipping-labels" },
    },
    orderBy: { version: "desc" },
  });
  const nextVersion = (existing?.version ?? 0) + 1;
  const key = `galaxus/${order.galaxusOrderId}/shipping-labels/${shipment.id}/v${nextVersion}.${label.extension}`;
  const stored = await getStorageAdapter().uploadPdf(key, buf);
  const doc = await prisma.document.create({
    data: {
      orderId: order.id,
      shipmentId: shipment.id,
      type: DocumentType.LABEL,
      version: nextVersion,
      storageUrl: stored.storageUrl,
      checksum: null,
    },
  });

  await prisma.shipment.update({
    where: { id: shipment.id },
    data: {
      trackingNumber: tracking ?? shipment.trackingNumber,
      carrierFinal: "swisspost",
      carrierRaw: "swisspost",
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        orderRef: ORDER_REF,
        oldTracking: shipment.trackingNumber,
        newTracking: tracking,
        documentId: doc.id,
        documentUrl: `/api/galaxus/documents/${doc.id}`,
        storageUrl: stored.storageUrl,
        localPath,
        recipient: preview,
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
