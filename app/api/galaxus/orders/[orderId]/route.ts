import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getShipmentPlacementByOrder } from "@/app/api/galaxus/shipments/_utils";
import { getStxLinkStatusForOrder } from "@/galaxus/stx/purchaseUnits";
import { digitsOnlyGtin, sameGtinKey } from "@/galaxus/orders/gtinKey";
import { attachProcurementToLines } from "@/galaxus/orders/lineProcurement";
import { reconcileGalaxusOrderProcurement } from "@/galaxus/orders/galaxusProcurementReconcile";
import {
  isGalaxusStxSupplierLine,
  resolveGalaxusLineOfferSupplierSku,
} from "@/galaxus/warehouse/lineInventorySource";
import { enrichBuySourceOverrideCosts } from "@/galaxus/warehouse/enrichBuySourceOverrideCosts";
import { parseOrderFromXml } from "@/galaxus/edi/service";
import {
  attachPhysicalStockToLines,
  buildPhysicalStockByGtinMap,
} from "@/shopify/inventory/orderLinePhysicalStock";
import { isLegoStxProduct } from "@/galaxus/stx/legoProduct";
import {
  ensureLocalStockMatchesForOrder,
  mergeReservedPhysicalStockOntoLines,
} from "@/galaxus/orders/localStockMatch";
import { resolveOrderLineProductKey } from "@/galaxus/supplier/providerKey";
import { supplierKeyFromVariantId } from "@/galaxus/supplier/supplierKeyGuards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resolveOrderLineSupplierKey(line: {
  supplierVariantId?: string | null;
  supplierPid?: string | null;
  providerKey?: string | null;
}): string | null {
  const fromVariant = supplierKeyFromVariantId(line.supplierVariantId);
  if (fromVariant) return fromVariant;
  const fromPid = supplierKeyFromVariantId(line.supplierPid);
  if (fromPid) return fromPid;
  const fromProvider = supplierKeyFromVariantId(line.providerKey);
  return fromProvider || null;
}

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
    out.add(d.padStart(12, "0"));
    const strip = d.replace(/^0+/, "") || "0";
    out.add(strip);
    if (strip !== d) {
      out.add(strip.padStart(14, "0"));
      out.add(strip.padStart(13, "0"));
      out.add(strip.padStart(12, "0"));
    }
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
  const rawLineSku = String(line?.supplierSku ?? "").trim();
  const skuFromCat = skuFromGtin ? String(skuFromGtin).trim() : "";
  const styleSku = skuFromCat || null;
  const offerSupplierSku = resolveGalaxusLineOfferSupplierSku(line);
  /** Display: catalog style SKU when known; warehouse NER/THE detection uses offerSupplierSku. */
  const supplierSku = styleSku || offerSupplierSku || null;
  const sizeRaw =
    (sizeRawFromMap && String(sizeRawFromMap).trim()) || (line.size ? String(line.size).trim() : null) || null;

  return { ...line, productName, size, supplierSku, styleSku, offerSupplierSku, sizeRaw, catalogPrice };
}

function toPositiveNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function selectCatalogDisplayBuyPrice(mapping: any): number | null {
  const supplierVariant = mapping?.supplierVariant ?? null;
  if (!supplierVariant) return null;
  const providerKey = String(supplierVariant?.providerKey ?? "").trim().toUpperCase();
  const supplierVariantId = String(supplierVariant?.supplierVariantId ?? "").trim().toLowerCase();
  const isStx = providerKey.startsWith("STX_") || supplierVariantId.startsWith("stx_");
  const base = toPositiveNumber(supplierVariant?.price);
  if (!isStx) return base;

  const kickdbProduct = mapping?.kickdbVariant?.product ?? null;
  const supplierName = String(supplierVariant?.supplierProductName ?? "").trim();
  const stxIsLego = isLegoStxProduct({
    slug: kickdbProduct?.urlKey ?? null,
    name: kickdbProduct?.name ?? supplierName,
  });
  const standard = toPositiveNumber(supplierVariant?.standardBuyPrice);
  const express = toPositiveNumber(supplierVariant?.expressBuyPrice);

  if (stxIsLego) return standard ?? base ?? express;
  return express ?? base ?? standard;
}

const shipmentDocumentSelect = {
  id: true,
  type: true,
  storageUrl: true,
  version: true,
  createdAt: true,
} as const;

async function loadGalaxusOrderShipments(orderDbId: string, includeDocuments: boolean) {
  return prisma.shipment.findMany({
    where: { orderId: orderDbId },
    include: {
      items: true,
      ...(includeDocuments ? { documents: { select: shipmentDocumentSelect } } : {}),
    },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;
    const { searchParams } = new URL(request.url);
    const view = String(searchParams.get("view") ?? "full").trim().toLowerCase();
    const viewFull = view !== "minimal";
    const ensureLocal = searchParams.get("ensureLocal") !== "0";
    const reserveStx = searchParams.get("reserveStx") !== "0";
    const supplierScope = String(searchParams.get("supplierScope") ?? "").trim().toLowerCase();
    const stxOnly = supplierScope === "stx";

    const order = await prisma.galaxusOrder.findFirst({
      where: { OR: [{ id: orderId }, { galaxusOrderId: orderId }] },
      include: {
        lines: true,
        ...(viewFull ? { statusEvents: true, ediFiles: true } : {}),
      },
    });

    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }

    const isDirectDelivery = String(order.deliveryType ?? "").toLowerCase() === "direct_delivery";
    (order as any).shipments =
      viewFull || isDirectDelivery
        ? await loadGalaxusOrderShipments(order.id, viewFull || isDirectDelivery)
        : [];

    const repaired =
      viewFull ? await repairOrderAddressesFromLatestOrdp(order).catch(() => null) : null;
    const orderRow = repaired?.updated
      ? ({
          ...(order as any),
          ...(repaired.updated as any),
          shipments: (order as any).shipments,
        } as any)
      : order;

    // Optional read-path optimization: some UIs only need display data, not read-time reservation writes.
    if (reserveStx) {
      // Restore match rows from surviving StxPurchaseUnit links (ORDP cascade survivors).
      // skipAutoLink: never buy/link on a read path — only remount persisted green.
      await reconcileGalaxusOrderProcurement(orderRow.galaxusOrderId, { skipAutoLink: true }).catch(
        (err) => {
          console.warn("[GALAXUS][ORDERS] procurement reconcile skipped:", err?.message ?? err);
        }
      );
    }

    const orderLineIds = (orderRow.lines ?? []).map((line: any) => line.id);
    const lineGtins: string[] = Array.from(
      new Set<string>(
        (orderRow.lines ?? [])
          .map((line: any) => String(line.gtin ?? "").trim())
          .filter((gtin: string) => gtin.length > 0)
      )
    );
    const gtinQueryKeys = expandGtinQueryVariants(lineGtins);
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

    const prismaAny = prisma as any;
    const [placement, stx, stxUnits, stockxMatches, mappingsRaw, externalBuys] = await Promise.all([
      getShipmentPlacementByOrder(orderRow.id),
      getStxLinkStatusForOrder(orderRow.galaxusOrderId, orderRow).catch(() => null),
      prismaAny.stxPurchaseUnit
        .findMany({
          where: {
            galaxusOrderId: orderRow.galaxusOrderId,
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
        .catch(() => []),
      prismaAny.galaxusStockxMatch?.findMany
        ? prismaAny.galaxusStockxMatch
            .findMany({
              where: {
                galaxusOrderId: orderRow.id,
                galaxusOrderLineId: { in: orderLineIds },
              },
              orderBy: { updatedAt: "desc" },
            })
            .catch(() => [])
        : Promise.resolve([]),
      gtinQueryKeys.length > 0 || supplierVariantIdsFromLines.length > 0
        ? prismaAny.variantMapping
            .findMany({
              where: {
                OR: [
                  gtinQueryKeys.length > 0 ? { gtin: { in: gtinQueryKeys } } : undefined,
                  supplierVariantIdsFromLines.length > 0
                    ? { supplierVariantId: { in: supplierVariantIdsFromLines } }
                    : undefined,
                ].filter(Boolean),
              },
              include: { supplierVariant: true, kickdbVariant: { include: { product: true } } },
              orderBy: { updatedAt: "desc" },
            })
            .catch(() => [])
        : Promise.resolve([]),
      prismaAny.galaxusExternalBuy?.findMany
        ? prismaAny.galaxusExternalBuy
            .findMany({
              where: { galaxusOrderId: orderRow.id, cancelledAt: null },
              orderBy: [{ galaxusOrderLineId: "asc" }, { unitIndex: "asc" }],
            })
            .catch(() => [])
        : Promise.resolve([]),
    ]);
    const skuByGtin: Record<string, string> = {};
    const sizeByGtin: Record<string, string> = {};
    const sizeRawByGtin: Record<string, string> = {};
    const productNameByGtin: Record<string, string> = {};
    const catalogPriceByGtin: Record<string, number> = {};
    const mappings = Array.isArray(mappingsRaw) ? mappingsRaw : [];
    if (mappings.length > 0) {
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
          const p = selectCatalogDisplayBuyPrice(mapping);
          if (p != null && Number.isFinite(p) && p > 0) catalogPriceByGtin[canon] = p;
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
    const physicalStockByGtin = await buildPhysicalStockByGtinMap(
      enrichedLines.map((line: { gtin?: string | null }) => line.gtin)
    );
    const linesWithLivePhysical = attachPhysicalStockToLines(enrichedLines, physicalStockByGtin);
    const localEnsure = ensureLocal
      ? await ensureLocalStockMatchesForOrder({
          order: { ...orderRow, lines: linesWithLivePhysical },
          reason: "LOCAL_PHYSICAL_STOCK_ON_ORDER_FETCH",
        })
      : { created: 0 };
    let matchesForResponse = stockxMatches;
    if (localEnsure.created > 0) {
      matchesForResponse = await (prisma as any).galaxusStockxMatch.findMany({
        where: { galaxusOrderId: orderRow.id },
        orderBy: [{ galaxusOrderLineId: "asc" }, { unitIndex: "asc" }],
      });
    }
    // LOCAL_STOCK match carries sold-from location after mirror qty hits 0.
    const linesWithPhysicalStock = mergeReservedPhysicalStockOntoLines(
      linesWithLivePhysical,
      matchesForResponse
    );
    const linesWithProcurement = (
      await enrichBuySourceOverrideCosts(
        attachProcurementToLines(
          linesWithPhysicalStock,
          stx,
          matchesForResponse,
          stxUnits,
          Array.isArray(externalBuys) ? externalBuys : []
        )
      )
    ).map((line: any) => {
      const productKey = resolveOrderLineProductKey(line);
      return {
        ...line,
        supplierKey: resolveOrderLineSupplierKey(line),
        productKey,
        providerKey: productKey ?? line.providerKey ?? null,
      };
    });

    const normalized = {
      ...orderRow,
      lines: linesWithProcurement,
      stx,
      stxUnits,
      stockxMatches: matchesForResponse,
      externalBuys: Array.isArray(externalBuys) ? externalBuys : [],
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
      const scopedLines = stxOnly
        ? linesWithProcurement.filter((line: any) => isGalaxusStxSupplierLine(line))
        : linesWithProcurement;
      const minimalLines = scopedLines.map((line: any) => ({
        id: line.id,
        lineNumber: line.lineNumber,
        supplierPid: line.supplierPid ?? null,
        supplierKey: line.supplierKey ?? resolveOrderLineSupplierKey(line),
        productKey: line.productKey ?? null,
        providerKey: line.providerKey ?? null,
        gtin: line.gtin ?? null,
        quantity: line.quantity,
        priceLineAmount: line.priceLineAmount ?? line.lineNetAmount ?? null,
        lineNetAmount: line.lineNetAmount ?? null,
        productName: line.productName ?? null,
        size: line.size ?? null,
        sizeRaw: line.sizeRaw ?? null,
        supplierSku: line.supplierSku ?? null,
        styleSku: line.styleSku ?? null,
        offerSupplierSku: line.offerSupplierSku ?? null,
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
        deliveryNotePdfUrl: shipment.deliveryNotePdfUrl ?? null,
        shippingLabelPdfUrl: shipment.shippingLabelPdfUrl ?? null,
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
          physicalDeliveryNoteRequired: Boolean(orderRow.physicalDeliveryNoteRequired),
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
