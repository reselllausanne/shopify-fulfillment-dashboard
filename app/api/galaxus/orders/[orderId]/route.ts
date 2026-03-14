import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getShipmentPlacementByOrder } from "@/app/api/galaxus/shipments/_utils";
import { getStxLinkStatusForOrder } from "@/galaxus/stx/purchaseUnits";
import { parseOrderFromXml } from "@/galaxus/edi/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;
    const order =
      (await prisma.galaxusOrder.findUnique({
        where: { id: orderId },
        include: {
          lines: true,
          shipments: {
            include: {
              items: true,
              documents: true,
            },
          },
          statusEvents: true,
          ediFiles: true,
        },
      })) ??
      (await prisma.galaxusOrder.findUnique({
        where: { galaxusOrderId: orderId },
        include: {
          lines: true,
          shipments: {
            include: {
              items: true,
              documents: true,
            },
          },
          statusEvents: true,
          ediFiles: true,
        },
      }));

    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }

    const placement = await getShipmentPlacementByOrder(order.id);
    const stx = await getStxLinkStatusForOrder(order.galaxusOrderId).catch(() => null);
    const gtins = Array.from(
      new Set(
        order.lines
          .map((line: any) => String(line.gtin ?? "").trim())
          .filter((gtin: string) => gtin.length > 0)
      )
    );
    const skuByGtin: Record<string, string> = {};
    const sizeByGtin: Record<string, string> = {};
    const productNameByGtin: Record<string, string> = {};
    if (gtins.length > 0) {
      const mappings = await (prisma as any).variantMapping.findMany({
        where: { gtin: { in: gtins } },
        include: { supplierVariant: true, kickdbVariant: { include: { product: true } } },
        orderBy: { updatedAt: "desc" },
      });
      const supplierKeyFromPid = (pid?: string | null): string | null => {
        const raw = String(pid ?? "").trim();
        if (!raw) return null;
        const prefix = raw.includes(":") ? raw.split(":")[0] : raw.includes("_") ? raw.split("_")[0] : raw;
        return prefix ? prefix.trim().toLowerCase() : null;
      };
      const mappingKey = (m: any): string | null => {
        const raw = String(m?.supplierVariantId ?? m?.supplierVariant?.supplierVariantId ?? "").trim();
        if (!raw) return null;
        const prefix = raw.includes(":") ? raw.split(":")[0] : raw.includes("_") ? raw.split("_")[0] : raw;
        return prefix ? prefix.trim().toLowerCase() : null;
      };
      const preferredKeyByGtin = new Map<string, string>();
      for (const line of order.lines as any[]) {
        const gtin = String(line?.gtin ?? "").trim();
        if (!gtin) continue;
        const key = supplierKeyFromPid(line?.supplierPid ?? null);
        if (key && !preferredKeyByGtin.has(gtin)) preferredKeyByGtin.set(gtin, key);
      }
      for (const mapping of mappings) {
        const gtin = String(mapping?.gtin ?? "").trim();
        if (!gtin) continue;
        const preferredKey = preferredKeyByGtin.get(gtin) ?? null;
        const key = mappingKey(mapping);
        // If we know the line belongs to TRM/GLD/STX, prefer mappings from that same supplier.
        if (preferredKey && key && preferredKey !== key) {
          continue;
        }
        if (!skuByGtin[gtin]) {
          const sku = String(mapping?.supplierVariant?.supplierSku ?? "").trim();
          if (sku) skuByGtin[gtin] = sku;
        }
        if (!sizeByGtin[gtin]) {
          const size = String(mapping?.supplierVariant?.sizeRaw ?? "").trim();
          if (size) sizeByGtin[gtin] = size;
        }
        if (!productNameByGtin[gtin]) {
          const supplierName = String(mapping?.supplierVariant?.supplierProductName ?? "").trim();
          if (supplierName) {
            productNameByGtin[gtin] = supplierName;
            continue;
          }
          const kickdbName = String(mapping?.kickdbVariant?.product?.name ?? "").trim();
          if (kickdbName) productNameByGtin[gtin] = kickdbName;
        }
      }
    }
    const normalized = {
      ...order,
      stx,
      skuByGtin,
      sizeByGtin,
      productNameByGtin,
      shipments: order.shipments.map((shipment: any) => {
        const deliveryNote = shipment.documents?.find((doc: any) => doc.type === "DELIVERY_NOTE");
        const labelDocs = (shipment.documents ?? []).filter((doc: any) => doc.type === "LABEL");
        const ssccLabelDoc = labelDocs.find(
          (doc: any) => typeof doc.storageUrl === "string" && !doc.storageUrl.includes("shipping-labels")
        );
        const shippingLabelDoc = labelDocs.find(
          (doc: any) => typeof doc.storageUrl === "string" && doc.storageUrl.includes("shipping-labels")
        );
        const extra = placement.get(shipment.id);
        return {
          ...shipment,
          supplierOrderRef: extra?.supplierOrderRef ?? null,
          boxStatus: extra?.status ?? null,
          deliveryNotePdfUrl: deliveryNote ? `/api/galaxus/documents/${deliveryNote.id}` : null,
          labelPdfUrl: ssccLabelDoc
            ? `/api/galaxus/documents/${ssccLabelDoc.id}`
            : shipment.labelPdfUrl
              ? `/api/galaxus/shipments/${shipment.id}/label`
              : null,
          shippingLabelPdfUrl: shippingLabelDoc ? `/api/galaxus/documents/${shippingLabelDoc.id}` : null,
        };
      }),
    };

    return NextResponse.json({ ok: true, order: normalized });
  } catch (error: any) {
    console.error("[GALAXUS][ORDERS] Detail failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;
    const body = (await request.json().catch(() => ({}))) as { action?: string };
    const action = String(body?.action ?? "").trim().toLowerCase();
    if (action !== "repair_parties") {
      return NextResponse.json({ ok: false, error: "Unsupported action" }, { status: 400 });
    }

    const order =
      (await prisma.galaxusOrder.findUnique({ where: { id: orderId } })) ??
      (await prisma.galaxusOrder.findUnique({ where: { galaxusOrderId: orderId } }));
    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }

    const edi = await (prisma as any).galaxusEdiFile.findFirst({
      where: {
        direction: "IN",
        docType: "ORDP",
        OR: [{ orderRef: order.galaxusOrderId }, { filename: { contains: order.galaxusOrderId } }],
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, filename: true, payloadJson: true, createdAt: true },
    });
    const rawXml = edi?.payloadJson?.rawXml ?? null;
    if (!rawXml || typeof rawXml !== "string") {
      return NextResponse.json(
        { ok: false, error: "No stored ORDP rawXml found to repair from." },
        { status: 409 }
      );
    }

    const parsed = parseOrderFromXml(rawXml, order.galaxusOrderId);
    const updated = await prisma.galaxusOrder.update({
      where: { id: order.id },
      data: {
        customerName: parsed.customerName ?? null,
        customerAddress1: parsed.customerAddress1 ?? null,
        customerAddress2: parsed.customerAddress2 ?? null,
        customerPostalCode: parsed.customerPostalCode ?? null,
        customerCity: parsed.customerCity ?? null,
        customerCountry: parsed.customerCountry ?? null,
        customerCountryCode: (parsed as any).customerCountryCode ?? null,
        customerEmail: (parsed as any).customerEmail ?? null,
        customerVatId: parsed.customerVatId ?? null,
        recipientName: parsed.recipientName ?? null,
        recipientAddress1: parsed.recipientAddress1 ?? null,
        recipientAddress2: parsed.recipientAddress2 ?? null,
        recipientPostalCode: parsed.recipientPostalCode ?? null,
        recipientCity: parsed.recipientCity ?? null,
        recipientCountry: parsed.recipientCountry ?? null,
        recipientCountryCode: (parsed as any).recipientCountryCode ?? null,
        recipientEmail: (parsed as any).recipientEmail ?? null,
        recipientPhone: (parsed as any).recipientPhone ?? null,
        deliveryPartyId: (parsed as any).deliveryPartyId ?? null,
      } as any,
    });

    return NextResponse.json({
      ok: true,
      repairedFrom: { ediFileId: edi.id, filename: edi.filename, createdAt: edi.createdAt },
      parsed: {
        customer: {
          name: parsed.customerName ?? null,
          address1: parsed.customerAddress1 ?? null,
          address2: parsed.customerAddress2 ?? null,
          postalCode: parsed.customerPostalCode ?? null,
          city: parsed.customerCity ?? null,
          country: parsed.customerCountry ?? null,
          countryCode: (parsed as any).customerCountryCode ?? null,
        },
        recipient: {
          name: parsed.recipientName ?? null,
          address1: parsed.recipientAddress1 ?? null,
          address2: parsed.recipientAddress2 ?? null,
          postalCode: parsed.recipientPostalCode ?? null,
          city: parsed.recipientCity ?? null,
          country: parsed.recipientCountry ?? null,
          countryCode: (parsed as any).recipientCountryCode ?? null,
        },
      },
      saved: {
        customer: {
          name: updated.customerName ?? null,
          address1: updated.customerAddress1 ?? null,
          address2: updated.customerAddress2 ?? null,
          postalCode: updated.customerPostalCode ?? null,
          city: updated.customerCity ?? null,
          country: updated.customerCountry ?? null,
          countryCode: (updated as any).customerCountryCode ?? null,
        },
        recipient: {
          name: updated.recipientName ?? null,
          address1: updated.recipientAddress1 ?? null,
          address2: updated.recipientAddress2 ?? null,
          postalCode: updated.recipientPostalCode ?? null,
          city: updated.recipientCity ?? null,
          country: updated.recipientCountry ?? null,
          countryCode: (updated as any).recipientCountryCode ?? null,
        },
      },
    });
  } catch (error: any) {
    console.error("[GALAXUS][ORDERS] Repair failed:", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Repair failed" }, { status: 500 });
  }
}
