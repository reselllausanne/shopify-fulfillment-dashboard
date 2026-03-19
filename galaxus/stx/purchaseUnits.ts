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
  linkedWithAwb: number;
};

export type StxOrderLinkStatus = {
  galaxusOrderId: string;
  hasStxItems: boolean;
  allLinked: boolean;
  allEtaPresent: boolean;
  allAwbPresent: boolean;
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

function isUnknownCancelledAtArg(error: any): boolean {
  const message = String(error?.message ?? "");
  return (
    message.includes("Unknown argument `cancelledAt`") ||
    message.includes("Unknown argument `cancelledReason`")
  );
}

async function resolveStxNeedsForOrder(order: Awaited<ReturnType<typeof resolveGalaxusOrderByIdOrRef>>) {
  if (!order) return [] as StxNeed[];
  const isStxLine = (line: any): boolean => {
    const supplierPid = String(line?.supplierPid ?? "").trim().toUpperCase();
    if (supplierPid.startsWith("STX_")) return true;
    const supplierVariantId = String(line?.supplierVariantId ?? "").trim().toLowerCase();
    if (supplierVariantId.startsWith("stx_")) return true;
    const providerKeyRaw = String(line?.providerKey ?? "").trim().toUpperCase();
    if (providerKeyRaw === "STX" || providerKeyRaw.startsWith("STX_")) return true;
    return false;
  };
  const gtinQty = new Map<string, number>();
  for (const line of order.lines) {
    // Only STX-designated lines should be handled by the StockX linking flow.
    // TRM/GLD lines can share GTINs with StockX catalog, but they must not create STX purchase unit needs.
    if (!isStxLine(line)) continue;
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
    awb: string | null;
  }>
): StxLinkBucket[] {
  const unitAgg = new Map<
    string,
    {
      reserved: number;
      linked: number;
      linkedWithEta: number;
      linkedWithAwb: number;
    }
  >();
  for (const unit of units) {
    const key = makeNeedKey(unit.gtin, unit.supplierVariantId);
    const current = unitAgg.get(key) ?? { reserved: 0, linked: 0, linkedWithEta: 0, linkedWithAwb: 0 };
    current.reserved += 1;
    if (unit.stockxOrderId) {
      current.linked += 1;
      if (unit.etaMin && unit.etaMax) current.linkedWithEta += 1;
      if (unit.awb) current.linkedWithAwb += 1;
    }
    unitAgg.set(key, current);
  }

  return needs.map((need) => {
    const agg = unitAgg.get(makeNeedKey(need.gtin, need.supplierVariantId)) ?? {
      reserved: 0,
      linked: 0,
      linkedWithEta: 0,
      linkedWithAwb: 0,
    };
    return {
      gtin: need.gtin,
      supplierVariantId: need.supplierVariantId,
      needed: need.needed,
      reserved: agg.reserved,
      linked: agg.linked,
      linkedWithEta: agg.linkedWithEta,
      linkedWithAwb: agg.linkedWithAwb,
    };
  });
}

export async function getStxLinkStatusForOrder(orderIdOrRef: string): Promise<StxOrderLinkStatus> {
  const order = await resolveGalaxusOrderByIdOrRef(orderIdOrRef);
  if (!order) throw new Error("Order not found");
  const needs = await resolveStxNeedsForOrder(order);
  let units: Array<{
    gtin: string;
    supplierVariantId: string;
    stockxOrderId: string | null;
    etaMin: Date | null;
    etaMax: Date | null;
    awb: string | null;
  }> = [];
  if (needs.length > 0) {
    const gtins = Array.from(new Set(needs.map((need) => need.gtin)));
    try {
      units = await (prisma as any).stxPurchaseUnit.findMany({
        where: {
          galaxusOrderId: order.galaxusOrderId,
          gtin: { in: gtins },
          cancelledAt: null,
        },
        select: {
          gtin: true,
          supplierVariantId: true,
          stockxOrderId: true,
          etaMin: true,
          etaMax: true,
          awb: true,
        },
      });
    } catch (error: any) {
      if (!isUnknownCancelledAtArg(error)) throw error;
      units = await (prisma as any).stxPurchaseUnit.findMany({
        where: {
          galaxusOrderId: order.galaxusOrderId,
          gtin: { in: gtins },
        },
        select: {
          gtin: true,
          supplierVariantId: true,
          stockxOrderId: true,
          etaMin: true,
          etaMax: true,
          awb: true,
        },
      });
    }
  }
  const buckets = buildBucketsFromNeeds(needs, units);
  const hasStxItems = buckets.length > 0;
  const allLinked = buckets.every((bucket) => bucket.linked >= bucket.needed);
  const allEtaPresent = buckets.every((bucket) => bucket.linkedWithEta >= bucket.needed);
  const allAwbPresent = buckets.every((bucket) => bucket.linkedWithAwb >= bucket.needed);
  return {
    galaxusOrderId: order.galaxusOrderId,
    hasStxItems,
    allLinked: hasStxItems ? allLinked : true,
    allEtaPresent: hasStxItems ? allEtaPresent : true,
    allAwbPresent: hasStxItems ? allAwbPresent : true,
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

  const gtins = Array.from(new Set(needs.map((need) => need.gtin)));
  let existing: Array<{ gtin: string; supplierVariantId: string }> = [];
  try {
    existing = await (prisma as any).stxPurchaseUnit.findMany({
      where: {
        galaxusOrderId: order.galaxusOrderId,
        gtin: { in: gtins },
        cancelledAt: null,
      },
      select: { gtin: true, supplierVariantId: true },
    });
  } catch (error: any) {
    if (!isUnknownCancelledAtArg(error)) throw error;
    existing = await (prisma as any).stxPurchaseUnit.findMany({
      where: {
        galaxusOrderId: order.galaxusOrderId,
        gtin: { in: gtins },
      },
      select: { gtin: true, supplierVariantId: true },
    });
  }
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
  if (!params.etaMin || !params.etaMax) {
    return { status: "missing_eta" as const };
  }

  const alreadyLinked = await (prisma as any).stxPurchaseUnit.findUnique({
    where: { stockxOrderId },
    select: { id: true },
  });
  if (alreadyLinked) {
    return { status: "already_linked" as const, unitId: String(alreadyLinked.id) };
  }

  let pendingUnit: { id: string } | null = null;
  try {
    pendingUnit = await (prisma as any).stxPurchaseUnit.findFirst({
      where: {
        galaxusOrderId: params.galaxusOrderId,
        supplierVariantId: params.supplierVariantId,
        stockxOrderId: null,
        cancelledAt: null,
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
  } catch (error: any) {
    if (!isUnknownCancelledAtArg(error)) throw error;
    pendingUnit = await (prisma as any).stxPurchaseUnit.findFirst({
      where: {
        galaxusOrderId: params.galaxusOrderId,
        supplierVariantId: params.supplierVariantId,
        stockxOrderId: null,
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
  }
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
  const neededByGtin = new Map<string, number>();
  for (const item of shipment.items) {
    const gtin = String(item?.gtin14 ?? "").trim();
    const qty = Number(item?.quantity ?? 0);
    if (!gtin || qty <= 0) continue;
    neededByGtin.set(gtin, (neededByGtin.get(gtin) ?? 0) + qty);
  }
  const shipmentGtins = new Set(
    shipment.items
      .map((item) => String(item.gtin14 ?? "").trim())
      .filter((gtin) => gtin.length > 0)
  );
  const relevantBuckets = orderStatus.buckets
    .filter((bucket) => shipmentGtins.has(bucket.gtin))
    .map((bucket) => {
      const shipmentNeeded = neededByGtin.get(bucket.gtin) ?? bucket.needed;
      return { ...bucket, needed: Math.min(bucket.needed, shipmentNeeded) };
    });
  if (relevantBuckets.length === 0) {
    return {
      ...orderStatus,
      hasStxItems: false,
      allLinked: true,
      allEtaPresent: true,
      allAwbPresent: true,
      buckets: [],
    };
  }

  const allLinked = relevantBuckets.every((bucket) => bucket.linked >= bucket.needed);
  const allEtaPresent = relevantBuckets.every((bucket) => bucket.linkedWithEta >= bucket.needed);
  const allAwbPresent = relevantBuckets.every((bucket) => bucket.linkedWithAwb >= bucket.needed);
  return {
    galaxusOrderId: orderStatus.galaxusOrderId,
    hasStxItems: true,
    allLinked,
    allEtaPresent,
    allAwbPresent,
    buckets: relevantBuckets,
  };
}

export async function cancelStxPurchaseUnit(params: {
  galaxusOrderId: string;
  stockxOrderId: string;
  reason?: string | null;
}) {
  const stockxOrderId = params.stockxOrderId.trim();
  if (!stockxOrderId) return { ok: false as const, status: "invalid_order_id" as const };
  let unit: { id: string; galaxusOrderId: string; cancelledAt?: Date | null } | null = null;
  try {
    unit = await (prisma as any).stxPurchaseUnit.findUnique({
      where: { stockxOrderId },
      select: { id: true, galaxusOrderId: true, cancelledAt: true },
    });
  } catch (error: any) {
    if (!isUnknownCancelledAtArg(error)) throw error;
    throw new Error("StockX cancel requires DB migration (missing cancelledAt/cancelledReason columns)");
  }
  if (!unit) return { ok: false as const, status: "not_found" as const };
  if (unit.cancelledAt) return { ok: true as const, status: "already_cancelled" as const };
  if (String(unit.galaxusOrderId) !== String(params.galaxusOrderId)) {
    return { ok: false as const, status: "wrong_order" as const };
  }
  await (prisma as any).stxPurchaseUnit.update({
    where: { id: unit.id },
    data: {
      cancelledAt: new Date(),
      cancelledReason: params.reason ? String(params.reason).trim() : null,
    },
  });
  return { ok: true as const, status: "cancelled" as const };
}

