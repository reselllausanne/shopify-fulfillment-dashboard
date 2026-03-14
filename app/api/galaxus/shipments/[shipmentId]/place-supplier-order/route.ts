import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { createGoldenSupplierClient } from "@/galaxus/supplier/client";
import { resolveSupplierVariant } from "@/galaxus/supplier/orders";
import type { SupplierDropshipOrderItem, SupplierDropshipOrderRequest } from "@/galaxus/supplier/types";
import { GALAXUS_SUPPLIER_EMAIL, GALAXUS_SUPPLIER_PHONE } from "@/galaxus/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ shipmentId: string }> }
) {
  let supplierOrder: any | null = null;
  try {
    const url = new URL(request.url);
    const onlyAvailable = url.searchParams.get("onlyAvailable") === "1";

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
    if (providerKey === "STX") {
      return NextResponse.json({
        ok: true,
        status: "skipped",
        message: "StockX orders are manual. Use Sync StockX orders.",
        boxId: shipment.id,
        sscc: shipment.packageId ?? null,
      });
    }
    if (providerKey && providerKey !== "GLD") {
      const prismaAny = prisma as any;
      const partner = await prismaAny.partner.findFirst({
        where: { key: { equals: providerKey, mode: "insensitive" } },
      });
      if (!partner) {
        return NextResponse.json(
          { ok: false, error: "Partner not found for providerKey", boxId: shipment.id },
          { status: 404 }
        );
      }
      const order = shipment.order;
      const partnerOrder = await prismaAny.partnerOrder.upsert({
        where: {
          partnerId_galaxusOrderId: {
            partnerId: partner.id,
            galaxusOrderId: order.galaxusOrderId,
          },
        },
        create: {
          partnerId: partner.id,
          galaxusOrderId: order.galaxusOrderId,
          status: "ASSIGNED",
          sentAt: new Date(),
        },
        update: {
          status: "ASSIGNED",
          sentAt: new Date(),
        },
      });

      const gtins = order.lines
        .map((line) => line.gtin)
        .filter((value): value is string => Boolean(value));
      const prefix = `${partner.key.toLowerCase()}:`;
      const mappings = await prismaAny.variantMapping.findMany({
        where: {
          gtin: { in: gtins },
          supplierVariantId: { startsWith: prefix },
        },
        include: { supplierVariant: true },
      });
      const supplierVariantByGtin = new Map<string, any>();
      for (const mapping of mappings) {
        const gtin = String(mapping.gtin ?? "");
        if (!gtin) continue;
        const candidate = mapping.supplierVariant;
        if (!candidate) continue;
        const existing = supplierVariantByGtin.get(gtin);
        if (!existing || Number(candidate.stock ?? 0) > Number(existing.stock ?? 0)) {
          supplierVariantByGtin.set(gtin, candidate);
        }
      }

      await prismaAny.partnerOrderLine.deleteMany({
        where: { partnerOrderId: partnerOrder.id },
      });

      const partnerVariantCache = new Map<string, string>();
      const ensurePartnerVariant = async (candidate: any, fallbackGtin: string | null) => {
        const supplierVariantId = String(candidate?.supplierVariantId ?? "");
        if (!supplierVariantId) return null;
        const cached = partnerVariantCache.get(supplierVariantId);
        if (cached) return cached;
        const res = await prismaAny.partnerVariant.upsert({
          where: {
            partnerId_partnerVariantId: {
              partnerId: partner.id,
              partnerVariantId: supplierVariantId,
            },
          },
          create: {
            partnerId: partner.id,
            partnerVariantId: supplierVariantId,
            externalSku: candidate?.supplierSku ?? null,
            sizeRaw: candidate?.sizeRaw ?? null,
            price: candidate?.price ?? null,
            stock: candidate?.stock ?? null,
            images: candidate?.images ?? null,
            productName: candidate?.supplierProductName ?? null,
            brand: candidate?.supplierBrand ?? null,
            gtin: candidate?.gtin ?? fallbackGtin ?? null,
            lastSyncAt: new Date(),
          },
          update: {
            externalSku: candidate?.supplierSku ?? undefined,
            sizeRaw: candidate?.sizeRaw ?? undefined,
            price: candidate?.price ?? undefined,
            stock: candidate?.stock ?? undefined,
            images: candidate?.images ?? undefined,
            productName: candidate?.supplierProductName ?? undefined,
            brand: candidate?.supplierBrand ?? undefined,
            gtin: candidate?.gtin ?? fallbackGtin ?? undefined,
            lastSyncAt: new Date(),
          },
        });
        const id = String(res.id);
        partnerVariantCache.set(supplierVariantId, id);
        return id;
      };

      const lineRows: Array<{
        partnerOrderId: string;
        partnerVariantId: string | null;
        gtin: string | null;
        quantity: number;
      }> = [];
      for (const line of order.lines) {
        const gtin = line.gtin ? String(line.gtin) : null;
        let partnerVariantId: string | null = null;
        if (gtin) {
          const matched = supplierVariantByGtin.get(gtin);
          if (matched) {
            partnerVariantId = await ensurePartnerVariant(matched, gtin);
          }
        }
        lineRows.push({
          partnerOrderId: partnerOrder.id,
          partnerVariantId,
          gtin,
          quantity: line.quantity ?? 1,
        });
      }

      await prismaAny.partnerOrderLine.createMany({ data: lineRows });

      await prisma.shipment.update({
        where: { id: shipment.id },
        data: {
          status: "ASSIGNED",
        },
      });

      return NextResponse.json({
        ok: true,
        status: "assigned",
        boxId: shipment.id,
        partnerOrderId: partnerOrder.id,
        partnerKey: partner.key,
      });
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
        supplierOrderError: (existing as any)?.payloadJson?.error ?? null,
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
        supplierOrderError: (existing as any)?.payloadJson?.error ?? null,
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

    const pendingRef = `pending-${shipment.id}`;
    if (!existing) {
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
            onlyAvailable,
          },
        },
      });
    } else {
      const existingPayload =
        existing.payloadJson && typeof existing.payloadJson === "object"
          ? (existing.payloadJson as any)
          : {};
      supplierOrder = await prisma.supplierOrder.update({
        where: { id: existing.id },
        data: {
          status: "CREATING",
          payloadJson: {
            ...existingPayload,
            supplierKey: "golden",
            shipmentId: shipment.id,
            retryAt: new Date().toISOString(),
            onlyAvailable,
            error: null,
          },
        },
      });
    }

    const { items, skipped } = await buildSupplierItems({
      orderLines: shipment.order.lines,
      shipmentItems: shipment.items,
      onlyAvailable,
    });
    if (onlyAvailable && items.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "No in-stock items available to order for this shipment",
          boxId: shipment.id,
          skipped,
        },
        { status: 409 }
      );
    }
    const deliveryAddress = buildDeliveryAddress(shipment.order);

    const dropshipRequest: SupplierDropshipOrderRequest = {
      deliveryAddress,
      clientProvidesShippingLabel: false,
      items,
    };
    const response = await client.createDropshipOrder(dropshipRequest);
    const supplierOrderRef = response.orderId;
    const safeResponse = { ...response, raw: undefined };

    await prisma.$transaction(async (tx) => {
      await tx.supplierOrder.update({
        where: { id: supplierOrder!.id },
        data: {
          supplierOrderRef,
          status: "CREATED",
          payloadJson: {
            request: dropshipRequest,
            response: safeResponse,
            supplierKey: "golden",
            shipmentId: shipment.id,
            onlyAvailable,
            skipped,
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
      skipped,
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
  onlyAvailable: boolean;
}): Promise<{
  items: SupplierDropshipOrderItem[];
  skipped: Array<{
    lineNumber: number | null;
    gtin: string | null;
    supplierVariantId: string | null;
    supplierSku: string | null;
    sizeRaw: string | null;
    requestedQty: number;
    stock: number | null;
    reason: "NO_VARIANT" | "OUT_OF_STOCK";
  }>;
}> {
  const items: SupplierDropshipOrderItem[] = [];
  const skipped: Array<{
    lineNumber: number | null;
    gtin: string | null;
    supplierVariantId: string | null;
    supplierSku: string | null;
    sizeRaw: string | null;
    requestedQty: number;
    stock: number | null;
    reason: "NO_VARIANT" | "OUT_OF_STOCK";
  }> = [];
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
      if (options.onlyAvailable) {
        skipped.push({
          lineNumber: line.lineNumber ?? null,
          gtin: line.gtin ? String(line.gtin) : null,
          supplierVariantId: null,
          supplierSku: line.supplierSku ?? null,
          sizeRaw: line.size ?? null,
          requestedQty: shipmentItem.quantity,
          stock: null,
          reason: "NO_VARIANT",
        });
        continue;
      }
      throw new Error(`Missing supplier variant for line ${line.lineNumber}`);
    }

    const stockValue = supplierVariant.stock === null || supplierVariant.stock === undefined
      ? null
      : Number(supplierVariant.stock);
    const available = stockValue === null ? true : stockValue >= shipmentItem.quantity;
    if (options.onlyAvailable && !available) {
      skipped.push({
        lineNumber: line.lineNumber ?? null,
        gtin: line.gtin ? String(line.gtin) : null,
        supplierVariantId: supplierVariant.supplierVariantId ?? null,
        supplierSku: supplierVariant.supplierSku ?? line.supplierSku ?? null,
        sizeRaw: supplierVariant.sizeRaw ?? line.size ?? null,
        requestedQty: shipmentItem.quantity,
        stock: Number.isFinite(stockValue) ? stockValue : null,
        reason: "OUT_OF_STOCK",
      });
      continue;
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
  return { items, skipped };
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
