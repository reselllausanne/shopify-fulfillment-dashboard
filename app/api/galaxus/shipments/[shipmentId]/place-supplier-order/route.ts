import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { createGoldenSupplierClient } from "@/galaxus/supplier/client";
import { resolveSupplierVariant } from "@/galaxus/supplier/orders";
import type { SupplierDropshipOrderItem, SupplierDropshipOrderRequest } from "@/galaxus/supplier/types";
import { GALAXUS_SUPPLIER_EMAIL, GALAXUS_SUPPLIER_PHONE } from "@/galaxus/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ shipmentId: string }> }
) {
  let supplierOrder: any | null = null;
  try {
    const { shipmentId } = await params;
    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: {
        order: { include: { lines: true } },
        items: true,
      },
    });

    if (!shipment || !shipment.order) {
      return NextResponse.json({ ok: false, error: "Shipment not found" }, { status: 404 });
    }

    const providerKey = (shipment.providerKey ?? "").toUpperCase();
    if (providerKey === "TRM") {
      return NextResponse.json({
        ok: true,
        status: "skipped",
        message: "TRM orders are disabled",
        boxId: shipment.id,
        sscc: shipment.packageId ?? null,
      });
    }
    if (providerKey && providerKey !== "GLD") {
      return NextResponse.json(
        { ok: false, error: "Partner boxes are assigned only", boxId: shipment.id },
        { status: 400 }
      );
    }

    const existing = await prisma.supplierOrder.findUnique({ where: { shipmentId: shipment.id } });
    if (existing && existing.status !== "ERROR" && !isPendingRef(existing.supplierOrderRef)) {
      return NextResponse.json({
        ok: true,
        status: "skipped",
        boxId: shipment.id,
        supplierOrderId: existing.supplierOrderRef,
        supplierOrderStatus: existing.status,
        trackingCount: resolveTrackingCount(existing),
        sscc: shipment.packageId ?? null,
        delrSentAt: shipment.delrSentAt ?? null,
      });
    }
    if (existing && existing.status === "CREATING") {
      return NextResponse.json({
        ok: true,
        status: "pending",
        boxId: shipment.id,
        supplierOrderId: existing.supplierOrderRef,
        supplierOrderStatus: existing.status,
        trackingCount: resolveTrackingCount(existing),
        sscc: shipment.packageId ?? null,
        delrSentAt: shipment.delrSentAt ?? null,
      });
    }

    const client = createGoldenSupplierClient();
    if (!client.createDropshipOrder) {
      return NextResponse.json(
        { ok: false, error: "Supplier client does not support order creation" },
        { status: 400 }
      );
    }

    supplierOrder = existing;
    if (!supplierOrder || supplierOrder.status === "ERROR") {
      const pendingRef = `pending-${shipment.id}`;
      try {
        supplierOrder = await prisma.supplierOrder.create({
          data: {
            supplierOrderRef: pendingRef,
            orderId: shipment.orderId ?? undefined,
            shipmentId: shipment.id,
            status: "CREATING",
            payloadJson: {
              supplierKey: "golden",
              shipmentId: shipment.id,
              createdAt: new Date().toISOString(),
            },
          },
        });
      } catch (error: any) {
        const existingLock = await prisma.supplierOrder.findUnique({
          where: { shipmentId: shipment.id },
        });
        if (existingLock) {
          return NextResponse.json({
            ok: true,
            status: "pending",
            boxId: shipment.id,
            supplierOrderId: existingLock.supplierOrderRef,
            supplierOrderStatus: existingLock.status,
            trackingCount: resolveTrackingCount(existingLock),
            sscc: shipment.packageId ?? null,
            delrSentAt: shipment.delrSentAt ?? null,
          });
        }
        throw error;
      }
    }

    const items = await buildSupplierItems({
      orderLines: shipment.order.lines,
      shipmentItems: shipment.items,
    });
    const deliveryAddress = buildDeliveryAddress(shipment.order);

    const request: SupplierDropshipOrderRequest = {
      deliveryAddress,
      clientProvidesShippingLabel: false,
      items,
    };
    const response = await client.createDropshipOrder(request);
    const supplierOrderRef = response.orderId;
    const safeResponse = { ...response, raw: undefined };

    await prisma.$transaction(async (tx) => {
      await tx.supplierOrder.update({
        where: { id: supplierOrder!.id },
        data: {
          supplierOrderRef,
          status: "CREATED",
          payloadJson: {
            request,
            response: safeResponse,
            supplierKey: "golden",
            shipmentId: shipment.id,
          },
        },
      });
      if (shipment.orderId) {
        await tx.orderStatusEvent.create({
          data: {
            orderId: shipment.orderId,
            source: "supplier",
            type: "SUPPLIER_ORDER_CREATED",
            payloadJson: {
              supplierOrderId: supplierOrderRef,
              supplierKey: "golden",
              shipmentId: shipment.id,
              response: safeResponse,
            },
          },
        });
      }
    });

    await prisma.shipment.update({
      where: { id: shipment.id },
      data: {
        supplierOrderRef,
        status: "PLACED",
      },
    });

    return NextResponse.json({
      ok: true,
      status: "created",
      boxId: shipment.id,
      supplierOrderId: supplierOrderRef,
      supplierOrderStatus: "CREATED",
      trackingCount: 0,
      sscc: shipment.packageId ?? null,
      delrSentAt: shipment.delrSentAt ?? null,
    });
  } catch (error: any) {
    if (supplierOrder?.id && supplierOrder?.status === "CREATING") {
      try {
        await prisma.supplierOrder.update({
          where: { id: supplierOrder.id },
          data: {
            status: "ERROR",
            payloadJson: {
              ...(supplierOrder.payloadJson ?? {}),
              error: error?.message ?? String(error),
            },
          },
        });
      } catch {
        // ignore
      }
    }
    console.error("[GALAXUS][SHIPMENT][PLACE] Failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to place supplier order" },
      { status: 500 }
    );
  }
}

async function buildSupplierItems(options: {
  orderLines: Array<import("@prisma/client").GalaxusOrderLine>;
  shipmentItems: Array<{ supplierPid: string; gtin14: string; buyerPid?: string | null; quantity: number }>;
}): Promise<SupplierDropshipOrderItem[]> {
  const items: SupplierDropshipOrderItem[] = [];
  for (const shipmentItem of options.shipmentItems) {
    const line =
      options.orderLines.find(
        (candidate) =>
          (shipmentItem.supplierPid && candidate.supplierPid === shipmentItem.supplierPid) ||
          (shipmentItem.buyerPid && candidate.buyerPid === shipmentItem.buyerPid)
      ) ??
      options.orderLines.find((candidate) => candidate.gtin === shipmentItem.gtin14) ??
      null;

    if (!line) {
      throw new Error(`Missing order line for shipment item ${shipmentItem.gtin14}`);
    }
    const supplierVariant = await resolveSupplierVariant(line);
    if (!supplierVariant) {
      throw new Error(`Missing supplier variant for line ${line.lineNumber}`);
    }

    const sizeId = parseGoldenSizeId(supplierVariant.supplierVariantId);
    if (sizeId) {
      items.push({ sizeId, quantity: shipmentItem.quantity });
      continue;
    }

    const sizeUs = supplierVariant.sizeRaw ?? line.size ?? null;
    const sku = supplierVariant.supplierSku ?? line.supplierSku ?? null;
    if (!sku || !sizeUs) {
      throw new Error(`Missing SKU/size for line ${line.lineNumber}`);
    }
    items.push({ sku, sizeUs, quantity: shipmentItem.quantity });
  }
  return items;
}

function buildDeliveryAddress(order: import("@prisma/client").GalaxusOrder) {
  const name = order.recipientName ?? order.customerName;
  const city = order.recipientCity ?? order.customerCity;
  const zipCode = order.recipientPostalCode ?? order.customerPostalCode;
  const street1 = order.recipientAddress1 ?? order.customerAddress1;
  const street2 = order.recipientAddress2 ?? order.customerAddress2 ?? "";
  const countryCode = normalizeCountryCode(null, order.recipientCountry ?? order.customerCountry);
  const phone = order.recipientPhone ?? GALAXUS_SUPPLIER_PHONE ?? "";
  const email = GALAXUS_SUPPLIER_EMAIL ?? "";

  return {
    name: requireField(name, "recipient name"),
    city: requireField(city, "city"),
    zipCode: requireField(zipCode, "postal code"),
    street: requireField([street1, street2].filter(Boolean).join(", "), "street"),
    countryCode: requireField(countryCode, "country code"),
    phone: requireField(phone, "phone"),
    email: requireField(email, "email"),
  };
}

function normalizeCountryCode(code: string | null | undefined, countryName?: string | null): string | null {
  if (code && code.trim()) return code.trim().toUpperCase();
  if (!countryName) return null;
  const normalized = countryName.trim().toLowerCase();
  if (["switzerland", "schweiz", "suisse"].includes(normalized)) return "CH";
  return null;
}

function requireField(value: string | null | undefined, label: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing ${label} for supplier order`);
  }
  return value.trim();
}

function parseGoldenSizeId(supplierVariantId: string): number | null {
  const [prefix, rawId] = supplierVariantId.split(":");
  if (prefix?.toLowerCase() !== "golden") return null;
  const parsed = Number.parseInt(rawId ?? "", 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function isPendingRef(value?: string | null) {
  if (!value) return false;
  return value.startsWith("pending-");
}

function resolveTrackingCount(order: { payloadJson?: any } | null) {
  if (!order) return 0;
  const payload = order.payloadJson ?? {};
  const trackingNumbers =
    (Array.isArray(payload.trackingNumbers) ? payload.trackingNumbers : null) ??
    (Array.isArray(payload.response?.trackingNumbers) ? payload.response.trackingNumbers : null) ??
    [];
  return trackingNumbers.length;
}
