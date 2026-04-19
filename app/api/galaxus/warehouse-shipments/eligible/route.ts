import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getInvoicedQuantitiesByOrderLineId } from "@/galaxus/edi/invoiceCoverage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ShipmentCoverage = {
  ordered: number;
  shipped: number;
  reserved: number;
  remaining: number;
};

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function isDirectDelivery(order: { deliveryType?: string | null }): boolean {
  return normalizeText(order.deliveryType).toLowerCase() === "direct_delivery";
}

function shipmentIsReserved(item: {
  shipment?: { delrSentAt?: Date | null; delrStatus?: string | null; status?: string | null } | null;
}): boolean {
  const status = normalizeText(item.shipment?.status).toUpperCase();
  const delrStatus = normalizeText(item.shipment?.delrStatus).toUpperCase();
  if (status !== "MANUAL") return false;
  if (item.shipment?.delrSentAt) return false;
  if (delrStatus === "UPLOADED" || delrStatus === "SENT") return false;
  return true;
}

function shipmentIsFinalized(item: {
  shipment?: { delrSentAt?: Date | null; delrStatus?: string | null } | null;
}): boolean {
  const delrStatus = normalizeText(item.shipment?.delrStatus).toUpperCase();
  return Boolean(item.shipment?.delrSentAt) || delrStatus === "UPLOADED" || delrStatus === "SENT";
}

function digitsOnlyGtin(s: string): string {
  return String(s ?? "").replace(/\D/g, "");
}

/** True when two GTIN strings refer to the same article (EAN-13 vs GTIN-14 / leading zeros). */
function sameGtinKey(a: string, b: string): boolean {
  const da = digitsOnlyGtin(a);
  const db = digitsOnlyGtin(b);
  if (!da || !db) return false;
  if (da === db) return true;
  const na = da.padStart(14, "0").slice(-14);
  const nb = db.padStart(14, "0").slice(-14);
  return na === nb;
}

/** Map a mapping row's gtin to the exact gtin string stored on the order line (for record keys). */
function resolveCanonicalLineGtin(mappingGtin: string, lineGtins: string[]): string | null {
  const m = String(mappingGtin ?? "").trim();
  if (!m) return null;
  for (const lg of lineGtins) {
    if (sameGtinKey(lg, m)) return lg;
  }
  return null;
}

/** All strings to query in VariantMapping.gtin (DB may store 12/13/14-digit forms). */
function expandGtinQueryVariants(lineGtins: string[]): string[] {
  const out = new Set<string>();
  for (const raw of lineGtins) {
    const t = String(raw ?? "").trim();
    if (!t) continue;
    out.add(t);
    const d = digitsOnlyGtin(t);
    if (!d) continue;
    out.add(d);
    out.add(d.padStart(14, "0"));
    out.add(d.padStart(13, "0"));
    const strip = d.replace(/^0+/, "") || "0";
    out.add(strip);
    if (strip !== d) out.add(strip.padStart(14, "0"));
  }
  return Array.from(out).filter((s) => s.length > 0);
}

/** Merge GTIN lookup into line fields; keeps JSON flat (no parallel *Resolved / *ByGtin maps). */
function enrichGalaxusOrderLine(
  line: any,
  skuByGtin: Record<string, string>,
  sizeByGtin: Record<string, string>,
  sizeRawByGtin: Record<string, string>,
  productNameByGtin: Record<string, string>
) {
  const gtin = String(line?.gtin ?? "").trim();
  const nameFromGtin = gtin ? productNameByGtin[gtin] ?? "" : "";
  const sizeFromGtin = gtin ? sizeByGtin[gtin] ?? "" : "";
  const skuFromGtin = gtin ? skuByGtin[gtin] ?? "" : "";
  const sizeRawFromMap = gtin ? sizeRawByGtin[gtin] ?? "" : "";

  const desc = line.description ? String(line.description).trim() : "";
  const rawName = line.productName ? String(line.productName).trim() : "";

  const productName =
    (nameFromGtin && nameFromGtin.trim()) ||
    desc ||
    (rawName && rawName !== "Item" ? rawName : "") ||
    rawName ||
    null;

  const size = (sizeFromGtin && String(sizeFromGtin).trim()) || line.size || null;
  const supplierSku = (skuFromGtin && String(skuFromGtin).trim()) || line.supplierSku || null;
  const sizeRaw =
    (sizeRawFromMap && String(sizeRawFromMap).trim()) || (line.size ? String(line.size).trim() : null) || null;

  return { ...line, productName, size, supplierSku, sizeRaw };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const anchorRaw = normalizeText(searchParams.get("anchorOrderId"));
    if (!anchorRaw) {
      return NextResponse.json({ ok: false, error: "anchorOrderId is required" }, { status: 400 });
    }

    const anchor =
      (await prisma.galaxusOrder.findUnique({
        where: { id: anchorRaw },
        include: { lines: true },
      })) ??
      (await prisma.galaxusOrder.findUnique({
        where: { galaxusOrderId: anchorRaw },
        include: { lines: true },
      }));

    if (!anchor) {
      return NextResponse.json({ ok: false, error: "Anchor order not found" }, { status: 404 });
    }

    if (anchor.archivedAt || anchor.cancelledAt) {
      return NextResponse.json({ ok: false, error: "Anchor order is archived or cancelled" }, { status: 400 });
    }

    if (isDirectDelivery(anchor)) {
      return NextResponse.json({ ok: false, error: "Anchor order must be warehouse delivery" }, { status: 400 });
    }

    const recipientPostalCode = normalizeText(anchor.recipientPostalCode);
    const recipientAddress1 = normalizeText(anchor.recipientAddress1);
    const recipientCity = normalizeText(anchor.recipientCity);
    if (!recipientPostalCode || !recipientAddress1 || !recipientCity) {
      return NextResponse.json(
        { ok: false, error: "Anchor order has no delivery address to match" },
        { status: 400 }
      );
    }

    const orders = await prisma.galaxusOrder.findMany({
      where: {
        archivedAt: null,
        cancelledAt: null,
        deliveryType: { not: "direct_delivery" },
        recipientPostalCode,
        recipientAddress1,
        recipientCity,
      },
      orderBy: { orderDate: "desc" },
      include: { lines: true },
    });

    const ordersWithAnchor = orders.some((o) => o.id === anchor.id) ? orders : [anchor, ...orders];
    const orderIds = ordersWithAnchor.map((o) => o.id);

    const invoiceCoverage: Record<string, { ordered: number; invoiced: number }> = {};
    await Promise.all(
      ordersWithAnchor.map(async (order) => {
        const lines = order.lines.map((line) => ({
          id: line.id,
          quantity: line.quantity,
          lineNumber: line.lineNumber,
          buyerPid: line.buyerPid,
          supplierPid: line.supplierPid,
          gtin: line.gtin,
        }));
        const invoiced = await getInvoicedQuantitiesByOrderLineId(order.id, lines as any);
        for (const line of lines) {
          const orderedQty = Number(line.quantity ?? 0);
          invoiceCoverage[line.id] = {
            ordered: Number.isFinite(orderedQty) ? orderedQty : 0,
            invoiced: invoiced.get(line.id) ?? 0,
          };
        }
      })
    );

    const shipmentCoverage: Record<string, ShipmentCoverage> = {};
    const existingItems = await (prisma as any).shipmentItem.findMany({
      where: { orderId: { in: orderIds } },
      select: {
        orderId: true,
        supplierPid: true,
        gtin14: true,
        quantity: true,
        shipment: {
          select: { delrSentAt: true, delrStatus: true, status: true },
        },
      },
    });

    for (const order of ordersWithAnchor) {
      for (const line of order.lines ?? []) {
        const lineId = String(line.id);
        const supplierPid = normalizeText(line.supplierPid);
        const gtin = normalizeText(line.gtin);
        const orderedQty = Number(line.quantity ?? 0);
        const markedShipped = Boolean(line?.warehouseMarkedShippedAt);
        const shipped = existingItems
          .filter((item: any) => {
            const sameLine =
              String(item?.orderId ?? "") === String(order.id) &&
              normalizeText(item?.supplierPid) === supplierPid &&
              normalizeText(item?.gtin14) === gtin;
            return sameLine && shipmentIsFinalized(item);
          })
          .reduce((acc: number, item: any) => acc + Math.max(0, Number(item?.quantity ?? 0)), 0);
        const reserved = existingItems
          .filter((item: any) => {
            const sameLine =
              String(item?.orderId ?? "") === String(order.id) &&
              normalizeText(item?.supplierPid) === supplierPid &&
              normalizeText(item?.gtin14) === gtin;
            return sameLine && shipmentIsReserved(item);
          })
          .reduce((acc: number, item: any) => acc + Math.max(0, Number(item?.quantity ?? 0)), 0);
        const ordered = Number.isFinite(orderedQty) ? orderedQty : 0;
        const shippedFinal = markedShipped ? Math.max(shipped, ordered) : shipped;
        shipmentCoverage[lineId] = {
          ordered,
          shipped: shippedFinal,
          reserved,
          remaining: Math.max(0, ordered - shippedFinal - reserved),
        };
      }
    }

    const allLines = ordersWithAnchor.flatMap((order) => order.lines ?? []);
    const lineGtins: string[] = Array.from(
      new Set<string>(
        allLines.map((line: any) => String(line?.gtin ?? "").trim()).filter((gtin: string) => gtin.length > 0)
      )
    );
    const gtinQueryKeys = expandGtinQueryVariants(lineGtins);
    const skuByGtin: Record<string, string> = {};
    const sizeByGtin: Record<string, string> = {};
    const sizeRawByGtin: Record<string, string> = {};
    const productNameByGtin: Record<string, string> = {};
    if (gtinQueryKeys.length > 0) {
      const supplierVariantIdsFromLines = Array.from(
        new Set(
          allLines.flatMap((line: any) => {
            const ids: string[] = [];
            const sv = String(line?.supplierVariantId ?? "").trim();
            if (sv) ids.push(sv);
            const sp = String(line?.supplierPid ?? "").trim();
            if (sp && /^[A-Za-z][A-Za-z0-9]*[_:]/.test(sp)) ids.push(sp);
            return ids;
          })
        )
      );
      const byGtin = await (prisma as any).variantMapping.findMany({
        where: { gtin: { in: gtinQueryKeys } },
        include: { supplierVariant: true, kickdbVariant: { include: { product: true } } },
        orderBy: { updatedAt: "desc" },
      });
      const bySupplierVariantId =
        supplierVariantIdsFromLines.length > 0
          ? await (prisma as any).variantMapping.findMany({
              where: { supplierVariantId: { in: supplierVariantIdsFromLines } },
              include: { supplierVariant: true, kickdbVariant: { include: { product: true } } },
              orderBy: { updatedAt: "desc" },
            })
          : [];
      const seenMappingId = new Set<string>();
      const mappings: any[] = [];
      for (const m of [...byGtin, ...bySupplierVariantId]) {
        const id = String(m?.id ?? "");
        if (!id || seenMappingId.has(id)) continue;
        seenMappingId.add(id);
        mappings.push(m);
      }
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
      const preferredKeyByCanonical = new Map<string, string>();
      for (const line of allLines as any[]) {
        const gtin = String(line?.gtin ?? "").trim();
        if (!gtin) continue;
        if (!preferredKeyByCanonical.has(gtin)) {
          const key = supplierKeyFromPid(line?.supplierPid ?? null);
          if (key) preferredKeyByCanonical.set(gtin, key);
        }
      }

      type MappingRow = { mapping: any; canon: string; prefMatch: boolean; updatedAt: number };
      const rows: MappingRow[] = [];
      for (const mapping of mappings) {
        let canon = resolveCanonicalLineGtin(String(mapping?.gtin ?? ""), lineGtins);
        if (!canon) {
          const svid = String(mapping?.supplierVariantId ?? "").trim();
          if (svid) {
            const line = (allLines as any[]).find(
              (l) =>
                String(l?.supplierVariantId ?? "").trim() === svid ||
                String(l?.supplierPid ?? "").trim() === svid
            );
            const g = line ? String(line?.gtin ?? "").trim() : "";
            if (g) canon = g;
          }
        }
        if (!canon) continue;
        const preferredKey = preferredKeyByCanonical.get(canon) ?? null;
        const key = mappingKey(mapping);
        const prefMatch = !(preferredKey && key && preferredKey !== key);
        const updatedAt = mapping?.updatedAt ? new Date(mapping.updatedAt).getTime() : 0;
        rows.push({ mapping, canon, prefMatch, updatedAt });
      }
      rows.sort((a, b) => {
        if (a.prefMatch !== b.prefMatch) return a.prefMatch ? -1 : 1;
        return b.updatedAt - a.updatedAt;
      });

      for (const { mapping, canon } of rows) {
        if (!skuByGtin[canon]) {
          const sku = String(mapping?.supplierVariant?.supplierSku ?? "").trim();
          if (sku) skuByGtin[canon] = sku;
        }
        if (!sizeRawByGtin[canon]) {
          const rawOnly = String(mapping?.supplierVariant?.sizeRaw ?? "").trim();
          if (rawOnly) sizeRawByGtin[canon] = rawOnly;
        }
        if (!sizeByGtin[canon]) {
          const size =
            String(mapping?.supplierVariant?.sizeRaw ?? "").trim() ||
            String(mapping?.supplierVariant?.sizeNormalized ?? "").trim() ||
            String(mapping?.kickdbVariant?.sizeEu ?? "").trim();
          if (size) sizeByGtin[canon] = size;
        }
        if (!productNameByGtin[canon]) {
          const supplierName = String(mapping?.supplierVariant?.supplierProductName ?? "").trim();
          if (supplierName) {
            productNameByGtin[canon] = supplierName;
          } else {
            const kickdbName = String(mapping?.kickdbVariant?.product?.name ?? "").trim();
            if (kickdbName) productNameByGtin[canon] = kickdbName;
          }
        }
      }
    }

    const enrichedLinesById = new Map<string, any>();
    for (const line of allLines as any[]) {
      const enriched = enrichGalaxusOrderLine(line, skuByGtin, sizeByGtin, sizeRawByGtin, productNameByGtin);
      enrichedLinesById.set(String(line.id), enriched);
    }

    const orderPayload = ordersWithAnchor.map((order) => ({
      id: order.id,
      galaxusOrderId: order.galaxusOrderId,
      orderNumber: order.orderNumber ?? null,
      orderDate: order.orderDate,
      deliveryType: order.deliveryType ?? null,
      currencyCode: order.currencyCode ?? null,
      recipientName: order.recipientName ?? null,
      recipientAddress1: order.recipientAddress1 ?? null,
      recipientPostalCode: order.recipientPostalCode ?? null,
      recipientCity: order.recipientCity ?? null,
      lines: (order.lines ?? []).map((line) => {
        const enriched = enrichedLinesById.get(String(line.id)) ?? line;
        return {
          id: enriched.id,
          lineNumber: enriched.lineNumber ?? null,
          supplierPid: enriched.supplierPid ?? null,
          buyerPid: enriched.buyerPid ?? null,
          gtin: enriched.gtin ?? null,
          quantity: enriched.quantity,
          unitNetPrice: enriched.unitNetPrice ?? null,
          priceLineAmount: enriched.priceLineAmount ?? null,
          lineNetAmount: enriched.lineNetAmount ?? null,
          description: enriched.description ?? null,
          productName: enriched.productName ?? null,
          size: enriched.size ?? null,
          sizeRaw: enriched.sizeRaw ?? null,
          supplierSku: enriched.supplierSku ?? null,
          orderUnit: enriched.orderUnit ?? null,
        };
      }),
    }));

    const draftShipments = await prisma.shipment.findMany({
      where: {
        orderId: anchor.id,
        status: "MANUAL",
        delrSentAt: null,
        OR: [{ delrStatus: null }, { delrStatus: "PENDING" }, { delrStatus: "ERROR" }],
      },
      include: {
        items: { include: { order: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const draftPayload = draftShipments.map((shipment) => {
      const orderNumbers = Array.from(
        new Set(
          (shipment.items ?? [])
            .map((item: any) => item.order?.orderNumber ?? item.order?.galaxusOrderId)
            .filter(Boolean)
        )
      );
      return {
        id: shipment.id,
        shipmentId: shipment.shipmentId,
        dispatchNotificationId: shipment.dispatchNotificationId,
        packageId: shipment.packageId,
        trackingNumber: shipment.trackingNumber ?? null,
        delrStatus: shipment.delrStatus ?? null,
        createdAt: shipment.createdAt,
        orderNumbers,
        itemCount: (shipment.items ?? []).length,
      };
    });

    return NextResponse.json({
      ok: true,
      anchorOrderId: anchor.id,
      orders: orderPayload,
      invoiceCoverage,
      shipmentCoverage,
      draftShipments: draftPayload,
    });
  } catch (error: any) {
    console.error("[GALAXUS][WAREHOUSE][ELIGIBLE] Failed:", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Failed" }, { status: 500 });
  }
}
