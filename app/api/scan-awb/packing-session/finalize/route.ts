import { NextRequest, NextResponse } from "next/server";
import { DocumentType } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { createCompositeWarehouseShipment } from "@/galaxus/warehouse/shipments";
import { DocumentService } from "@/galaxus/documents/DocumentService";
import {
  applySuccessfulSwissPostLabelToShipment,
  extractLabelPayload,
  requestSwissPostLabelForOrderWithTrackingHint,
} from "@/galaxus/directDelivery/swissPostLabelFlow";
import { resolveBrowserPrintConfig } from "@/galaxus/directDelivery/runDirectSwissPostLabel";
import { isLocalStation, maybePrintLabelLocally } from "@/lib/printEnv";
import type { LpJobResult } from "@/lib/cupsLpPrint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Finalize a /scan packing session as ONE physical box per shipping address.
 *
 * Behavior: entries from multiple Galaxus orders sharing the same recipient
 * (postal code + address1 + city) collapse into a single composite Shipment
 * with a single SSCC / delivery note / Swiss Post label. Different addresses
 * split into separate composite shipments. DELR is emitted per-order downstream
 * because `resolveDispatchOrdersForShipment` fans `ShipmentItem.orderId` out
 * into per-order dispatch references — Galaxus contract compliant.
 *
 * Anchor = oldest orderDate in the address group (deterministic, matches how
 * `/galaxus/warehouse-shipments` sorts eligible orders).
 *
 * Processes address-groups sequentially: shared printer, DELR ordering, and
 * Swiss Post rate limits.
 */

type EntryIn = {
  galaxusOrderDbId?: string;
  galaxusOrderLineId?: string;
  unitIndex?: number;
  supplierPid?: string;
  gtin?: string | null;
  productName?: string | null;
};

type ShipmentResult = {
  addressKey: string;
  anchorOrderDbId: string;
  sourceOrderDbIds: string[];
  ok: boolean;
  shipmentId?: string;
  trackingNumber?: string | null;
  delrStatus?: string | null;
  // Canonical document URLs — same URLs `/galaxus/warehouse-shipments` opens,
  // so /scan popup can `window.open()` each PDF post-finalize.
  ssccUrl?: string | null;
  packingSlipUrl?: string | null;
  labelUrl?: string | null;
  error?: string;
  labelPrintJobResult?: LpJobResult | null;
};

type DeliveryNoteRequiredOrder = {
  galaxusOrderDbId: string;
  galaxusOrderId: string;
  orderNumber: string | null;
};

type DeliveryNoteRequirement = {
  required: boolean;
  requiredOrders: DeliveryNoteRequiredOrder[];
};

function buildDeliveryNoteRequirement(
  orderRows: Array<{
    id: string;
    galaxusOrderId: string;
    orderNumber: string | null;
    physicalDeliveryNoteRequired: boolean | null;
  }>,
  orderDbIds: string[]
): DeliveryNoteRequirement {
  const requiredOrders = orderDbIds
    .map((id) => orderRows.find((row) => row.id === id))
    .filter(
      (row): row is {
        id: string;
        galaxusOrderId: string;
        orderNumber: string | null;
        physicalDeliveryNoteRequired: boolean | null;
      } => Boolean(row && row.physicalDeliveryNoteRequired)
    )
    .map((row) => ({
      galaxusOrderDbId: row.id,
      galaxusOrderId: row.galaxusOrderId,
      orderNumber: row.orderNumber ?? null,
    }));

  return {
    required: requiredOrders.length > 0,
    requiredOrders,
  };
}

async function resolveLatestDeliveryNoteUrl(shipmentId: string): Promise<string | null> {
  const existing = await prisma.document.findFirst({
    where: { shipmentId, type: DocumentType.DELIVERY_NOTE },
    orderBy: [{ version: "desc" }, { createdAt: "desc" }],
    select: { id: true },
  });
  if (existing) return `/api/galaxus/documents/${existing.id}`;

  try {
    const documents = await new DocumentService().generateForShipment({
      shipmentId,
      types: [DocumentType.DELIVERY_NOTE],
    });
    const created =
      documents.find((doc) => doc.type === DocumentType.DELIVERY_NOTE) ?? documents[0] ?? null;
    return created ? `/api/galaxus/documents/${created.id}` : null;
  } catch (error: any) {
    console.error("[SCAN][PACKING-SESSION][FINALIZE] Delivery note generation failed", {
      shipmentId,
      error: error?.message ?? String(error),
    });
    return null;
  }
}

async function resolveLatestShippingLabelUrl(shipmentId: string): Promise<string | null> {
  const doc = await prisma.document.findFirst({
    where: {
      shipmentId,
      type: DocumentType.LABEL,
      storageUrl: { contains: "shipping-labels" },
    },
    orderBy: [{ version: "desc" }, { createdAt: "desc" }],
    select: { id: true },
  });
  return doc ? `/api/galaxus/documents/${doc.id}` : null;
}

/**
 * Ensure SSCC PDF exists on the shipment and return a URL the browser can open.
 * Composite create already writes `labelPdfUrl`; we also persist a Document row
 * (LABEL, non shipping-labels path) so Recent Shipments / documents API match
 * the warehouse UI. Falls back to GET `/api/galaxus/shipments/{id}/label`.
 */
async function resolveSsccLabelUrl(shipmentId: string): Promise<string | null> {
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    select: {
      id: true,
      orderId: true,
      labelPdfUrl: true,
      packageId: true,
    },
  });
  if (!shipment) return null;

  if (shipment.labelPdfUrl) {
    // Prefer a Document row when present (same as warehouse recent list).
    const existingDoc = await prisma.document.findFirst({
      where: {
        shipmentId,
        type: DocumentType.LABEL,
        storageUrl: { equals: shipment.labelPdfUrl },
      },
      orderBy: [{ version: "desc" }, { createdAt: "desc" }],
      select: { id: true },
    });
    if (existingDoc) return `/api/galaxus/documents/${existingDoc.id}`;

    // Persist Document so history SSCC button works without regenerating.
    const created = await prisma.document.create({
      data: {
        orderId: shipment.orderId,
        shipmentId: shipment.id,
        type: DocumentType.LABEL,
        version: 1,
        storageUrl: shipment.labelPdfUrl,
      },
      select: { id: true },
    });
    return `/api/galaxus/documents/${created.id}`;
  }

  // No PDF yet — regenerate via the same POST the warehouse "SSCC (regen)" uses.
  if (!shipment.packageId) return null;
  return `/api/galaxus/shipments/${shipmentId}/label`;
}

/**
 * Mirror `sameGalaxusDeliveryAddress` from `galaxus/warehouse/shipments.ts` so
 * the pre-flight grouping matches the composite function's own validator (any
 * mismatch would cause `createCompositeWarehouseShipment` to reject the group).
 */
function recipientKey(order: {
  recipientPostalCode?: string | null;
  recipientAddress1?: string | null;
  recipientCity?: string | null;
}): string {
  const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
  return `${norm(order.recipientPostalCode)}|${norm(order.recipientAddress1)}|${norm(order.recipientCity)}`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const rawEntries: EntryIn[] = Array.isArray(body?.entries) ? body.entries : [];
    const entries = rawEntries
      .map((e) => ({
        galaxusOrderDbId: String(e?.galaxusOrderDbId ?? "").trim(),
        galaxusOrderLineId: String(e?.galaxusOrderLineId ?? "").trim(),
        unitIndex: Math.max(0, Number(e?.unitIndex ?? 0)),
        supplierPid: String(e?.supplierPid ?? "").trim(),
        gtin: e?.gtin ? String(e.gtin).trim() : null,
      }))
      .filter((e) => e.galaxusOrderDbId && e.galaxusOrderLineId);

    if (entries.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No valid entries in session" },
        { status: 400 }
      );
    }

    // Load all referenced orders once for address key + oldest anchor.
    const orderDbIds = Array.from(new Set(entries.map((e) => e.galaxusOrderDbId)));
    const orderRows = await prisma.galaxusOrder.findMany({
      where: { id: { in: orderDbIds } },
      select: {
        id: true,
        galaxusOrderId: true,
        orderDate: true,
        orderNumber: true,
        physicalDeliveryNoteRequired: true,
        recipientPostalCode: true,
        recipientAddress1: true,
        recipientCity: true,
      },
    });
    const orderById = new Map(orderRows.map((o) => [o.id, o]));
    const deliveryNoteRequirement = buildDeliveryNoteRequirement(orderRows, orderDbIds);
    const missingOrder = orderDbIds.find((id) => !orderById.has(id));
    if (missingOrder) {
      return NextResponse.json(
        { ok: false, error: `Order not found: ${missingOrder}` },
        { status: 400 }
      );
    }

    // Group orderDbIds by shipping address key.
    const orderIdsByAddress = new Map<string, Set<string>>();
    for (const e of entries) {
      const order = orderById.get(e.galaxusOrderDbId)!;
      const key = recipientKey(order);
      const bucket = orderIdsByAddress.get(key) ?? new Set<string>();
      bucket.add(e.galaxusOrderDbId);
      orderIdsByAddress.set(key, bucket);
    }

    const localStation = isLocalStation();
    const browserPrintBase = resolveBrowserPrintConfig();
    const results: ShipmentResult[] = [];

    // Sequential per address-group. Normal single-box case = 1 iteration.
    for (const [addressKey, orderIdsSet] of orderIdsByAddress.entries()) {
      const groupOrderIds = Array.from(orderIdsSet);
      // Anchor = oldest orderDate within the address group. Deterministic and
      // matches how the warehouse-shipments UI surfaces the anchor row.
      const anchorOrderDbId = groupOrderIds
        .map((id) => orderById.get(id)!)
        .sort(
          (a, b) => new Date(a.orderDate).getTime() - new Date(b.orderDate).getTime()
        )[0].id;

      const result: ShipmentResult = {
        addressKey,
        anchorOrderDbId,
        sourceOrderDbIds: groupOrderIds,
        ok: false,
      };

      try {
        // Sum units per (orderDbId, lineId) → composite items with real
        // sourceOrderId. The composite builder infers per-line source order
        // and validates same-address again internally.
        const qtyByOrderLine = new Map<string, { orderId: string; lineId: string; quantity: number }>();
        for (const e of entries) {
          if (!orderIdsSet.has(e.galaxusOrderDbId)) continue;
          const key = `${e.galaxusOrderDbId}|${e.galaxusOrderLineId}`;
          const prev = qtyByOrderLine.get(key);
          if (prev) {
            prev.quantity += 1;
          } else {
            qtyByOrderLine.set(key, {
              orderId: e.galaxusOrderDbId,
              lineId: e.galaxusOrderLineId,
              quantity: 1,
            });
          }
        }
        const items = Array.from(qtyByOrderLine.values()).map((v) => ({
          lineId: v.lineId,
          sourceOrderId: v.orderId,
          quantity: v.quantity,
        }));

        // Same call the /galaxus/warehouse-shipments "Create shipment" button
        // makes. `confirmReplace: true` mirrors the UI default (drops pending
        // MANUAL drafts on any of the source orders so items can be re-packed
        // on retry). Composite path reserves ONE SSCC, ONE delivery note, ONE
        // Swiss Post label; DELR fans out per-order downstream.
        const composite = await createCompositeWarehouseShipment({
          anchorOrderId: anchorOrderDbId,
          items,
          confirmReplace: true,
        });
        if (composite.status === "error") {
          result.error = composite.message ?? "Composite shipment failed";
          results.push(result);
          continue;
        }
        const shipment = composite.shipments[0] as any;
        if (!shipment?.id) {
          result.error = "Shipment not created";
          results.push(result);
          continue;
        }
        result.shipmentId = String(shipment.id);

        const fullShipment = await (prisma as any).shipment.findUnique({
          where: { id: shipment.id },
          include: { order: true },
        });
        if (!fullShipment?.order) {
          result.error = "Shipment lookup failed after create";
          results.push(result);
          continue;
        }

        // Mirrors POST /api/galaxus/shipments/[shipmentId]/post-label body.
        const trackingHint =
          String(fullShipment.trackingNumber ?? "").trim() ||
          String(fullShipment.order.galaxusOrderId ?? "").trim() ||
          `GALAXUS-${fullShipment.id}`;
        const swiss = await requestSwissPostLabelForOrderWithTrackingHint(
          fullShipment.order,
          trackingHint
        );
        if (!swiss.ok) {
          result.error = "Swiss Post label generation failed";
          results.push(result);
          continue;
        }
        const applied = await applySuccessfulSwissPostLabelToShipment(
          shipment.id,
          swiss.data
        );
        result.trackingNumber = applied.trackingNumber ?? null;
        result.delrStatus = applied.delr?.status ?? null;
        result.labelUrl = applied.url ?? (await resolveLatestShippingLabelUrl(shipment.id));
        result.ssccUrl = await resolveSsccLabelUrl(shipment.id);
        result.packingSlipUrl = await resolveLatestDeliveryNoteUrl(shipment.id);

        // LOCAL_STATION=1 → print Swiss Post label + SSCC via CUPS.
        if (localStation) {
          const payload = extractLabelPayload(swiss.data);
          if (payload?.base64) {
            const printResult = await maybePrintLabelLocally({
              base64: payload.base64,
              extension: payload.extension,
              jobName: `pack-${shipment.id}`,
              widthMm: browserPrintBase.widthMm,
              heightMm: browserPrintBase.heightMm,
            });
            result.labelPrintJobResult = printResult;
          }
          // Also CUPS-print the SSCC PDF when we have a stored labelPdfUrl.
          try {
            const ssccShipment = await prisma.shipment.findUnique({
              where: { id: shipment.id },
              select: { labelPdfUrl: true },
            });
            if (ssccShipment?.labelPdfUrl) {
              const { getStorageAdapterForUrl } = await import("@/galaxus/storage/storage");
              const storage = getStorageAdapterForUrl(ssccShipment.labelPdfUrl);
              const file = await storage.getPdf(ssccShipment.labelPdfUrl);
              const base64 = Buffer.from(file.content).toString("base64");
              await maybePrintLabelLocally({
                base64,
                extension: "pdf",
                jobName: `pack-sscc-${shipment.id}`,
                widthMm: browserPrintBase.widthMm,
                heightMm: browserPrintBase.heightMm,
              });
            }
          } catch (ssccPrintErr: any) {
            console.error("[SCAN][PACKING-SESSION][FINALIZE] SSCC local print failed", {
              shipmentId: shipment.id,
              error: ssccPrintErr?.message ?? String(ssccPrintErr),
            });
          }
        }

        result.ok = true;
        results.push(result);
      } catch (err: any) {
        console.error("[SCAN][PACKING-SESSION][FINALIZE] address-group failed", {
          addressKey,
          anchorOrderDbId,
          sourceOrderDbIds: groupOrderIds,
          error: err?.message ?? String(err),
        });
        result.error = err?.message || "Unknown error";
        results.push(result);
      }
    }

    const errorCount = results.filter((r) => !r.ok).length;
    return NextResponse.json({
      ok: errorCount === 0,
      results,
      errorCount,
      deliveryNoteRequirement,
    });
  } catch (error: any) {
    console.error("[SCAN][PACKING-SESSION][FINALIZE] Failed", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed" },
      { status: 500 }
    );
  }
}
