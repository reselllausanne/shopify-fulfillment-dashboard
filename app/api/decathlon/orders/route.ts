import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import { partnerKeyMatchingLineOffer } from "@/decathlon/orders/partnerLineScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? "50"), 1), 200);
    const offset = Math.max(Number(searchParams.get("offset") ?? "0"), 0);
    const view = String(searchParams.get("view") ?? "active").trim();
    const scope = String(searchParams.get("scope") ?? "").trim().toLowerCase();
    const productSearch = String(searchParams.get("product") ?? "").trim();
    const prismaAny = prisma as any;
    let where: any = {};
    let sessionPartnerKey: string | null = null;
    let partnerOfferPrefix: string | null = null;
    if (scope === "partner") {
      const partnerSession = await getPartnerSession(request);
      if (!partnerSession) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      }
      sessionPartnerKey = normalizeProviderKey(partnerSession?.partnerKey ?? null);
      if (!sessionPartnerKey) {
        return NextResponse.json({ ok: false, error: "Partner key missing" }, { status: 400 });
      }
      const keyPrefix = `${sessionPartnerKey}_`;
      partnerOfferPrefix = keyPrefix;
      where.OR = [
        { partnerKey: sessionPartnerKey },
        { lines: { some: { partnerKey: sessionPartnerKey } } },
        {
          lines: {
            some: {
              OR: [
                { offerSku: { startsWith: keyPrefix, mode: "insensitive" } },
                { providerKey: { startsWith: keyPrefix, mode: "insensitive" } },
                { providerKey: { equals: sessionPartnerKey, mode: "insensitive" } },
              ],
            },
          },
        },
      ];
    }
    const canceledStates = ["CANCELED", "CANCELLED", "ORDER_CANCELLED", "CLOSED"];
    if (view === "canceled") {
      where.orderState = { in: canceledStates, mode: "insensitive" };
    }

    if (productSearch.length > 0) {
      const byLineName = {
        lines: {
          some: {
            OR: [
              { productTitle: { contains: productSearch, mode: "insensitive" } },
              { description: { contains: productSearch, mode: "insensitive" } },
            ],
          },
        },
      };
      if (Array.isArray(where.AND)) {
        where = { ...where, AND: [...where.AND, byLineName] };
      } else {
        const keys = Object.keys(where);
        if (keys.length === 0) {
          where = byLineName;
        } else {
          const prior = { ...where };
          where = { AND: [prior, byLineName] };
        }
      }
    }

    const orders = await prismaAny.decathlonOrder.findMany({
      where,
      orderBy: { orderDate: "desc" },
      take: limit,
      skip: offset,
      include: {
        _count: { select: { lines: true, shipments: true } },
        lines: { select: { id: true, quantity: true, offerSku: true, providerKey: true, partnerKey: true } },
        shipments: { select: { shippedAt: true, lines: { select: { orderLineId: true, quantity: true } } } },
      },
    });
    const [matchRows, partnerRows] = await Promise.all([
      prismaAny.decathlonStockxMatch.findMany({
        select: {
          decathlonOrderLineId: true,
          stockxOrderNumber: true,
          stockxOrderId: true,
          stockxChainId: true,
        },
      }),
      prismaAny.partner.findMany({
        where: { active: true },
        select: { key: true },
      }),
    ]);
    const partnerKeysForMatch = partnerRows
      .map((row: { key?: string | null }) => String(row.key ?? "").trim())
      .filter(Boolean);

    const stockxLinkedLineIds = new Set<string>();
    for (const row of matchRows) {
      const onum = String(row.stockxOrderNumber ?? "").trim();
      const oid = String(row.stockxOrderId ?? "").trim();
      const chain = String(row.stockxChainId ?? "").trim();
      if (!onum && !oid && !chain) continue;
      stockxLinkedLineIds.add(row.decathlonOrderLineId);
    }

    const lineCountsAsLinkedForList = (line: {
      id: string;
      offerSku?: string | null;
      providerKey?: string | null;
      partnerKey?: string | null;
    }) => {
      if (stockxLinkedLineIds.has(line.id)) return true;
      if (normalizeProviderKey(line.partnerKey)) return true;
      return (
        partnerKeysForMatch.length > 0 &&
        partnerKeyMatchingLineOffer(
          { offerSku: line.offerSku, catalog: { providerKey: line.providerKey ?? null } },
          partnerKeysForMatch
        ) != null
      );
    };
    const items = orders.map((order: any) => {
      const lines = Array.isArray(order.lines) ? order.lines : [];
      const prefix = (partnerOfferPrefix ?? "").toUpperCase();
      let metricsLines = partnerOfferPrefix
        ? lines.filter((line: any) => {
            const linePartnerKey = normalizeProviderKey(line.partnerKey);
            if (linePartnerKey && sessionPartnerKey && linePartnerKey === sessionPartnerKey) return true;
            const lineProviderKey = normalizeProviderKey(line.providerKey);
            if (lineProviderKey && sessionPartnerKey && lineProviderKey === sessionPartnerKey) return true;
            const offerSku = String(line.offerSku ?? "").toUpperCase();
            const provider = String(line.providerKey ?? "").toUpperCase();
            return offerSku.startsWith(prefix) || provider.startsWith(prefix);
          })
        : lines;
      // Whole-order assignment: partner key matches but line SKUs may not use the partner_ prefix yet.
      if (
        partnerOfferPrefix &&
        metricsLines.length === 0 &&
        sessionPartnerKey &&
        order.partnerKey &&
        normalizeProviderKey(order.partnerKey) === sessionPartnerKey
      ) {
        metricsLines = lines;
      }
      const totalUnits = metricsLines.reduce((sum: number, line: any) => sum + Number(line.quantity ?? 0), 0);
      const shipmentLines = (order.shipments ?? []).flatMap((shipment: any) => shipment.lines ?? []);
      const scopedLineIds = new Set(metricsLines.map((line: any) => line.id));
      const scopedShipmentLines = shipmentLines.filter((line: any) => scopedLineIds.has(line.orderLineId));
      const hasLegacyShipment =
        scopedShipmentLines.length === 0 && (order.shipments ?? []).some((s: any) => s.shippedAt);
      const shippedUnits = hasLegacyShipment
        ? totalUnits
        : scopedShipmentLines.reduce((sum: number, line: any) => sum + Number(line.quantity ?? 0), 0);
      const remainingUnits = Math.max(totalUnits - shippedUnits, 0);
      const lineCount = partnerOfferPrefix ? metricsLines.length : order._count?.lines ?? 0;
      const linkedCount = metricsLines.filter((line: any) => lineCountsAsLinkedForList(line)).length;
      return {
        id: order.id,
        orderId: order.orderId,
        orderNumber: order.orderNumber ?? order.orderId,
        orderDate: order.orderDate,
        orderState: order.orderState ?? null,
        partnerKey: order.partnerKey ?? null,
        shippedCount: order.shipments?.filter((s: { shippedAt: unknown }) => Boolean(s.shippedAt)).length ?? 0,
        shippedUnits,
        totalUnits,
        remainingUnits,
        linkedCount,
        _count: { lines: lineCount, shipments: order._count?.shipments ?? 0 },
      };
    });
    return NextResponse.json({ ok: true, items });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to load orders" },
      { status: 500 }
    );
  }
}
