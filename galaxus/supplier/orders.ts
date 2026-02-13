import "server-only";

import type { GalaxusOrder, GalaxusOrderLine, SupplierVariant } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { createGoldenSupplierClient } from "./client";
import type { SupplierDropshipOrderItem, SupplierDropshipOrderRequest } from "./types";
import {
  GALAXUS_SUPPLIER_AUTO_ORDER,
  GALAXUS_SUPPLIER_DEFAULT_ETA_WINDOW_DAYS,
  GALAXUS_SUPPLIER_DEFAULT_LEAD_DAYS,
  GALAXUS_SUPPLIER_EMAIL,
  GALAXUS_SUPPLIER_PHONE,
} from "@/galaxus/config";

type SupplierOrderPlacementResult = {
  status: "created" | "skipped" | "error";
  supplierOrderId?: string;
  ordrMode?: "WITH_ARRIVAL_DATES" | "WITHOUT_POSITIONS";
  message?: string;
};

type ResolvedLine = {
  line: GalaxusOrderLine;
  supplierVariant: SupplierVariant;
  item: SupplierDropshipOrderItem;
  leadDays: number;
  supplierKey: string;
};

type SplitItem = {
  line: GalaxusOrderLine;
  supplierVariant: SupplierVariant;
  item: SupplierDropshipOrderItem;
};

type SupplierBatch = {
  supplierKey: string;
  items: SplitItem[];
};

export async function placeSupplierOrderForGalaxusOrder(orderId: string): Promise<SupplierOrderPlacementResult> {
  if (!GALAXUS_SUPPLIER_AUTO_ORDER) {
    return { status: "skipped", message: "auto order disabled" };
  }

  const order = await prisma.galaxusOrder.findUnique({
    where: { id: orderId },
    include: { lines: true, supplierOrders: true },
  });
  if (!order) {
    return { status: "error", message: `Order not found: ${orderId}` };
  }
  if (order.supplierOrders.length > 0) {
    return { status: "skipped", message: "supplier order exists" };
  }

  try {
    const resolvedLines = await resolveLines(order.lines);
    const deliveryAddress = buildDeliveryAddress(order);
    const batches = splitBySupplierAndMaxPairs(resolvedLines, 12);
    const { lineUpdates, ordrMode } = buildArrivalUpdates(resolvedLines);

    let lastOrderId: string | undefined;
    for (let index = 0; index < batches.length; index += 1) {
      const batch = batches[index];
      const client = resolveSupplierClient(batch.supplierKey);
      if (!client.createDropshipOrder) {
        throw new Error(`Supplier client does not support order creation: ${batch.supplierKey}`);
      }

      const request: SupplierDropshipOrderRequest = {
        deliveryAddress,
        clientProvidesShippingLabel: false,
        items: batch.items.map((item) => item.item),
      };

      const response = await client.createDropshipOrder(request);
      const supplierOrderId = response.orderId;
      lastOrderId = supplierOrderId;

      await prisma.$transaction(async (tx) => {
        const safeResponse = { ...response, raw: undefined };
        await tx.supplierOrder.create({
          data: {
            supplierOrderRef: supplierOrderId,
            orderId: order.id,
            status: "CREATED",
            payloadJson: {
              request,
              response: safeResponse,
              supplierKey: batch.supplierKey,
              batchIndex: index + 1,
              batchSize: batch.items.reduce((sum, item) => sum + item.item.quantity, 0),
            },
          },
        });
        for (const update of lineUpdates) {
          await tx.galaxusOrderLine.update({
            where: { id: update.id },
            data: update.data,
          });
        }

        await tx.orderStatusEvent.create({
          data: {
            orderId: order.id,
            source: "supplier",
            type: "SUPPLIER_ORDER_CREATED",
            payloadJson: {
              supplierOrderId,
              supplierKey: batch.supplierKey,
              response: safeResponse,
            },
          },
        });
      });
    }

    return { status: "created", supplierOrderId: lastOrderId, ordrMode };
  } catch (error: any) {
    await prisma.orderStatusEvent.create({
      data: {
        orderId: order.id,
        source: "supplier",
        type: "SUPPLIER_ORDER_FAILED",
        payloadJson: { message: error?.message ?? String(error) },
      },
    });
    return { status: "error", message: error?.message ?? "Failed to create supplier order" };
  }
}

async function resolveLines(lines: GalaxusOrderLine[]): Promise<ResolvedLine[]> {
  const resolved: ResolvedLine[] = [];
  for (const line of lines) {
    const supplierVariant = await resolveSupplierVariant(line);
    if (!supplierVariant) {
      throw new Error(`Missing supplier variant mapping for line ${line.lineNumber}`);
    }
    const supplierKey = resolveSupplierKey(supplierVariant.supplierVariantId);

    const sizeId = parseGoldenSizeId(supplierVariant.supplierVariantId);
    if (sizeId) {
      resolved.push({
        line,
        supplierVariant,
        item: { sizeId, quantity: line.quantity },
        leadDays: supplierVariant.leadTimeDays ?? GALAXUS_SUPPLIER_DEFAULT_LEAD_DAYS,
        supplierKey,
      });
      continue;
    }

    const sizeUs = supplierVariant.sizeRaw ?? line.size ?? null;
    if (!supplierVariant.supplierSku || !sizeUs) {
      throw new Error(`Missing SKU/size for line ${line.lineNumber}`);
    }
    resolved.push({
      line,
      supplierVariant,
      item: { sku: supplierVariant.supplierSku, sizeUs, quantity: line.quantity },
      leadDays: supplierVariant.leadTimeDays ?? GALAXUS_SUPPLIER_DEFAULT_LEAD_DAYS,
      supplierKey,
    });
  }
  return resolved;
}

function resolveSupplierClient(supplierKey: string) {
  if (supplierKey === "golden") {
    return createGoldenSupplierClient();
  }
  throw new Error(`Unsupported supplier: ${supplierKey}`);
}

function resolveSupplierKey(supplierVariantId: string | null | undefined): string {
  if (!supplierVariantId) return "unknown";
  const [key] = supplierVariantId.split(":");
  return key || "unknown";
}

function splitBySupplierAndMaxPairs(lines: ResolvedLine[], maxPairs: number): SupplierBatch[] {
  const bySupplier = new Map<string, ResolvedLine[]>();
  for (const line of lines) {
    const key = line.supplierKey || "unknown";
    const group = bySupplier.get(key) ?? [];
    group.push(line);
    bySupplier.set(key, group);
  }

  const batches: SupplierBatch[] = [];
  for (const [supplierKey, group] of bySupplier.entries()) {
    let current: SupplierBatch | null = null;
    let currentQty = 0;
    for (const entry of group) {
      let remaining = entry.item.quantity;
      while (remaining > 0) {
        if (!current || currentQty >= maxPairs) {
          current = { supplierKey, items: [] };
          batches.push(current);
          currentQty = 0;
        }
        const capacity = maxPairs - currentQty;
        const quantity = Math.min(remaining, capacity);
        current.items.push({
          line: entry.line,
          supplierVariant: entry.supplierVariant,
          item: { ...entry.item, quantity },
        });
        currentQty += quantity;
        remaining -= quantity;
      }
    }
  }

  return batches;
}

async function resolveSupplierVariant(line: GalaxusOrderLine): Promise<SupplierVariant | null> {
  if (line.supplierVariantId) {
    const variant = await prisma.supplierVariant.findUnique({
      where: { supplierVariantId: line.supplierVariantId },
    });
    if (variant) return variant;
  }

  const providerKey = line.providerKey ?? null;
  if (providerKey) {
    const mapping = await prisma.variantMapping.findFirst({
      where: { providerKey },
      include: { supplierVariant: true },
    });
    if (mapping?.supplierVariant) return mapping.supplierVariant;
  }

  if (line.gtin) {
    const mapping = await prisma.variantMapping.findFirst({
      where: { gtin: line.gtin },
      include: { supplierVariant: true },
    });
    if (mapping?.supplierVariant) return mapping.supplierVariant;
  }

  if (line.supplierSku) {
    const variant = await prisma.supplierVariant.findFirst({
      where: { supplierSku: line.supplierSku },
    });
    if (variant) return variant;
  }

  return null;
}

function buildArrivalUpdates(lines: ResolvedLine[]) {
  const now = new Date();
  const etaWindowDays = Number.isFinite(GALAXUS_SUPPLIER_DEFAULT_ETA_WINDOW_DAYS)
    ? Math.max(0, GALAXUS_SUPPLIER_DEFAULT_ETA_WINDOW_DAYS)
    : 0;
  const lineUpdates = lines.map((line) => {
    const leadDays = Number.isFinite(line.leadDays) ? Math.max(0, line.leadDays) : 0;
    const start = addDays(now, leadDays);
    const end = addDays(start, etaWindowDays);
    return {
      id: line.line.id,
      data: {
        qtyConfirmed: line.line.quantity,
        arrivalDateStart: start,
        arrivalDateEnd: end,
        supplierVariantId: line.line.supplierVariantId ?? line.supplierVariant.supplierVariantId,
        supplierSku: line.line.supplierSku ?? line.supplierVariant.supplierSku,
      },
    };
  });
  const ordrMode: "WITH_ARRIVAL_DATES" | "WITHOUT_POSITIONS" =
    lineUpdates.length > 0 ? "WITH_ARRIVAL_DATES" : "WITHOUT_POSITIONS";
  return { lineUpdates, ordrMode };
}

function buildDeliveryAddress(order: GalaxusOrder) {
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

function requireField(value: string | null | undefined, label: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing ${label} for supplier order`);
  }
  return value.trim();
}

function normalizeCountryCode(code: string | null | undefined, countryName?: string | null): string | null {
  if (code && code.trim()) return code.trim().toUpperCase();
  if (!countryName) return null;
  const normalized = countryName.trim().toLowerCase();
  if (["switzerland", "schweiz", "suisse"].includes(normalized)) return "CH";
  return null;
}

function parseGoldenSizeId(supplierVariantId: string): number | null {
  const [prefix, rawId] = supplierVariantId.split(":");
  if (prefix?.toLowerCase() !== "golden") return null;
  const parsed = Number.parseInt(rawId ?? "", 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function addDays(date: Date, days: number) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}
