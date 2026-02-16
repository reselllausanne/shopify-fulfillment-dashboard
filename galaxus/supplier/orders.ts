import "server-only";

import type { GalaxusOrder, GalaxusOrderLine, SupplierVariant } from "@prisma/client";
import type { EdiDocType } from "@/galaxus/edi/filenames";
import { prisma } from "@/app/lib/prisma";
import { createGoldenSupplierClient } from "./client";
import type {
  SupplierDropshipOrderDetails,
  SupplierDropshipOrderItem,
  SupplierDropshipOrderRequest,
} from "./types";
import { extractProviderKeyFromOrderKey, normalizeProviderKey } from "@/galaxus/supplier/providerKey";
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

type SupplierGateResult = {
  ok: boolean;
  reason?: string;
  statusByOrderRef: Array<{
    supplierOrderRef: string;
    supplierKey: string;
    status: string;
  }>;
  allowedTypes: Set<EdiDocType>;
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
    const goldenLines = resolvedLines.filter((line) => line.supplierKey === "golden");
    const partnerLines = resolvedLines.filter((line) => line.supplierKey !== "golden");
    const deliveryAddress = buildDeliveryAddress(order);
    const { lineUpdates, ordrMode } = buildArrivalUpdates(resolvedLines);

    if (lineUpdates.length > 0) {
      await prisma.$transaction(async (tx) => {
        for (const update of lineUpdates) {
          await tx.galaxusOrderLine.update({
            where: { id: update.id },
            data: update.data,
          });
        }
      });
    }

    if (partnerLines.length > 0) {
      const partnerKeys = Array.from(new Set(partnerLines.map((line) => line.supplierKey)));
      await prisma.orderStatusEvent.create({
        data: {
          orderId: order.id,
          source: "partner",
          type: "PARTNER_LINES_ASSIGNED",
          payloadJson: { partnerKeys },
        },
      });
    }

    if (goldenLines.length === 0) {
      return { status: "created", ordrMode };
    }

    const batches = splitBySupplierAndMaxPairs(goldenLines, 12);

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

export async function getSupplierGateForOrder(orderId: string): Promise<SupplierGateResult> {
  const order = await prisma.galaxusOrder.findUnique({
    where: { id: orderId },
    include: { lines: true, supplierOrders: true },
  });
  if (!order) {
    return {
      ok: false,
      reason: `Order not found: ${orderId}`,
      statusByOrderRef: [],
      allowedTypes: new Set(),
    };
  }

  const supplierKeys = await resolveSupplierKeysForLines(order.lines);
  const hasGolden = supplierKeys.includes("golden");
  const partnerKeys = supplierKeys.filter((key) => key !== "golden" && key !== "unknown");
  if (!hasGolden) {
    return {
      ok: true,
      statusByOrderRef: partnerKeys.map((key) => ({
        supplierOrderRef: `partner-${key}`,
        supplierKey: key,
        status: "ASSIGNED",
      })),
      allowedTypes: new Set<EdiDocType>(["ORDR", "DELR", "INVO", "EXPINV"]),
    };
  }

  if (order.supplierOrders.length === 0) {
    return {
      ok: false,
      reason: "No supplier order created yet",
      statusByOrderRef: [],
      allowedTypes: new Set(),
    };
  }

  const statusByOrderRef: SupplierGateResult["statusByOrderRef"] = [];
  const statuses: string[] = [];

  for (const supplierOrder of order.supplierOrders) {
    const payload = (supplierOrder.payloadJson ?? {}) as any;
    const supplierKey = payload.supplierKey ?? "golden";
    const client = resolveSupplierClient(supplierKey);
    if (!client.getDropshipOrderDetails) {
      return {
        ok: false,
        reason: `Supplier client does not support status checks: ${supplierKey}`,
        statusByOrderRef,
        allowedTypes: new Set(),
      };
    }

    const details: SupplierDropshipOrderDetails = await client.getDropshipOrderDetails(
      supplierOrder.supplierOrderRef
    );
    statuses.push(details.status);
    statusByOrderRef.push({
      supplierOrderRef: supplierOrder.supplierOrderRef,
      supplierKey,
      status: details.status,
    });

    await prisma.supplierOrder.update({
      where: { id: supplierOrder.id },
      data: {
        payloadJson: {
          ...payload,
          supplierStatus: details.status,
          dropshipPackageId: details.dropshipPackageId ?? null,
          trackingNumbers: details.trackingNumbers ?? [],
          lastStatusAt: new Date().toISOString(),
        },
      },
    });
  }

  for (const partnerKey of partnerKeys) {
    statusByOrderRef.push({
      supplierOrderRef: `partner-${partnerKey}`,
      supplierKey: partnerKey,
      status: "ASSIGNED",
    });
  }

  const all = (candidates: string[]) => statuses.every((status) => candidates.includes(status));
  const allowedTypes = new Set<EdiDocType>();
  if (all(["TO_SHIP", "WAITING_FOR_INVOICE", "ENDED"])) {
    allowedTypes.add("ORDR");
  }
  if (all(["TO_SHIP", "ENDED"])) {
    allowedTypes.add("DELR");
  }
  if (all(["WAITING_FOR_INVOICE", "ENDED"])) {
    allowedTypes.add("INVO");
    allowedTypes.add("EXPINV");
  }

  return { ok: true, statusByOrderRef, allowedTypes };
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
      if (supplierKey === "golden") {
        throw new Error(`Missing SKU/size for line ${line.lineNumber}`);
      }
      resolved.push({
        line,
        supplierVariant,
        item: {
          sku: supplierVariant.supplierSku ?? line.supplierSku ?? "",
          sizeUs: sizeUs ?? "",
          quantity: line.quantity,
        },
        leadDays: supplierVariant.leadTimeDays ?? GALAXUS_SUPPLIER_DEFAULT_LEAD_DAYS,
        supplierKey,
      });
      continue;
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

async function resolveSupplierKeysForLines(lines: GalaxusOrderLine[]) {
  const keys = new Set<string>();
  for (const line of lines) {
    if (line.supplierVariantId) {
      keys.add(resolveSupplierKey(line.supplierVariantId));
      continue;
    }
    const resolved = await resolveSupplierVariant(line);
    if (resolved?.supplierVariantId) {
      keys.add(resolveSupplierKey(resolved.supplierVariantId));
    } else {
      keys.add("unknown");
    }
  }
  return Array.from(keys);
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

export async function resolveSupplierVariant(line: GalaxusOrderLine): Promise<SupplierVariant | null> {
  if (line.supplierVariantId) {
    const variant = await prisma.supplierVariant.findUnique({
      where: { supplierVariantId: line.supplierVariantId },
    });
    if (variant) return variant;
  }

  const providerKey =
    extractProviderKeyFromOrderKey(line.providerKey ?? null) ?? normalizeProviderKey(line.providerKey ?? null);
  if (providerKey && line.gtin) {
    const variant = await prisma.supplierVariant.findFirst({
      where: { providerKey, gtin: line.gtin },
    });
    if (variant) return variant;
  }
  if (providerKey) {
    const mapping = await prisma.variantMapping.findFirst({
      where: { providerKey, ...(line.gtin ? { gtin: line.gtin } : {}) },
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
