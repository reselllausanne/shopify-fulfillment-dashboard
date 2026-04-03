import { prisma } from "@/app/lib/prisma";

export type StxNeed = {
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

/** Normalize GTIN/EAN for lookups (digits only, strip leading zeros). */
export function normalizeGtinKey(raw: string | null | undefined): string {
  const digits = String(raw ?? "")
    .trim()
    .replace(/\D/g, "");
  if (!digits) return "";
  return digits.replace(/^0+/, "") || "0";
}

/** Expand GTIN forms so DB rows stored with different padding still match. */
export function expandGtinsForDbLookup(gtins: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const g of gtins) {
    const d = String(g).trim().replace(/\D/g, "");
    if (!d) continue;
    out.add(d);
    const n = d.replace(/^0+/, "") || "0";
    out.add(n);
    out.add(n.padStart(13, "0"));
    out.add(n.padStart(14, "0"));
  }
  return Array.from(out);
}

/**
 * Map aggregated GTIN quantities to StockX supplier variant ids (stx_*) via variantMapping — same rules as Galaxus STX sync.
 */
export async function resolveStxNeedsFromGtinQuantities(gtinQty: Map<string, number>): Promise<StxNeed[]> {
  if (gtinQty.size === 0) return [];
  const lookupGtins = expandGtinsForDbLookup(gtinQty.keys());
  if (lookupGtins.length === 0) return [];

  const mappings = await (prisma as any).variantMapping.findMany({
    where: {
      gtin: { in: lookupGtins },
      supplierVariantId: { startsWith: "stx_" },
      status: { in: ["SUPPLIER_GTIN", "MATCHED", "PARTNER_GTIN"] },
    },
    include: { supplierVariant: true },
    orderBy: { updatedAt: "desc" },
  });

  const bestByNorm = new Map<string, any>();
  for (const mapping of mappings) {
    const norm = normalizeGtinKey(String(mapping?.gtin ?? ""));
    if (!norm) continue;
    const supplierVariantId = String(mapping?.supplierVariantId ?? "").trim();
    if (!supplierVariantId.startsWith("stx_")) continue;
    const existing = bestByNorm.get(norm);
    if (!existing) {
      bestByNorm.set(norm, mapping);
      continue;
    }
    const existingStock = Number(existing?.supplierVariant?.stock ?? 0);
    const nextStock = Number(mapping?.supplierVariant?.stock ?? 0);
    if (nextStock > existingStock) {
      bestByNorm.set(norm, mapping);
      continue;
    }
    if (nextStock === existingStock) {
      const existingUpdated = new Date(existing?.updatedAt ?? 0).getTime();
      const nextUpdated = new Date(mapping?.updatedAt ?? 0).getTime();
      if (nextUpdated > existingUpdated) bestByNorm.set(norm, mapping);
    }
  }

  const needs: StxNeed[] = [];
  for (const [gtinKey, qty] of gtinQty.entries()) {
    const norm = normalizeGtinKey(gtinKey);
    if (!norm || qty <= 0) continue;
    const mapping = bestByNorm.get(norm);
    const supplierVariantId = String(mapping?.supplierVariantId ?? "").trim();
    if (!supplierVariantId.startsWith("stx_")) continue;
    needs.push({
      gtin: norm,
      supplierVariantId,
      needed: qty,
    });
  }
  return needs;
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
    const norm = normalizeGtinKey(typeof line.gtin === "string" ? line.gtin : "");
    const qty = Number(line.quantity ?? 0);
    if (!norm || qty <= 0) continue;
    gtinQty.set(norm, (gtinQty.get(norm) ?? 0) + qty);
  }
  return resolveStxNeedsFromGtinQuantities(gtinQty);
}

export function buildBucketsFromNeeds(
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
  const matchLinks = await (prisma as any).galaxusStockxMatch
    .findMany({
      where: {
        OR: [{ galaxusOrderId: order.id }, { galaxusOrderRef: order.galaxusOrderId }],
      },
      select: { galaxusGtin: true, stockxOrderNumber: true },
    })
    .catch(() => []);
  const matchedGtins = new Set(
    (matchLinks ?? [])
      .filter((row: any) => String(row?.stockxOrderNumber ?? "").trim().length > 0)
      .map((row: any) => String(row?.galaxusGtin ?? "").trim())
      .filter((gtin: string) => gtin.length > 0)
  );
  const enrichedBuckets = buckets.map((bucket) => {
    if (matchedGtins.has(bucket.gtin)) {
      return {
        ...bucket,
        linked: bucket.needed,
        linkedWithEta: bucket.needed,
        linkedWithAwb: bucket.needed,
      };
    }
    return bucket;
  });
  const hasStxItems = buckets.length > 0;
  const allLinked = enrichedBuckets.every((bucket) => bucket.linked >= bucket.needed);
  const allEtaPresent = enrichedBuckets.every((bucket) => bucket.linkedWithEta >= bucket.needed);
  const allAwbPresent = enrichedBuckets.every((bucket) => bucket.linkedWithAwb >= bucket.needed);
  return {
    galaxusOrderId: order.galaxusOrderId,
    hasStxItems,
    allLinked: hasStxItems ? allLinked : true,
    allEtaPresent: hasStxItems ? allEtaPresent : true,
    allAwbPresent: hasStxItems ? allAwbPresent : true,
    buckets: enrichedBuckets,
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
    include: { order: true, items: { include: { order: true } } },
  });
  if (!shipment?.order) return null;

  const itemsByGalaxusOrderId = new Map<string, typeof shipment.items>();
  for (const item of shipment.items) {
    const gid = String(item?.order?.galaxusOrderId ?? shipment.order.galaxusOrderId ?? "").trim();
    if (!gid) continue;
    const list = itemsByGalaxusOrderId.get(gid) ?? [];
    list.push(item);
    itemsByGalaxusOrderId.set(gid, list);
  }

  const mergedBuckets: StxLinkBucket[] = [];
  let anchorStatus: StxOrderLinkStatus | null = null;

  for (const [galaxusOrderId, groupItems] of itemsByGalaxusOrderId) {
    const orderStatus = await getStxLinkStatusForOrder(galaxusOrderId);
    if (!anchorStatus) anchorStatus = orderStatus;

    const neededByGtin = new Map<string, number>();
    for (const item of groupItems) {
      const gtin = String(item?.gtin14 ?? "").trim();
      const qty = Number(item?.quantity ?? 0);
      if (!gtin || qty <= 0) continue;
      neededByGtin.set(gtin, (neededByGtin.get(gtin) ?? 0) + qty);
    }
    const shipmentGtins = new Set(
      groupItems.map((item) => String(item.gtin14 ?? "").trim()).filter((gtin) => gtin.length > 0)
    );
    const relevantBuckets = orderStatus.buckets
      .filter((bucket) => shipmentGtins.has(bucket.gtin))
      .map((bucket) => {
        const shipmentNeeded = neededByGtin.get(bucket.gtin) ?? bucket.needed;
        return { ...bucket, needed: Math.min(bucket.needed, shipmentNeeded) };
      });
    mergedBuckets.push(...relevantBuckets);
  }

  if (mergedBuckets.length === 0) {
    const base = anchorStatus ?? (await getStxLinkStatusForOrder(shipment.order.galaxusOrderId));
    return {
      ...base,
      hasStxItems: false,
      allLinked: true,
      allEtaPresent: true,
      allAwbPresent: true,
      buckets: [],
    };
  }

  const allLinked = mergedBuckets.every((bucket) => bucket.linked >= bucket.needed);
  const allEtaPresent = mergedBuckets.every((bucket) => bucket.linkedWithEta >= bucket.needed);
  const allAwbPresent = mergedBuckets.every((bucket) => bucket.linkedWithAwb >= bucket.needed);
  return {
    galaxusOrderId: shipment.order.galaxusOrderId,
    hasStxItems: true,
    allLinked,
    allEtaPresent,
    allAwbPresent,
    buckets: mergedBuckets,
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

