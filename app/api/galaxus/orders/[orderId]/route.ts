import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getShipmentPlacementByOrder } from "@/app/api/galaxus/shipments/_utils";
import { getStxLinkStatusForOrder } from "@/galaxus/stx/purchaseUnits";
import { parseOrderFromXml } from "@/galaxus/edi/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function repairOrderAddressesFromLatestOrdp(order: any) {
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
  if (!rawXml || typeof rawXml !== "string") return null;

  const parsed = parseOrderFromXml(rawXml, order.galaxusOrderId);
  const parsedStreet = parsed?.recipientAddress1 ? String(parsed.recipientAddress1).trim() : "";
  const parsedZip = parsed?.recipientPostalCode ? String(parsed.recipientPostalCode).trim() : "";
  const parsedCity = parsed?.recipientCity ? String(parsed.recipientCity).trim() : "";
  if (!parsedStreet || !parsedZip || !parsedCity) return null;

  const currentStreet = String(order?.recipientAddress1 ?? "").trim();
  const currentZip = String(order?.recipientPostalCode ?? "").trim();
  const currentCity = String(order?.recipientCity ?? "").trim();
  const parsedDeliveryPartyId = String((parsed as any)?.deliveryPartyId ?? "").trim();
  const currentDeliveryPartyId = String(order?.deliveryPartyId ?? "").trim();

  const needsUpdate =
    currentStreet !== parsedStreet ||
    currentZip !== parsedZip ||
    currentCity !== parsedCity ||
    (parsedDeliveryPartyId && currentDeliveryPartyId !== parsedDeliveryPartyId);

  if (!needsUpdate) return null;

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
      recipientPhone: order.deliveryType === "direct_delivery" ? null : (parsed as any).recipientPhone ?? null,
      deliveryPartyId: (parsed as any).deliveryPartyId ?? null,
    } as any,
  });

  return {
    updated,
    repairedFrom: { ediFileId: edi.id, filename: edi.filename, createdAt: edi.createdAt },
  };
}

function isStxSupplierLine(line: any): boolean {
  const supplierPid = String(line?.supplierPid ?? "").trim().toUpperCase();
  if (supplierPid.startsWith("STX_")) return true;
  const supplierVariantId = String(line?.supplierVariantId ?? "").trim().toLowerCase();
  if (supplierVariantId.startsWith("stx_")) return true;
  const providerKeyRaw = String(line?.providerKey ?? "").trim().toUpperCase();
  if (providerKeyRaw === "STX" || providerKeyRaw.startsWith("STX_")) return true;
  return false;
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
  productNameByGtin: Record<string, string>,
  catalogPriceByGtin: Record<string, number> = {}
) {
  const gtin = String(line?.gtin ?? "").trim();
  const nameFromGtin = gtin ? productNameByGtin[gtin] ?? "" : "";
  const sizeFromGtin = gtin ? sizeByGtin[gtin] ?? "" : "";
  const skuFromGtin = gtin ? skuByGtin[gtin] ?? "" : "";
  const sizeRawFromMap = gtin ? sizeRawByGtin[gtin] ?? "" : "";
  const catalogPrice = gtin ? catalogPriceByGtin[gtin] ?? null : null;

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

  return { ...line, productName, size, supplierSku, sizeRaw, catalogPrice };
}

function pickStxPurchaseUnitForLine(line: any, stxUnits: any[]) {
  const gtin = String(line?.gtin ?? "").trim();
  const sv = String(line?.supplierVariantId ?? "").trim();
  if (!gtin) return null;
  return (
    stxUnits.find(
      (u: any) =>
        String(u?.gtin ?? "") === gtin &&
        String(u?.supplierVariantId ?? "") === sv &&
        u?.stockxOrderId
    ) ?? stxUnits.find((u: any) => String(u?.gtin ?? "") === gtin && u?.stockxOrderId) ??
    null
  );
}

/** Per-line procurement: DB match rows (one per unit) and/or STX purchase units (sync + AWB). */
function attachProcurementToLines(lines: any[], stx: any, stockxMatches: any[], stxUnits: any[]) {
  const matchesByLineId = new Map<string, any[]>();
  for (const m of stockxMatches ?? []) {
    const lid = String(m?.galaxusOrderLineId ?? "").trim();
    if (!lid) continue;
    const arr = matchesByLineId.get(lid) ?? [];
    arr.push(m);
    matchesByLineId.set(lid, arr);
  }

  return lines.map((line) => {
    const gtin = String(line?.gtin ?? "").trim();
    const lineMatches = matchesByLineId.get(String(line?.id ?? "")) ?? [];
    const match = lineMatches[0] ?? null;
    const orderNum = match ? String(match.stockxOrderNumber ?? "").trim() : "";

    let ok = false;
    let source: "galaxus_match" | "stx_sync" | null = null;
    let stockxOrderNumber: string | null = orderNum || null;
    let stockxOrderId: string | null = null;
    let awb: string | null = null;
    let stockxCostChf: number | null = null;
    let stockxCostCurrency: string | null = null;

    if (orderNum) {
      ok = true;
      source = "galaxus_match";
      awb = match?.stockxAwb != null ? String(match.stockxAwb) : null;
      stockxOrderId = match?.stockxOrderId != null ? String(match.stockxOrderId).trim() || null : null;
      const amt = match?.stockxAmount != null ? Number(match.stockxAmount) : null;
      if (amt != null && Number.isFinite(amt)) {
        stockxCostChf = amt;
        stockxCostCurrency =
          match?.stockxCurrencyCode != null ? String(match.stockxCurrencyCode).trim() : null;
      }
      const unit = pickStxPurchaseUnitForLine(line, stxUnits);
      if (unit) {
        if (!awb && unit.awb != null) awb = String(unit.awb);
        if (!stockxOrderId && unit.stockxOrderId != null) stockxOrderId = String(unit.stockxOrderId);
        if (stockxCostChf == null && unit.stockxSettledAmount != null) {
          const n = Number(unit.stockxSettledAmount);
          if (Number.isFinite(n)) {
            stockxCostChf = n;
            stockxCostCurrency =
              unit.stockxSettledCurrency != null ? String(unit.stockxSettledCurrency).trim() : null;
          }
        }
      }
    } else if (gtin && stx?.buckets?.length && isStxSupplierLine(line)) {
      const sv = String(line?.supplierVariantId ?? "").trim();
      const bucket =
        stx.buckets.find((b: any) => String(b?.gtin ?? "") === gtin && String(b?.supplierVariantId ?? "") === sv) ??
        stx.buckets.find((b: any) => String(b?.gtin ?? "") === gtin);
      if (bucket && Number(bucket.needed) > 0 && Number(bucket.linked) >= Number(bucket.needed)) {
        ok = true;
        source = "stx_sync";
        const bu = stxUnits.find(
          (u: any) =>
            String(u?.gtin ?? "") === gtin &&
            String(u?.supplierVariantId ?? "") === String(bucket.supplierVariantId ?? "") &&
            u?.stockxOrderId
        );
        const buLoose = bu ?? stxUnits.find((u: any) => String(u?.gtin ?? "") === gtin && u?.stockxOrderId);
        stockxOrderId = buLoose?.stockxOrderId != null ? String(buLoose.stockxOrderId) : null;
        awb = buLoose?.awb != null ? String(buLoose.awb) : null;
        const numFromUnit =
          buLoose?.stockxSettledAmount != null ? Number(buLoose.stockxSettledAmount) : null;
        if (numFromUnit != null && Number.isFinite(numFromUnit)) {
          stockxCostChf = numFromUnit;
          stockxCostCurrency =
            buLoose?.stockxSettledCurrency != null
              ? String(buLoose.stockxSettledCurrency).trim()
              : null;
        }
        stockxOrderNumber =
          (buLoose?.stockxOrderNumber != null && String(buLoose.stockxOrderNumber).trim()) ||
          stockxOrderId;
      }
    }

    const qty = Math.max(Number(line.quantity ?? 1), 1);

    const relevantStxUnits = gtin
      ? stxUnits.filter((u: any) => String(u?.gtin ?? "") === gtin && u?.stockxOrderId && !u?.cancelledAt)
      : [];

    const units = Array.from({ length: qty }, (_, i) => {
      const unitMatch = lineMatches.find((m: any) => Number(m?.unitIndex ?? 0) === i) ?? null;
      if (unitMatch) {
        return {
          unitIndex: i,
          linked: true,
          source: "galaxus_match" as const,
          stockxOrderNumber: unitMatch.stockxOrderNumber ?? null,
          stockxOrderId: unitMatch.stockxOrderId ?? null,
          stockxAmount: unitMatch.stockxAmount != null ? Number(unitMatch.stockxAmount) : null,
          stockxCurrencyCode: unitMatch.stockxCurrencyCode ?? null,
          awb: unitMatch.stockxAwb ?? null,
        };
      }
      const stxUnit = relevantStxUnits[i] ?? null;
      if (stxUnit) {
        return {
          unitIndex: i,
          linked: true,
          source: "stx_sync" as const,
          stockxOrderNumber: stxUnit.stockxOrderNumber ?? stxUnit.stockxOrderId ?? null,
          stockxOrderId: stxUnit.stockxOrderId ?? null,
          stockxAmount: stxUnit.stockxSettledAmount != null ? Number(stxUnit.stockxSettledAmount) : null,
          stockxCurrencyCode: stxUnit.stockxSettledCurrency ?? null,
          awb: stxUnit.awb ?? null,
        };
      }
      return { unitIndex: i, linked: false, source: null as string | null };
    });
    const allLinked = units.every((u) => u.linked);
    const lineOk = allLinked || ok;

    return {
      ...line,
      procurement: {
        ok: lineOk,
        source: allLinked ? (units[0]?.source ?? source) : source,
        stockxOrderNumber,
        stockxOrderId,
        awb,
        stockxCostChf,
        stockxCostCurrency,
        units,
      },
    };
  });
}

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

    const repaired = await repairOrderAddressesFromLatestOrdp(order).catch(() => null);
    const orderRow = repaired?.updated
      ? ({
          ...(order as any),
          ...(repaired.updated as any),
        } as any)
      : order;

    const placement = await getShipmentPlacementByOrder(orderRow.id);
    const stx = await getStxLinkStatusForOrder(orderRow.galaxusOrderId).catch(() => null);
    const stxUnits = await (prisma as any).stxPurchaseUnit
      .findMany({
        where: {
          galaxusOrderId: orderRow.galaxusOrderId,
          supplierVariantId: { startsWith: "stx_" },
        },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          createdAt: true,
          updatedAt: true,
          gtin: true,
          supplierVariantId: true,
          stockxOrderId: true,
          stockxOrderNumber: true,
          stockxSettledAmount: true,
          stockxSettledCurrency: true,
          awb: true,
          etaMin: true,
          etaMax: true,
          checkoutType: true,
          manualTrackingRaw: true,
          manualNote: true,
          manualSetAt: true,
          cancelledAt: true,
          cancelledReason: true,
        },
      })
      .catch(() => []);
    const orderLineIds = (orderRow.lines ?? []).map((line: any) => line.id);
    const stockxMatches = (prisma as any).galaxusStockxMatch?.findMany
      ? await (prisma as any).galaxusStockxMatch
          .findMany({
            where: {
              galaxusOrderId: orderRow.id,
              galaxusOrderLineId: { in: orderLineIds },
            },
            orderBy: { updatedAt: "desc" },
          })
          .catch(() => [])
      : [];
    const lineGtins: string[] = Array.from(
      new Set<string>(
        (orderRow.lines ?? [])
          .map((line: any) => String(line.gtin ?? "").trim())
          .filter((gtin: string) => gtin.length > 0)
      )
    );
    const gtinQueryKeys = expandGtinQueryVariants(lineGtins);
    const skuByGtin: Record<string, string> = {};
    const sizeByGtin: Record<string, string> = {};
    const sizeRawByGtin: Record<string, string> = {};
    const productNameByGtin: Record<string, string> = {};
    const catalogPriceByGtin: Record<string, number> = {};
    if (gtinQueryKeys.length > 0) {
      const supplierVariantIdsFromLines = Array.from(
        new Set(
          (orderRow.lines as any[]).flatMap((line: any) => {
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
      for (const line of orderRow.lines as any[]) {
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
            const line = (orderRow.lines as any[]).find(
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
        if (catalogPriceByGtin[canon] == null) {
          const p = Number(mapping?.supplierVariant?.price);
          if (Number.isFinite(p) && p > 0) catalogPriceByGtin[canon] = p;
        }
      }
    }
    const pickLatest = (docs: any[]) => {
      if (!docs.length) return null;
      return docs
        .slice()
        .sort((a, b) => {
          const av = Number(a?.version ?? 0);
          const bv = Number(b?.version ?? 0);
          if (av !== bv) return bv - av;
          const at = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
          const bt = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
          return bt - at;
        })[0];
    };

    const enrichedLines = (orderRow.lines ?? []).map((line: any) =>
      enrichGalaxusOrderLine(line, skuByGtin, sizeByGtin, sizeRawByGtin, productNameByGtin, catalogPriceByGtin)
    );
    const linesWithProcurement = attachProcurementToLines(enrichedLines, stx, stockxMatches, stxUnits);

    const normalized = {
      ...orderRow,
      lines: linesWithProcurement,
      stx,
      stxUnits,
      stockxMatches,
      shipments: orderRow.shipments.map((shipment: any) => {
        const isStxShipment = String(shipment?.providerKey ?? "").toUpperCase() === "STX";
        const stxShipmentStatus = isStxShipment
          ? stx
            ? ({
                ...stx,
                buckets: (stx?.buckets ?? []).filter((bucket: any) =>
                  (shipment.items ?? []).some(
                    (it: any) => String(it?.gtin14 ?? "").trim() === String(bucket?.gtin ?? "").trim()
                  )
                ),
              } as any)
            : null
          : null;
        const deliveryNotes = (shipment.documents ?? []).filter((doc: any) => doc.type === "DELIVERY_NOTE");
        const deliveryNote = pickLatest(deliveryNotes);
        const labelDocs = (shipment.documents ?? []).filter((doc: any) => doc.type === "LABEL");
        const ssccLabelDoc = pickLatest(
          labelDocs.filter(
            (doc: any) => typeof doc.storageUrl === "string" && !doc.storageUrl.includes("shipping-labels")
          )
        );
        const shippingLabelDoc = pickLatest(
          labelDocs.filter(
            (doc: any) => typeof doc.storageUrl === "string" && doc.storageUrl.includes("shipping-labels")
          )
        );
        const labelDocCreatedAt = ssccLabelDoc?.createdAt ? new Date(ssccLabelDoc.createdAt).getTime() : 0;
        const shipmentLabelCreatedAt = shipment.labelGeneratedAt
          ? new Date(shipment.labelGeneratedAt).getTime()
          : 0;
        const preferShipmentLabel = shipmentLabelCreatedAt > labelDocCreatedAt;
        const extra = placement.get(shipment.id);
        return {
          ...shipment,
          supplierOrderRef: extra?.supplierOrderRef ?? null,
          boxStatus: extra?.status ?? null,
          stx: stxShipmentStatus,
          deliveryNotePdfUrl: deliveryNote ? `/api/galaxus/documents/${deliveryNote.id}` : null,
          labelPdfUrl: ssccLabelDoc
            ? preferShipmentLabel
              ? `/api/galaxus/shipments/${shipment.id}/label`
              : `/api/galaxus/documents/${ssccLabelDoc.id}`
            : shipment.labelPdfUrl
              ? `/api/galaxus/shipments/${shipment.id}/label`
              : null,
          shippingLabelPdfUrl: shippingLabelDoc ? `/api/galaxus/documents/${shippingLabelDoc.id}` : null,
        };
      }),
    };

    if (String(orderRow.deliveryType ?? "").toLowerCase() === "direct_delivery") {
      const invoiceFile = await prisma.galaxusEdiFile.findFirst({
        where: {
          orderId: orderRow.id,
          direction: "OUT",
          docType: "INVO",
          status: "uploaded",
        },
        orderBy: { createdAt: "desc" },
        select: { filename: true, createdAt: true },
      });
      const minimalLines = linesWithProcurement.map((line: any) => ({
        id: line.id,
        lineNumber: line.lineNumber,
        supplierPid: line.supplierPid ?? null,
        gtin: line.gtin ?? null,
        quantity: line.quantity,
        priceLineAmount: line.priceLineAmount ?? line.lineNetAmount ?? null,
        lineNetAmount: line.lineNetAmount ?? null,
        productName: line.productName ?? null,
        size: line.size ?? null,
        sizeRaw: line.sizeRaw ?? null,
        supplierSku: line.supplierSku ?? null,
        buyerPid: line.buyerPid ?? null,
        warehouseMarkedShippedAt: line.warehouseMarkedShippedAt ?? null,
        procurement: line.procurement ?? { ok: false, source: null, stockxOrderNumber: null, stockxOrderId: null, awb: null },
      }));
      const minimalShipments = (normalized.shipments ?? []).map((shipment: any) => ({
        id: shipment.id,
        trackingNumber: shipment.trackingNumber ?? null,
        carrierFinal: shipment.carrierFinal ?? null,
        delrStatus: shipment.delrStatus ?? null,
        delrSentAt: shipment.delrSentAt ?? null,
      }));
      return NextResponse.json({
        ok: true,
        order: {
          id: orderRow.id,
          galaxusOrderId: orderRow.galaxusOrderId,
          orderDate: orderRow.orderDate,
          orderNumber: orderRow.orderNumber ?? null,
          currencyCode: orderRow.currencyCode,
          deliveryType: orderRow.deliveryType ?? null,
          recipientName: orderRow.recipientName ?? null,
          recipientAddress1: orderRow.recipientAddress1 ?? null,
          recipientAddress2: orderRow.recipientAddress2 ?? null,
          recipientPostalCode: orderRow.recipientPostalCode ?? null,
          recipientCity: orderRow.recipientCity ?? null,
          recipientCountry: orderRow.recipientCountry ?? null,
          recipientCountryCode: orderRow.recipientCountryCode ?? null,
          ordrSentAt: orderRow.ordrSentAt ?? null,
          ordrStatus: orderRow.ordrStatus ?? null,
          invoiceStatus: Boolean(invoiceFile),
          invoiceFileName: invoiceFile?.filename ?? null,
          invoiceSentAt: invoiceFile?.createdAt ?? null,
          stockxMatches,
          shipments: minimalShipments,
          lines: minimalLines,
        },
        ...(repaired?.repairedFrom ? { repairedFromOrdp: repaired.repairedFrom } : {}),
      });
    }

    return NextResponse.json({
      ok: true,
      order: normalized,
      ...(repaired?.repairedFrom ? { repairedFromOrdp: repaired.repairedFrom } : {}),
    });
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
