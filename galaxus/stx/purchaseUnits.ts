import { prisma } from "@/app/lib/prisma";

type StxNeed = {
  gtin: string;
  supplierVariantId: string;
  needed: number;
};

export type StxLinkBucket = {
  gtin: string;
  supplierVariantId: string;
  needed: number;
  reserved: number;
  linked: number;
  linkedWithEta: number;
};

export type StxOrderLinkStatus = {
  galaxusOrderId: string;
  hasStxItems: boolean;
  allLinked: boolean;
  allEtaPresent: boolean;
  buckets: StxLinkBucket[];
};

export async function resolveGalaxusOrderByIdOrRef(orderIdOrRef: string) {
  return (
    (await prisma.galaxusOrder.findUnique({
      where: { id: orderIdOrRef },
      include: { lines: true, shipments: true },
    })) ??
    (await prisma.galaxusOrder.findUnique({
      where: { galaxusOrderId: orderIdOrRef },
      include: { lines: true, shipments: true },
    }))
  );
}

function makeNeedKey(gtin: string, supplierVariantId: string) {
  return `${gtin}::${supplierVariantId}`;
}

async function resolveStxNeedsForOrder(order: Awaited<ReturnType<typeof resolveGalaxusOrderByIdOrRef>>) {
  if (!order) return [] as StxNeed[];
  const gtinQty = new Map<string, number>();
  for (const line of order.lines) {
    const gtin = typeof line.gtin === "string" ? line.gtin.trim() : "";
    const qty = Number(line.quantity ?? 0);
    if (!gtin || qty <= 0) continue;
    gtinQty.set(gtin, (gtinQty.get(gtin) ?? 0) + qty);
  }
  const gtins = Array.from(gtinQty.keys());
  if (gtins.length === 0) return [] as StxNeed[];

  const mappings = await (prisma as any).variantMapping.findMany({
    where: {
      gtin: { in: gtins },
      supplierVariantId: { startsWith: "stx_" },
      status: { in: ["SUPPLIER_GTIN", "MATCHED", "PARTNER_GTIN"] },
    },
    include: { supplierVariant: true },
    orderBy: { updatedAt: "desc" },
  });

  const bestByGtin = new Map<string, any>();
  for (const mapping of mappings) {
    const gtin = String(mapping?.gtin ?? "").trim();
    if (!gtin) continue;
    const supplierVariantId = String(mapping?.supplierVariantId ?? "").trim();
    if (!supplierVariantId.startsWith("stx_")) continue;
    const existing = bestByGtin.get(gtin);
    if (!existing) {
      bestByGtin.set(gtin, mapping);
      continue;
    }
    const existingStock = Number(existing?.supplierVariant?.stock ?? 0);
    const nextStock = Number(mapping?.supplierVariant?.stock ?? 0);
    if (nextStock > existingStock) {
      bestByGtin.set(gtin, mapping);
      continue;
    }
    if (nextStock === existingStock) {
      const existingUpdated = new Date(existing?.updatedAt ?? 0).getTime();
      const nextUpdated = new Date(mapping?.updatedAt ?? 0).getTime();
      if (nextUpdated > existingUpdated) bestByGtin.set(gtin, mapping);
    }
  }

  const needs: StxNeed[] = [];
  for (const [gtin, qty] of gtinQty.entries()) {
    const mapping = bestByGtin.get(gtin);
    const supplierVariantId = String(mapping?.supplierVariantId ?? "").trim();
    if (!supplierVariantId.startsWith("stx_")) continue;
    needs.push({
      gtin,
      supplierVariantId,
      needed: qty,
    });
  }
  return needs;
}

function buildBucketsFromNeeds(
  needs: StxNeed[],
  units: Array<{
    gtin: string;
    supplierVariantId: string;
    stockxOrderId: string | null;
    etaMin: Date | null;
    etaMax: Date | null;
  }>
): StxLinkBucket[] {
  const unitAgg = new Map<
    string,
    {
      reserved: number;
      linked: number;
      linkedWithEta: number;
    }
  >();
  for (const unit of units) {
    const key = makeNeedKey(unit.gtin, unit.supplierVariantId);
    const current = unitAgg.get(key) ?? { reserved: 0, linked: 0, linkedWithEta: 0 };
    current.reserved += 1;
    if (unit.stockxOrderId) {
      current.linked += 1;
      if (unit.etaMin && unit.etaMax) current.linkedWithEta += 1;
    }
    unitAgg.set(key, current);
  }

  return needs.map((need) => {
    const agg = unitAgg.get(makeNeedKey(need.gtin, need.supplierVariantId)) ?? {
      reserved: 0,
      linked: 0,
      linkedWithEta: 0,
    };
    return {
      gtin: need.gtin,
      supplierVariantId: need.supplierVariantId,
      needed: need.needed,
      reserved: agg.reserved,
      linked: agg.linked,
      linkedWithEta: agg.linkedWithEta,
    };
  });
}

export async function getStxLinkStatusForOrder(orderIdOrRef: string): Promise<StxOrderLinkStatus> {
  const order = await resolveGalaxusOrderByIdOrRef(orderIdOrRef);
  if (!order) throw new Error("Order not found");
  const needs = await resolveStxNeedsForOrder(order);
  const units =
    needs.length > 0
      ? await (prisma as any).stxPurchaseUnit.findMany({
          where: {
            galaxusOrderId: order.galaxusOrderId,
            gtin: { in: Array.from(new Set(needs.map((need) => need.gtin))) },
          },
          select: {
            gtin: true,
            supplierVariantId: true,
            stockxOrderId: true,
            etaMin: true,
            etaMax: true,
          },
        })
      : [];
  const buckets = buildBucketsFromNeeds(needs, units);
  const hasStxItems = buckets.length > 0;
  const allLinked = buckets.every((bucket) => bucket.linked >= bucket.needed);
  const allEtaPresent = buckets.every((bucket) => bucket.linkedWithEta >= bucket.needed);
  return {
    galaxusOrderId: order.galaxusOrderId,
    hasStxItems,
    allLinked: hasStxItems ? allLinked : true,
    allEtaPresent: hasStxItems ? allEtaPresent : true,
    buckets,
  };
}

export async function reserveStxPurchaseUnitsForOrder(orderIdOrRef: string) {
  const order = await resolveGalaxusOrderByIdOrRef(orderIdOrRef);
  if (!order) throw new Error("Order not found");
  const needs = await resolveStxNeedsForOrder(order);
  if (needs.length === 0) {
    return {
      galaxusOrderId: order.galaxusOrderId,
      created: 0,
      status: await getStxLinkStatusForOrder(order.galaxusOrderId),
    };
  }

  const existing = await (prisma as any).stxPurchaseUnit.findMany({
    where: {
      galaxusOrderId: order.galaxusOrderId,
      gtin: { in: Array.from(new Set(needs.map((need) => need.gtin))) },
    },
    select: { gtin: true, supplierVariantId: true },
  });
  const counts = new Map<string, number>();
  for (const row of existing) {
    const key = makeNeedKey(String(row.gtin), String(row.supplierVariantId));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const createRows: Array<{ galaxusOrderId: string; gtin: string; supplierVariantId: string }> = [];
  for (const need of needs) {
    const key = makeNeedKey(need.gtin, need.supplierVariantId);
    const existingCount = counts.get(key) ?? 0;
    const missing = Math.max(0, need.needed - existingCount);
    for (let idx = 0; idx < missing; idx += 1) {
      createRows.push({
        galaxusOrderId: order.galaxusOrderId,
        gtin: need.gtin,
        supplierVariantId: need.supplierVariantId,
      });
    }
  }

  if (createRows.length > 0) {
    await (prisma as any).stxPurchaseUnit.createMany({
      data: createRows,
    });
  }

  return {
    galaxusOrderId: order.galaxusOrderId,
    created: createRows.length,
    status: await getStxLinkStatusForOrder(order.galaxusOrderId),
  };
}

export async function linkOldestPendingStxUnit(params: {
  galaxusOrderId: string;
  supplierVariantId: string;
  stockxOrderId: string;
  awb?: string | null;
  etaMin?: Date | null;
  etaMax?: Date | null;
  checkoutType?: string | null;
}) {
  const stockxOrderId = params.stockxOrderId.trim();
  if (!stockxOrderId) return { status: "invalid_order_id" as const };

  const alreadyLinked = await (prisma as any).stxPurchaseUnit.findUnique({
    where: { stockxOrderId },
    select: { id: true },
  });
  if (alreadyLinked) {
    return { status: "already_linked" as const, unitId: String(alreadyLinked.id) };
  }

  const pendingUnit = await (prisma as any).stxPurchaseUnit.findFirst({
    where: {
      galaxusOrderId: params.galaxusOrderId,
      supplierVariantId: params.supplierVariantId,
      stockxOrderId: null,
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!pendingUnit) {
    return { status: "no_pending_unit" as const };
  }

  try {
    const updated = await (prisma as any).stxPurchaseUnit.update({
      where: { id: pendingUnit.id },
      data: {
        stockxOrderId,
        awb: params.awb ?? null,
        etaMin: params.etaMin ?? null,
        etaMax: params.etaMax ?? null,
        checkoutType: params.checkoutType ?? null,
      },
      select: { id: true },
    });
    return { status: "linked" as const, unitId: String(updated.id) };
  } catch (error: any) {
    const code = String(error?.code ?? "");
    if (code === "P2002") {
      return { status: "already_linked" as const };
    }
    throw error;
  }
}

export async function getStxLinkStatusForShipment(shipmentId: string): Promise<StxOrderLinkStatus | null> {
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: { order: true, items: true },
  });
  if (!shipment?.order) return null;

  const orderStatus = await getStxLinkStatusForOrder(shipment.order.galaxusOrderId);
  const shipmentGtins = new Set(
    shipment.items
      .map((item) => String(item.gtin14 ?? "").trim())
      .filter((gtin) => gtin.length > 0)
  );
  const relevantBuckets = orderStatus.buckets.filter((bucket) => shipmentGtins.has(bucket.gtin));
  if (relevantBuckets.length === 0) {
    return {
      ...orderStatus,
      hasStxItems: false,
      allLinked: true,
      allEtaPresent: true,
      buckets: [],
    };
  }

  const allLinked = relevantBuckets.every((bucket) => bucket.linked >= bucket.needed);
  const allEtaPresent = relevantBuckets.every((bucket) => bucket.linkedWithEta >= bucket.needed);
  return {
    galaxusOrderId: orderStatus.galaxusOrderId,
    hasStxItems: true,
    allLinked,
    allEtaPresent,
    buckets: relevantBuckets,
  };
}

