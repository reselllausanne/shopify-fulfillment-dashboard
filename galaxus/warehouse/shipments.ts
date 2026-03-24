import "server-only";

import type { GalaxusOrder, GalaxusOrderLine, Shipment } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { buildDocNumber } from "@/galaxus/edi/docNumbers";
import { allocateSscc } from "@/galaxus/sscc/generator";
import { generateSsccLabelPdf } from "@/galaxus/labels/ssccLabel";
import { getStorageAdapter } from "@/galaxus/storage/storage";
import { packOrderLines } from "./packing";
import { buildProviderKey, extractProviderKeyFromOrderKey, normalizeProviderKey, resolveSupplierCode } from "@/galaxus/supplier/providerKey";
import { accumulateBestCandidates } from "@/galaxus/exports/gtinSelection";
import { renderDeliveryNoteHtml } from "@/galaxus/documents/templates/deliveryNote";
import { renderPdfFromHtml } from "@/galaxus/documents/renderers/playwrightRenderer";
import type { DeliveryNoteData, DeliveryNoteOrderGroup, OrderLine } from "@/galaxus/documents/types";
import {
  GALAXUS_SUPPLIER_ADDRESS_LINES,
  GALAXUS_SUPPLIER_EMAIL,
  GALAXUS_SUPPLIER_NAME,
  GALAXUS_SUPPLIER_PHONE,
  GALAXUS_SUPPLIER_VAT_ID,
  GALAXUS_SUPPLIER_WEBSITE,
} from "@/galaxus/config";

type CreateShipmentsOptions = {
  orderId: string;
  maxPairsPerParcel?: number;
  allowSplit?: boolean;
  trackingNumbers?: string[];
  carrierRaw?: string | null;
  carrierFinal?: string | null;
  shippedAt?: Date;
  deliveryType?: string;
  packageType?: "PARCEL" | "PALLET";
  force?: boolean;
};

type ManualPackageInput = {
  items: Array<{ lineId: string; quantity: number }>;
};

type CreateManualShipmentsOptions = {
  orderId: string;
  packages: ManualPackageInput[];
  trackingNumbers?: string[];
  carrierRaw?: string | null;
  carrierFinal?: string | null;
  shippedAt?: Date;
  deliveryType?: string;
  packageType?: "PARCEL" | "PALLET";
};

type CreateShipmentsResult = {
  status: "created" | "skipped" | "error";
  shipments: Shipment[];
  message?: string;
  availabilityIssues?: Array<{
    providerKey: string;
    gtin: string | null;
    lineNumber: number | null;
    requestedQty: number;
    stock: number | null;
    reason: "NO_VARIANT" | "OUT_OF_STOCK";
  }>;
};

type ShipmentLineGroup = {
  providerKey: string;
  lines: any[];
  stxDeliveryType?: "express_standard" | "express_expedited" | null;
};

export async function createShipmentsForOrder(options: CreateShipmentsOptions): Promise<CreateShipmentsResult> {
  const prismaAny = prisma as any;
  const order = await resolveOrder(options.orderId);
  if (!order) {
    return { status: "error", shipments: [], message: "Order not found" };
  }

  const existingShipments = await prisma.shipment.findMany({
    where: { orderId: order.id },
    orderBy: { createdAt: "asc" },
  });
  if (existingShipments.length > 0) {
    const hasPlaced = existingShipments.some((shipment) => Boolean((shipment as any).supplierOrderRef));
    return {
      status: "skipped",
      shipments: existingShipments,
      message: hasPlaced
        ? "Shipments already exist and supplier orders were placed"
        : "Shipments already exist",
    };
  }

  const orderAny = order as any;
  validateOrderLines(orderAny.lines);

  const groupedLines = await groupLinesByProviderKey(orderAny.lines);
  const groupedLinesWithStxBuckets = await splitStxGroupsByDeliveryTypeIfNeeded(groupedLines);
  const availabilityIssues = await checkAvailabilityIssues(groupedLinesWithStxBuckets);
  const shipments: Shipment[] = [];
  const shippedAt = options.shippedAt ?? null;
  const storage = getStorageAdapter();
  let shipmentIndex = 0;

  for (const group of groupedLinesWithStxBuckets) {
    const isStx = group.providerKey === "STX";
    const groupMaxPairs = isStx ? 24 : options.maxPairsPerParcel;
    const packed = packOrderLines(group.lines, {
      maxPairsPerParcel: groupMaxPairs,
      allowSplit: options.allowSplit,
    });

    for (let index = 0; index < packed.length; index += 1) {
      const packageId = await allocateSscc();
      const dispatchNotificationId = buildDispatchNotificationId(order.galaxusOrderId, shipmentIndex);
      const trackingNumber = options.trackingNumbers?.[shipmentIndex] ?? null;
      const packageType = options.packageType ?? "PARCEL";

      const created = await prismaAny.$transaction(async (tx: any) => {
        const shipment = await tx.shipment.create({
          data: {
            orderId: order.id,
            providerKey: group.providerKey === "UNASSIGNED" ? null : group.providerKey,
            shipmentId: `SHIP-${order.galaxusOrderId}-${group.providerKey}-${Date.now()}-${shipmentIndex + 1}`,
            dispatchNotificationId,
            dispatchNotificationCreatedAt: new Date(),
            incoterms: null,
            packageId,
            deliveryType:
              group.stxDeliveryType ??
              options.deliveryType ??
              orderAny.deliveryType ??
              "warehouse_delivery",
            carrierRaw: options.carrierRaw ?? "eurosender",
            carrierFinal: options.carrierFinal ?? null,
            trackingNumber,
            packageType,
            shippedAt,
            delrStatus: "PENDING",
          },
        });

        await tx.shipmentItem.createMany({
          data: packed[index].items.map((item) => ({
            shipmentId: shipment.id,
            orderId: order.id,
            supplierPid: (item.line as any).supplierPid ?? "",
            gtin14: item.line.gtin ?? "",
            buyerPid: (item.line as any).buyerPid ?? null,
            quantity: item.quantity,
          })),
        });

        return shipment;
      });

      const deliveryNotePdf = await renderPdfFromHtml({
        html: renderDeliveryNoteHtml(
          buildDeliveryNoteData(
            orderAny,
            packed[index].items,
            created.dispatchNotificationId,
            created.incoterms,
            created.shipmentId
          )
        ),
        format: "A4",
        showPageNumbers: true,
      });
      const deliveryKey = `galaxus/${order.galaxusOrderId}/delivery_note/${created.id}.pdf`;
      const deliveryStored = await storage.uploadPdf(deliveryKey, deliveryNotePdf);
      await prismaAny.document.create({
        data: {
          orderId: order.id,
          shipmentId: created.id,
          type: "DELIVERY_NOTE",
          version: 1,
          storageUrl: deliveryStored.storageUrl,
        },
      });

      const label = await generateSsccLabelPdf(order, packageId);
      const key = `galaxus/${order.galaxusOrderId}/shipments/${created.id}/sscc-label.pdf`;
      const stored = await storage.uploadPdf(key, label.pdf);

      const updated = await prismaAny.shipment.update({
        where: { id: created.id },
        data: {
          labelZpl: label.zpl,
          labelPdfUrl: stored.storageUrl,
          labelGeneratedAt: new Date(),
        },
      });

      shipments.push(updated);
      shipmentIndex += 1;
    }
  }

  return {
    status: "created",
    shipments,
    ...(availabilityIssues.length > 0 ? { availabilityIssues } : {}),
  };
}

export async function createManualShipmentsForOrder(
  options: CreateManualShipmentsOptions
): Promise<CreateShipmentsResult> {
  const prismaAny = prisma as any;
  const order = await resolveOrder(options.orderId);
  if (!order) {
    return { status: "error", shipments: [], message: "Order not found" };
  }
  const existingShipments = await prisma.shipment.findMany({
    where: { orderId: order.id },
    orderBy: { createdAt: "asc" },
  });
  if (!options.packages?.length) {
    return { status: "error", shipments: [], message: "No packages provided" };
  }

  const orderAny = order as any;
  validateOrderLines(orderAny.lines);
  const purgeCandidates = existingShipments.filter((shipment) => {
    const delrStatus = String(shipment?.delrStatus ?? "").toUpperCase();
    const status = String(shipment?.status ?? "").toUpperCase();
    if (status === "MANUAL") return false;
    if (shipment?.delrSentAt) return false;
    if (delrStatus === "UPLOADED") return false;
    return true;
  });
  if (purgeCandidates.length > 0) {
    const purgeIds = purgeCandidates.map((shipment) => shipment.id);
    await prismaAny.$transaction(async (tx: any) => {
      await tx.shipmentItem.deleteMany({ where: { shipmentId: { in: purgeIds } } });
      await tx.document.deleteMany({ where: { shipmentId: { in: purgeIds } } });
      await tx.shipment.deleteMany({ where: { id: { in: purgeIds } } });
    });
  }
  const lineById = new Map<string, any>(orderAny.lines.map((line: any) => [line.id, line]));
  const totalsByLine = new Map<string, number>();
  const shippedQtyByLine = new Map<string, number>();
  const reservedQtyByLine = new Map<string, number>();
  if (existingShipments.length > 0) {
    const existingItems = await prismaAny.shipmentItem.findMany({
      where: { orderId: order.id },
      select: {
        supplierPid: true,
        gtin14: true,
        quantity: true,
        shipment: { select: { delrSentAt: true, delrStatus: true, status: true } },
      },
    });
    for (const line of orderAny.lines) {
      const lineId = String(line.id);
      const supplierPid = String(line?.supplierPid ?? "").trim();
      const gtin = String(line?.gtin ?? "").trim();
      const reserved = existingItems
        .filter((item: any) => {
          const sameLine =
            String(item?.supplierPid ?? "").trim() === supplierPid &&
            String(item?.gtin14 ?? "").trim() === gtin;
          if (!sameLine) return false;
          const delrStatus = String(item?.shipment?.delrStatus ?? "").toUpperCase();
          const status = String(item?.shipment?.status ?? "").toUpperCase();
          if (status !== "MANUAL") return false;
          if (item?.shipment?.delrSentAt) return false;
          if (delrStatus === "UPLOADED") return false;
          return true;
        })
        .reduce((acc: number, item: any) => acc + Math.max(0, Number(item?.quantity ?? 0)), 0);
      if (reserved > 0) reservedQtyByLine.set(lineId, reserved);
      const qty = existingItems
        .filter((item: any) => {
          const sameLine =
            String(item?.supplierPid ?? "").trim() === supplierPid &&
            String(item?.gtin14 ?? "").trim() === gtin;
          if (!sameLine) return false;
          const delrStatus = String(item?.shipment?.delrStatus ?? "").toUpperCase();
          return Boolean(item?.shipment?.delrSentAt) || delrStatus === "UPLOADED";
        })
        .reduce((acc: number, item: any) => acc + Math.max(0, Number(item?.quantity ?? 0)), 0);
      if (qty > 0) shippedQtyByLine.set(lineId, qty);
    }
  }
  const packagesResolved: Array<{
    items: Array<{ line: GalaxusOrderLine; quantity: number }>;
    providerKey: string;
  }> = [];

  for (let idx = 0; idx < options.packages.length; idx += 1) {
    const pkg = options.packages[idx];
    if (!pkg?.items?.length) continue;
    const items: Array<{ line: GalaxusOrderLine; quantity: number }> = [];
    for (const item of pkg.items) {
      const lineId = String(item.lineId ?? "").trim();
      const qty = Math.max(0, Number(item.quantity ?? 0));
      if (!lineId || qty <= 0) continue;
      const line = lineById.get(lineId);
      if (!line) {
        return { status: "error", shipments: [], message: `Unknown line in package ${idx + 1}` };
      }
      const alreadyAssigned = totalsByLine.get(lineId) ?? 0;
      const alreadyShipped = shippedQtyByLine.get(lineId) ?? 0;
      const alreadyReserved = reservedQtyByLine.get(lineId) ?? 0;
      const lineQty = Number(line?.quantity ?? 0);
      const remaining = Math.max(0, lineQty - alreadyShipped - alreadyReserved);
      const nextTotal = alreadyAssigned + qty;
      if (nextTotal > remaining) {
        return {
          status: "error",
          shipments: [],
          message: `Package ${idx + 1} exceeds remaining quantity for line ${line.lineNumber}`,
        };
      }
      totalsByLine.set(lineId, nextTotal);
      items.push({ line, quantity: qty });
    }
    if (items.length === 0) continue;

    const providerKeys = new Set<string>();
    for (const item of items) {
      const resolution = await resolveProviderKeyForLine(item.line as any);
      providerKeys.add(resolution.providerKey);
    }
    const distinctProviders = Array.from(providerKeys.values()).filter((key) => key && key !== "UNASSIGNED");
    if (distinctProviders.length > 1) {
      return {
        status: "error",
        shipments: [],
        message: `Package ${idx + 1} mixes supplier channels (${distinctProviders.join(", ")}). Put StockX-only and other suppliers in separate parcels.`,
      };
    }
    const providerKey = distinctProviders;

    packagesResolved.push({
      items,
      providerKey: providerKey[0] ?? "UNASSIGNED",
    });
  }

  if (packagesResolved.length === 0) {
    return { status: "error", shipments: [], message: "All packages are empty" };
  }

  const shipments: Shipment[] = [];
  const shippedAt = options.shippedAt ?? null;
  const storage = getStorageAdapter();

  const startIndex = existingShipments.length;
  for (let index = 0; index < packagesResolved.length; index += 1) {
    const pack = packagesResolved[index];
    const packageId = await allocateSscc();
    const dispatchNotificationId = buildDispatchNotificationId(order.galaxusOrderId, startIndex + index);
    const trackingNumber = options.trackingNumbers?.[startIndex + index] ?? null;
    const packageType = options.packageType ?? "PARCEL";

    const created = await prismaAny.$transaction(async (tx: any) => {
      const shipment = await tx.shipment.create({
        data: {
          orderId: order.id,
          providerKey: pack.providerKey === "UNASSIGNED" ? null : pack.providerKey,
          status: "MANUAL",
          shipmentId: `SHIP-${order.galaxusOrderId}-${pack.providerKey}-${Date.now()}-${startIndex + index + 1}`,
          dispatchNotificationId,
          dispatchNotificationCreatedAt: new Date(),
          incoterms: null,
          packageId,
          deliveryType: options.deliveryType ?? orderAny.deliveryType ?? "warehouse_delivery",
          carrierRaw: options.carrierRaw ?? "eurosender",
          carrierFinal: options.carrierFinal ?? null,
          trackingNumber,
          packageType,
          shippedAt,
          delrStatus: "PENDING",
        },
      });

      await tx.shipmentItem.createMany({
        data: pack.items.map((item) => ({
          shipmentId: shipment.id,
          orderId: order.id,
          supplierPid: (item.line as any).supplierPid ?? "",
          gtin14: (item.line as any).gtin ?? "",
          buyerPid: (item.line as any).buyerPid ?? null,
          quantity: item.quantity,
        })),
      });

      return shipment;
    });

    const deliveryNotePdf = await renderPdfFromHtml({
      html: renderDeliveryNoteHtml(
        buildDeliveryNoteData(orderAny, pack.items, created.dispatchNotificationId, created.incoterms, created.shipmentId)
      ),
      format: "A4",
      showPageNumbers: true,
    });
    const deliveryKey = `galaxus/${order.galaxusOrderId}/delivery_note/${created.id}.pdf`;
    const deliveryStored = await storage.uploadPdf(deliveryKey, deliveryNotePdf);
    await prismaAny.document.create({
      data: {
        orderId: order.id,
        shipmentId: created.id,
        type: "DELIVERY_NOTE",
        version: 1,
        storageUrl: deliveryStored.storageUrl,
      },
    });

    const label = await generateSsccLabelPdf(order, packageId);
    const key = `galaxus/${order.galaxusOrderId}/shipments/${created.id}/sscc-label.pdf`;
    const stored = await storage.uploadPdf(key, label.pdf);

    const updated = await prismaAny.shipment.update({
      where: { id: created.id },
      data: {
        labelZpl: label.zpl,
        labelPdfUrl: stored.storageUrl,
        labelGeneratedAt: new Date(),
      },
    });

    shipments.push(updated);
  }

  return {
    status: "created",
    shipments,
  };
}

async function checkAvailabilityIssues(groups: ShipmentLineGroup[]) {
  const issues: Array<{
    providerKey: string;
    gtin: string | null;
    lineNumber: number | null;
    requestedQty: number;
    stock: number | null;
    reason: "NO_VARIANT" | "OUT_OF_STOCK";
  }> = [];

  const relevantGroups = groups.filter((g) => {
    const key = String(g.providerKey ?? "").trim().toUpperCase();
    return key && key !== "STX" && key !== "UNASSIGNED";
  });
  if (relevantGroups.length === 0) return issues;

  for (const group of relevantGroups) {
    const providerKey = String(group.providerKey ?? "").trim().toUpperCase();
    const gtins = Array.from(
      new Set(
        group.lines
          .map((line) => String(line?.gtin ?? "").trim())
          .filter((value) => value.length > 0)
      )
    );
    if (gtins.length === 0) continue;

    const variants = await prisma.supplierVariant.findMany({
      where: { providerKey, gtin: { in: gtins } },
      select: { gtin: true, stock: true },
    });
    const stockByGtin = new Map<string, number | null>();
    for (const row of variants) {
      const gtin = String(row.gtin ?? "").trim();
      if (!gtin) continue;
      const stock = row.stock === null || row.stock === undefined ? null : Number(row.stock);
      stockByGtin.set(gtin, Number.isFinite(stock as number) ? (stock as number) : null);
    }

    for (const line of group.lines) {
      const gtin = line?.gtin ? String(line.gtin).trim() : "";
      const qty = Math.max(1, Number(line?.quantity ?? 1));
      if (!gtin) continue;
      if (!stockByGtin.has(gtin)) {
        issues.push({
          providerKey,
          gtin,
          lineNumber: line?.lineNumber ?? null,
          requestedQty: qty,
          stock: null,
          reason: "NO_VARIANT",
        });
        continue;
      }
      const stock = stockByGtin.get(gtin) ?? null;
      if (stock !== null && stock < qty) {
        issues.push({
          providerKey,
          gtin,
          lineNumber: line?.lineNumber ?? null,
          requestedQty: qty,
          stock,
          reason: "OUT_OF_STOCK",
        });
      }
    }
  }

  return issues;
}

async function groupLinesByProviderKey(lines: Array<any>): Promise<ShipmentLineGroup[]> {
  const groups = new Map<string, any[]>();
  for (const line of lines) {
    const resolution = await resolveProviderKeyForLine(line);
    await logRoutingDecision(line, resolution);
    const existing = groups.get(resolution.providerKey) ?? [];
    existing.push(line);
    groups.set(resolution.providerKey, existing);
  }

  return Array.from(groups.entries()).map(([providerKey, groupLines]) => ({
    providerKey,
    lines: groupLines,
  }));
}

async function splitStxGroupsByDeliveryTypeIfNeeded(
  groups: ShipmentLineGroup[]
): Promise<ShipmentLineGroup[]> {
  const out: ShipmentLineGroup[] = [];
  for (const group of groups) {
    if (group.providerKey !== "STX") {
      out.push(group);
      continue;
    }
    const buckets = await bucketStxLinesByDeliveryType(group.lines);
    const standardQty = sumLineQty(buckets.standard);
    const expeditedQty = sumLineQty(buckets.expedited);
    // Split only when both express buckets exceed 12 units.
    if (standardQty > 12 && expeditedQty > 12) {
      if (buckets.standard.length > 0) {
        out.push({
          providerKey: "STX",
          lines: buckets.standard,
          stxDeliveryType: "express_standard",
        });
      }
      if (buckets.expedited.length > 0) {
        out.push({
          providerKey: "STX",
          lines: buckets.expedited,
          stxDeliveryType: "express_expedited",
        });
      }
      if (buckets.other.length > 0) {
        out.push({
          providerKey: "STX",
          lines: buckets.other,
          stxDeliveryType: null,
        });
      }
      continue;
    }
    out.push(group);
  }
  return out;
}

function sumLineQty(lines: any[]) {
  return lines.reduce((acc, line) => acc + Math.max(1, Number(line?.quantity ?? 1)), 0);
}

async function bucketStxLinesByDeliveryType(lines: any[]) {
  const variantIds = Array.from(
    new Set(
      lines
        .map((line) => String(line?.supplierVariantId ?? "").trim())
        .filter((value) => value.startsWith("stx_"))
    )
  );
  const gtins = Array.from(
    new Set(
      lines
        .map((line) => String(line?.gtin ?? "").trim())
        .filter((value) => value.length > 0)
    )
  );

  const variantRows =
    variantIds.length > 0
      ? await prisma.supplierVariant.findMany({
          where: { supplierVariantId: { in: variantIds } },
          select: { supplierVariantId: true, deliveryType: true },
        })
      : [];
  const mappingRows =
    gtins.length > 0
      ? await (prisma as any).variantMapping.findMany({
          where: {
            gtin: { in: gtins },
            supplierVariantId: { startsWith: "stx_" },
          },
          include: { supplierVariant: true },
          orderBy: { updatedAt: "desc" },
        })
      : [];

  const deliveryTypeByVariant = new Map<string, string>();
  for (const row of variantRows) {
    const id = String(row.supplierVariantId ?? "");
    const deliveryType = String((row as any).deliveryType ?? "").toLowerCase();
    if (!id || !deliveryType) continue;
    deliveryTypeByVariant.set(id, deliveryType);
  }

  const deliveryTypeByGtin = new Map<string, string>();
  for (const row of mappingRows) {
    const gtin = String(row?.gtin ?? "").trim();
    if (!gtin || deliveryTypeByGtin.has(gtin)) continue;
    const deliveryType = String(row?.supplierVariant?.deliveryType ?? "").toLowerCase();
    if (deliveryType === "express_standard" || deliveryType === "express_expedited") {
      deliveryTypeByGtin.set(gtin, deliveryType);
    }
  }

  const standard: any[] = [];
  const expedited: any[] = [];
  const other: any[] = [];
  for (const line of lines) {
    const supplierVariantId = String(line?.supplierVariantId ?? "").trim();
    const gtin = String(line?.gtin ?? "").trim();
    const byVariant = supplierVariantId ? deliveryTypeByVariant.get(supplierVariantId) : null;
    const deliveryType = byVariant ?? (gtin ? deliveryTypeByGtin.get(gtin) : null) ?? null;
    if (deliveryType === "express_standard") {
      standard.push(line);
    } else if (deliveryType === "express_expedited") {
      expedited.push(line);
    } else {
      other.push(line);
    }
  }

  return { standard, expedited, other };
}

type ProviderResolution = { providerKey: string; rule: string; assigned: boolean };

async function resolveProviderKeyForLine(line: any): Promise<ProviderResolution> {
  const direct = extractProviderKeyFromOrderKey(line.providerKey ?? null);
  if (direct) return { providerKey: direct, rule: "ORDER_PROVIDERKEY", assigned: true };

  const variantId = line.supplierVariantId ?? null;
  if (variantId) {
    return {
      providerKey: normalizeProviderKey(resolveSupplierCode(variantId)) ?? "UNASSIGNED",
      rule: "VARIANT_ID",
      assigned: Boolean(normalizeProviderKey(resolveSupplierCode(variantId))),
    };
  }

  const gtin = line.gtin ?? null;
  if (gtin) {
    const mappings = await prisma.variantMapping.findMany({
      where: { gtin, status: { in: ["MATCHED", "SUPPLIER_GTIN", "PARTNER_GTIN"] } },
      include: {
        supplierVariant: true,
        kickdbVariant: { include: { product: true } },
      },
    });
    if (mappings.length > 0) {
      const bestByGtin = accumulateBestCandidates(mappings, new Map());
      const candidate = bestByGtin.get(gtin);
      const variant = candidate?.variant ?? null;
      const fromVariant =
        normalizeProviderKey(variant?.providerKey ?? null) ??
        (variant?.supplierVariantId ? normalizeProviderKey(resolveSupplierCode(variant.supplierVariantId)) : null);
      if (fromVariant) {
        return { providerKey: fromVariant, rule: "GTIN_CHEAPEST", assigned: true };
      }
    }
  }

  return { providerKey: "UNASSIGNED", rule: "NO_MATCH", assigned: false };
}

async function logRoutingDecision(line: any, resolution: ProviderResolution) {
  const prismaAny = prisma as any;
  const orderLineId = line?.id ?? null;
  if (!orderLineId) return;
  if (!prismaAny.orderRoutingIssue?.upsert) return;
  await prismaAny.orderRoutingIssue.upsert({
    where: { orderLineId },
    create: {
      orderId: line?.orderId ?? null,
      orderLineId,
      galaxusOrderId: line?.order?.galaxusOrderId ?? null,
      gtin: line?.gtin ?? null,
      providerKey: resolution.assigned ? resolution.providerKey : null,
      status: resolution.assigned ? "ASSIGNED" : "UNASSIGNED",
      rule: resolution.rule,
      payloadJson: {
        supplierVariantId: line?.supplierVariantId ?? null,
        providerKeyRaw: line?.providerKey ?? null,
        buyerPid: line?.buyerPid ?? null,
      },
    },
    update: {
      providerKey: resolution.assigned ? resolution.providerKey : null,
      status: resolution.assigned ? "ASSIGNED" : "UNASSIGNED",
      rule: resolution.rule,
      payloadJson: {
        supplierVariantId: line?.supplierVariantId ?? null,
        providerKeyRaw: line?.providerKey ?? null,
        buyerPid: line?.buyerPid ?? null,
      },
    },
  });
}

function buildDeliveryNoteData(
  order: GalaxusOrder,
  items: Array<{ line: GalaxusOrderLine; quantity: number }>,
  deliveryNoteNumber: string | null,
  incoterms: string | null,
  shipmentId: string
): DeliveryNoteData {
  const lines: OrderLine[] = items.map((item) => {
    const line = item.line as any;
    const gtin = String(line.gtin ?? "").trim();
    const providerPrefix =
      normalizeProviderKey(line.providerKey ?? null) ??
      normalizeProviderKey(resolveSupplierCode(line.supplierVariantId ?? null)) ??
      "SUP";
    const providerKey = gtin ? `${providerPrefix}_${gtin}` : buildProviderKey(line.gtin, line.supplierVariantId) ?? "";
    const unitNetPrice = Number(line.unitNetPrice ?? 0);
    const lineNetAmount = unitNetPrice * item.quantity;
    return {
      lineNumber: line.lineNumber,
      articleNumber: providerKey,
      description: line.productName ?? "Item",
      size: line.size ?? null,
      gtin: line.gtin ?? null,
      providerKey,
      sku: line.supplierSku ?? line.supplierVariantId ?? null,
      quantity: item.quantity,
      vatRate: Number(line.vatRate ?? 0),
      unitNetPrice,
      lineNetAmount,
    };
  });

  const group: DeliveryNoteOrderGroup = {
    orderNumber: order.orderNumber ?? order.galaxusOrderId,
    deliveryDate: order.deliveryDate,
    lines,
  };

  return {
    shipmentId,
    createdAt: new Date(),
    deliveryNoteNumber: deliveryNoteNumber ?? buildDeliveryNoteNumber(order),
    incoterms: incoterms ?? null,
    buyer: (() => {
      const hasRecipient =
        Boolean(order.recipientName) ||
        Boolean(order.recipientAddress1) ||
        Boolean(order.recipientPostalCode) ||
        Boolean(order.recipientCity) ||
        Boolean(order.recipientCountry);
      if (hasRecipient) {
        return {
          name: order.recipientName ?? "",
          line1: order.recipientAddress1 ?? "",
          line2: order.recipientAddress2 ?? null,
          postalCode: order.recipientPostalCode ?? "",
          city: order.recipientCity ?? "",
          country: order.recipientCountry ?? "",
        };
      }
      if (order.deliveryType === "warehouse_delivery") {
        return {
          name: order.customerName ?? "",
          line1: order.customerAddress1 ?? "",
          line2: order.customerAddress2 ?? null,
          postalCode: order.customerPostalCode ?? "",
          city: order.customerCity ?? "",
          country: order.customerCountry ?? "",
        };
      }
      return {
        name: "",
        line1: "",
        line2: null,
        postalCode: "",
        city: "",
        country: "",
      };
    })(),
    supplier: {
      name: GALAXUS_SUPPLIER_NAME,
      addressLines: GALAXUS_SUPPLIER_ADDRESS_LINES,
      phone: GALAXUS_SUPPLIER_PHONE ?? null,
      email: GALAXUS_SUPPLIER_EMAIL ?? null,
      website: GALAXUS_SUPPLIER_WEBSITE ?? null,
      vatId: GALAXUS_SUPPLIER_VAT_ID ?? null,
    },
    orderReference: order.orderNumber ?? order.galaxusOrderId,
    referencePerson: order.referencePerson ?? null,
    yourReference: order.yourReference ?? null,
    buyerPhone: order.recipientPhone ?? null,
    afterSalesHandling: order.afterSalesHandling ?? false,
    legalNotice: null,
    groups: [group],
  };
}

function buildDeliveryNoteNumber(order: GalaxusOrder): string {
  const base = buildDocNumber("GDN");
  const normalized = order.galaxusOrderId.replace(/[^A-Za-z0-9]/g, "");
  return `${base}-${normalized}`;
}

async function resolveOrder(orderIdOrRef: string) {
  const order = await prisma.galaxusOrder.findUnique({
    where: { id: orderIdOrRef },
    include: { lines: true },
  });
  if (order) return order;
  return prisma.galaxusOrder.findUnique({
    where: { galaxusOrderId: orderIdOrRef },
    include: { lines: true },
  });
}

function validateOrderLines(lines: Array<any>) {
  for (const line of lines) {
    if (!line.supplierPid) {
      throw new Error(`Missing supplier PID for line ${line.lineNumber}`);
    }
    if (!line.gtin) {
      throw new Error(`Missing GTIN for line ${line.lineNumber}`);
    }
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      throw new Error(`Invalid quantity for line ${line.lineNumber}`);
    }
  }
}

function buildDispatchNotificationId(orderRef: string, index: number) {
  const base = buildDocNumber("GDN");
  const normalized = orderRef.replace(/[^A-Za-z0-9]/g, "");
  return `${base}-${normalized}-P${index + 1}`;
}
