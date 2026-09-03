import { prisma } from "@/app/lib/prisma";
import { sameGtinKey } from "@/galaxus/orders/gtinKey";
import {
  galaxusLineWarehouseStockHint,
  isGalaxusStxSupplierLine,
} from "@/galaxus/warehouse/lineInventorySource";

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
    // Common marketplace paddings: UPC-12, EAN-13, GTIN-14.
    out.add(n.padStart(12, "0"));
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

/** Resolve `stx_*` supplier variant id for a Galaxus line (line field or GTIN mapping). */
export async function resolveSupplierVariantIdForGalaxusLine(line: {
  supplierVariantId?: unknown;
  gtin?: unknown;
  quantity?: unknown;
}): Promise<string | null> {
  const sv = String(line?.supplierVariantId ?? "").trim();
  if (sv.startsWith("stx_")) return sv;
  const norm = normalizeGtinKey(typeof line?.gtin === "string" ? line.gtin : "");
  const qty = Math.max(1, Math.round(Number(line?.quantity ?? 1)));
  if (!norm) return null;
  const needs = await resolveStxNeedsFromGtinQuantities(new Map([[norm, qty]]));
  return needs[0]?.supplierVariantId ?? null;
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
  const gtinQty = new Map<string, number>();
  for (const line of order.lines) {
    // Only STX-designated lines should be handled by the StockX linking flow.
    // TRM/GLD lines can share GTINs with StockX catalog, but they must not create STX purchase unit needs.
    if (!isGalaxusStxSupplierLine(line)) continue;
    // Maison / NER in-title markers: never reserve or auto-link StockX buys for these units.
    if (galaxusLineWarehouseStockHint(line)) continue;
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
  const linkedByGtin = new Map<string, number>();
  for (const unit of units) {
    const key = makeNeedKey(unit.gtin, unit.supplierVariantId);
    const current = unitAgg.get(key) ?? { reserved: 0, linked: 0, linkedWithEta: 0, linkedWithAwb: 0 };
    current.reserved += 1;
    if (unit.stockxOrderId) {
      current.linked += 1;
      if (unit.etaMin && unit.etaMax) current.linkedWithEta += 1;
      if (unit.awb) current.linkedWithAwb += 1;
      const norm = normalizeGtinKey(unit.gtin);
      if (norm) linkedByGtin.set(norm, (linkedByGtin.get(norm) ?? 0) + 1);
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
    const gtinLinked = linkedByGtin.get(normalizeGtinKey(need.gtin)) ?? 0;
    return {
      gtin: need.gtin,
      supplierVariantId: need.supplierVariantId,
      needed: need.needed,
      reserved: agg.reserved,
      linked: Math.max(agg.linked, Math.min(need.needed, gtinLinked)),
      linkedWithEta: agg.linkedWithEta,
      linkedWithAwb: agg.linkedWithAwb,
    };
  });
}

/** One saved match covers one unit — never inflate qty>1 to fully linked. */
export function applySavedMatchCountsToBuckets(
  buckets: StxLinkBucket[],
  matchLinks: Array<{ galaxusGtin?: unknown; stockxOrderNumber?: unknown }>
): StxLinkBucket[] {
  const matchCountByGtin = new Map<string, number>();
  for (const row of matchLinks ?? []) {
    if (!String(row?.stockxOrderNumber ?? "").trim()) continue;
    const norm = normalizeGtinKey(String(row?.galaxusGtin ?? ""));
    if (!norm) continue;
    matchCountByGtin.set(norm, (matchCountByGtin.get(norm) ?? 0) + 1);
  }
  return buckets.map((bucket) => {
    const savedCount = matchCountByGtin.get(normalizeGtinKey(bucket.gtin)) ?? 0;
    return {
      ...bucket,
      linked: Math.max(bucket.linked, Math.min(bucket.needed, savedCount)),
    };
  });
}

export async function getStxLinkStatusForOrder(
  orderIdOrRef: string,
  preloadedOrder?: Awaited<ReturnType<typeof resolveGalaxusOrderByIdOrRef>> | null
): Promise<StxOrderLinkStatus> {
  const order = preloadedOrder ?? (await resolveGalaxusOrderByIdOrRef(orderIdOrRef));
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
  const enrichedBuckets = applySavedMatchCountsToBuckets(buckets, matchLinks ?? []);
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

export async function reserveStxPurchaseUnitsForOrder(
  orderIdOrRef: string,
  preloadedOrder?: Awaited<ReturnType<typeof resolveGalaxusOrderByIdOrRef>> | null
) {
  const order = preloadedOrder ?? (await resolveGalaxusOrderByIdOrRef(orderIdOrRef));
  if (!order) throw new Error("Order not found");
  const needs = await resolveStxNeedsForOrder(order);
  const prismaAny = prisma as any;

  if (needs.length === 0) {
    try {
      await prismaAny.stxPurchaseUnit.deleteMany({
        where: {
          galaxusOrderId: order.galaxusOrderId,
          supplierVariantId: { startsWith: "stx_" },
          stockxOrderId: null,
          cancelledAt: null,
        },
      });
    } catch (error: any) {
      if (!isUnknownCancelledAtArg(error)) throw error;
      await prismaAny.stxPurchaseUnit.deleteMany({
        where: {
          galaxusOrderId: order.galaxusOrderId,
          supplierVariantId: { startsWith: "stx_" },
          stockxOrderId: null,
        },
      });
    }
    return {
      galaxusOrderId: order.galaxusOrderId,
      created: 0,
      status: await getStxLinkStatusForOrder(order.galaxusOrderId),
    };
  }

  const gtins = Array.from(new Set(needs.map((need) => need.gtin)));
  const gtinExpanded = Array.from(new Set(needs.flatMap((n) => expandGtinsForDbLookup([n.gtin]))));
  let existing: Array<{ gtin: string; supplierVariantId: string }> = [];
  try {
    existing = await prismaAny.stxPurchaseUnit.findMany({
      where: {
        galaxusOrderId: order.galaxusOrderId,
        gtin: { in: gtinExpanded.length ? gtinExpanded : gtins },
        cancelledAt: null,
      },
      select: { gtin: true, supplierVariantId: true },
    });
  } catch (error: any) {
    if (!isUnknownCancelledAtArg(error)) throw error;
    existing = await prismaAny.stxPurchaseUnit.findMany({
      where: {
        galaxusOrderId: order.galaxusOrderId,
        gtin: { in: gtinExpanded.length ? gtinExpanded : gtins },
      },
      select: { gtin: true, supplierVariantId: true },
    });
  }
  const counts = new Map<string, number>();
  for (const row of existing) {
    const key = makeNeedKey(normalizeGtinKey(String(row.gtin)), String(row.supplierVariantId));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  /** Remove extra *unlinked* rows when titles change (e.g. maison) so they cannot steal StockX links. */
  for (const need of needs) {
    const key = makeNeedKey(need.gtin, need.supplierVariantId);
    const existingCount = counts.get(key) ?? 0;
    const excess = Math.max(0, existingCount - need.needed);
    if (excess <= 0) continue;
    const gtinOr = expandGtinsForDbLookup([need.gtin]);
    let extras: Array<{ id: string }> = [];
    try {
      extras = await prismaAny.stxPurchaseUnit.findMany({
        where: {
          galaxusOrderId: order.galaxusOrderId,
          supplierVariantId: need.supplierVariantId,
          stockxOrderId: null,
          cancelledAt: null,
          gtin: { in: gtinOr },
        },
        orderBy: { createdAt: "desc" },
        take: excess,
        select: { id: true },
      });
    } catch (error: any) {
      if (!isUnknownCancelledAtArg(error)) throw error;
      extras = await prismaAny.stxPurchaseUnit.findMany({
        where: {
          galaxusOrderId: order.galaxusOrderId,
          supplierVariantId: need.supplierVariantId,
          stockxOrderId: null,
          gtin: { in: gtinOr },
        },
        orderBy: { createdAt: "desc" },
        take: excess,
        select: { id: true },
      });
    }
    const ids = extras.map((e: { id: string }) => e.id).filter(Boolean);
    if (ids.length) {
      await prismaAny.stxPurchaseUnit.deleteMany({ where: { id: { in: ids } } });
      counts.set(key, Math.max(0, existingCount - ids.length));
    }
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

/** After price sync, STX supplierVariantId can change while the StockX buy stays on the old unit row. */
export async function migrateLinkedStxUnitsToCurrentNeeds(orderIdOrRef: string) {
  const order = await resolveGalaxusOrderByIdOrRef(orderIdOrRef);
  if (!order) throw new Error("Order not found");
  const needs = await resolveStxNeedsForOrder(order);
  if (needs.length === 0) return { updated: 0 };

  const prismaAny = prisma as any;
  const gtinExpanded = Array.from(new Set(needs.flatMap((n) => expandGtinsForDbLookup([n.gtin]))));
  let units: Array<{ id: string; gtin: string; supplierVariantId: string; stockxOrderId: string | null }> = [];
  try {
    units = await prismaAny.stxPurchaseUnit.findMany({
      where: {
        galaxusOrderId: order.galaxusOrderId,
        gtin: { in: gtinExpanded },
        cancelledAt: null,
      },
      select: { id: true, gtin: true, supplierVariantId: true, stockxOrderId: true },
    });
  } catch (error: any) {
    if (!isUnknownCancelledAtArg(error)) throw error;
    units = await prismaAny.stxPurchaseUnit.findMany({
      where: {
        galaxusOrderId: order.galaxusOrderId,
        gtin: { in: gtinExpanded },
      },
      select: { id: true, gtin: true, supplierVariantId: true, stockxOrderId: true },
    });
  }

  let updated = 0;
  for (const need of needs) {
    const candidates = units.filter((u) => sameGtinKey(String(u.gtin ?? ""), need.gtin));
    for (const unit of candidates) {
      if (unit.supplierVariantId === need.supplierVariantId) continue;
      await prismaAny.stxPurchaseUnit.update({
        where: { id: unit.id },
        data: { supplierVariantId: need.supplierVariantId },
      });
      unit.supplierVariantId = need.supplierVariantId;
      updated += 1;
    }
  }
  return { updated };
}

/**
 * True when the linker result belongs to the current Galaxus order (either
 * freshly linked or idempotent re-run). Callers should NOT persist a
 * `GalaxusStockxMatch` row when this returns false — otherwise the same
 * StockX buy ends up on two orders and the /scan flow auto-prints the wrong
 * customer label. Pure decision function so unit tests can pin the guard.
 */
export function shouldWriteGalaxusMatchForLinkResult(linkResult: {
  status: string;
}): boolean {
  return linkResult.status === "linked" || linkResult.status === "already_linked";
}

export async function linkOldestPendingStxUnit(params: {
  galaxusOrderId: string;
  supplierVariantId: string;
  gtin?: string | null;
  stockxOrderId: string;
  awb?: string | null;
  etaMin?: Date | null;
  etaMax?: Date | null;
  checkoutType?: string | null;
  stockxOrderNumber?: string | null;
  stockxSettledAmount?: number | null;
  stockxSettledCurrency?: string | null;
  /** When true (saved-match / manual chain+order path), still persist buy id + AWB even if ETA missing. */
  allowMissingEta?: boolean;
}) {
  const stockxOrderId = params.stockxOrderId.trim();
  const stockxOrderNumber =
    typeof params.stockxOrderNumber === "string" && params.stockxOrderNumber.trim()
      ? params.stockxOrderNumber.trim()
      : "";
  if (!stockxOrderId) return { status: "invalid_order_id" as const };
  if (!params.allowMissingEta && (!params.etaMin || !params.etaMax)) {
    return { status: "missing_eta" as const };
  }

  // One StockX buy can back only one Galaxus order. When the buy is already
  // attached to a unit on a DIFFERENT galaxus order, refuse the write — the
  // caller must not create a duplicate `GalaxusStockxMatch` on the current
  // order (that stale match then drives auto-print + packing-session bugs).
  let alreadyLinked:
    | { id: string; galaxusOrderId: string; cancelledAt: Date | null }
    | null = null;
  try {
    alreadyLinked = await (prisma as any).stxPurchaseUnit.findUnique({
      where: { stockxOrderId },
      select: { id: true, galaxusOrderId: true, cancelledAt: true },
    });
  } catch (error: any) {
    if (!isUnknownCancelledAtArg(error)) throw error;
    alreadyLinked = await (prisma as any).stxPurchaseUnit.findUnique({
      where: { stockxOrderId },
      select: { id: true, galaxusOrderId: true },
    });
    if (alreadyLinked) alreadyLinked.cancelledAt = null;
  }
  if (alreadyLinked) {
    const sameOrder =
      String(alreadyLinked.galaxusOrderId ?? "") === String(params.galaxusOrderId);
    if (sameOrder) {
      return { status: "already_linked" as const, unitId: String(alreadyLinked.id) };
    }
    return {
      status: "already_linked_other_order" as const,
      unitId: String(alreadyLinked.id),
      otherGalaxusOrderId: String(alreadyLinked.galaxusOrderId ?? ""),
    };
  }

  // Cross-channel guard: one StockX buy order must not be consumed by both Decathlon and Galaxus.
  const decathlonWhereOr: any[] = [{ stockxOrderId }];
  if (stockxOrderNumber) {
    decathlonWhereOr.push({ stockxOrderNumber });
  }
  const claimedByDecathlon = await prisma.decathlonStockxMatch.findFirst({
    where: decathlonWhereOr.length === 1 ? decathlonWhereOr[0] : { OR: decathlonWhereOr },
    select: { id: true },
  });
  if (claimedByDecathlon) {
    return { status: "already_linked" as const };
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
    const gtinKeys = params.gtin ? expandGtinsForDbLookup([params.gtin]) : [];
    if (gtinKeys.length > 0) {
      try {
        pendingUnit = await (prisma as any).stxPurchaseUnit.findFirst({
          where: {
            galaxusOrderId: params.galaxusOrderId,
            stockxOrderId: null,
            cancelledAt: null,
            gtin: { in: gtinKeys },
          },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
      } catch (error: any) {
        if (!isUnknownCancelledAtArg(error)) throw error;
        pendingUnit = await (prisma as any).stxPurchaseUnit.findFirst({
          where: {
            galaxusOrderId: params.galaxusOrderId,
            stockxOrderId: null,
            gtin: { in: gtinKeys },
          },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
      }
    }
  }
  if (!pendingUnit) {
    return { status: "no_pending_unit" as const };
  }

  try {
    const settled =
      params.stockxSettledAmount != null && Number.isFinite(params.stockxSettledAmount)
        ? params.stockxSettledAmount
        : null;
    const updated = await (prisma as any).stxPurchaseUnit.update({
      where: { id: pendingUnit.id },
      data: {
        supplierVariantId: params.supplierVariantId,
        stockxOrderId,
        stockxOrderNumber: stockxOrderNumber || null,
        stockxSettledAmount: settled,
        stockxSettledCurrency:
          typeof params.stockxSettledCurrency === "string" && params.stockxSettledCurrency.trim()
            ? params.stockxSettledCurrency.trim()
            : null,
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

