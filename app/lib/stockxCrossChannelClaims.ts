import { prisma } from "@/app/lib/prisma";

type ClaimChannel = "decathlon" | "galaxus";

export type StockxOrderClaim = {
  channel: ClaimChannel;
  matchId: string;
  stockxOrderId: string | null;
  stockxOrderNumber: string | null;
};

export type StockxOrderClaimIndex = {
  byOrderId: Map<string, StockxOrderClaim>;
  byOrderNumber: Map<string, StockxOrderClaim>;
};

function normalizeKey(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function addClaim(index: StockxOrderClaimIndex, claim: StockxOrderClaim) {
  const orderId = normalizeKey(claim.stockxOrderId);
  const orderNumber = normalizeKey(claim.stockxOrderNumber);
  if (orderId && !index.byOrderId.has(orderId)) {
    index.byOrderId.set(orderId, claim);
  }
  if (orderNumber && !index.byOrderNumber.has(orderNumber)) {
    index.byOrderNumber.set(orderNumber, claim);
  }
}

export function createEmptyStockxOrderClaimIndex(): StockxOrderClaimIndex {
  return {
    byOrderId: new Map<string, StockxOrderClaim>(),
    byOrderNumber: new Map<string, StockxOrderClaim>(),
  };
}

export async function buildStockxOrderClaimIndex(args: {
  stockxOrderIds?: Array<string | null | undefined>;
  stockxOrderNumbers?: Array<string | null | undefined>;
}): Promise<StockxOrderClaimIndex> {
  const ids = Array.from(
    new Set((args.stockxOrderIds ?? []).map((v) => normalizeKey(v)).filter((v): v is string => Boolean(v)))
  );
  const nums = Array.from(
    new Set(
      (args.stockxOrderNumbers ?? [])
        .map((v) => normalizeKey(v))
        .filter((v): v is string => Boolean(v))
    )
  );

  const index = createEmptyStockxOrderClaimIndex();
  if (ids.length === 0 && nums.length === 0) {
    return index;
  }

  const whereOr: any[] = [];
  if (ids.length > 0) whereOr.push({ stockxOrderId: { in: ids } });
  if (nums.length > 0) whereOr.push({ stockxOrderNumber: { in: nums } });
  const where = whereOr.length === 1 ? whereOr[0] : { OR: whereOr };

  const [decathlonRows, galaxusRows] = await Promise.all([
    prisma.decathlonStockxMatch.findMany({
      where,
      select: {
        id: true,
        stockxOrderId: true,
        stockxOrderNumber: true,
      },
    }),
    (prisma as any).galaxusStockxMatch.findMany({
      where,
      select: {
        id: true,
        stockxOrderId: true,
        stockxOrderNumber: true,
      },
    }),
  ]);

  for (const row of decathlonRows) {
    addClaim(index, {
      channel: "decathlon",
      matchId: String(row.id),
      stockxOrderId: normalizeKey(row.stockxOrderId),
      stockxOrderNumber: normalizeKey(row.stockxOrderNumber),
    });
  }
  for (const row of galaxusRows) {
    addClaim(index, {
      channel: "galaxus",
      matchId: String(row.id),
      stockxOrderId: normalizeKey(row.stockxOrderId),
      stockxOrderNumber: normalizeKey(row.stockxOrderNumber),
    });
  }

  return index;
}

export function findStockxOrderClaim(
  index: StockxOrderClaimIndex,
  stockxOrderId?: string | null,
  stockxOrderNumber?: string | null
): StockxOrderClaim | null {
  const byId = normalizeKey(stockxOrderId);
  if (byId && index.byOrderId.has(byId)) {
    return index.byOrderId.get(byId) ?? null;
  }
  const byNum = normalizeKey(stockxOrderNumber);
  if (byNum && index.byOrderNumber.has(byNum)) {
    return index.byOrderNumber.get(byNum) ?? null;
  }
  return null;
}

export function registerStockxOrderClaim(index: StockxOrderClaimIndex, claim: StockxOrderClaim): void {
  addClaim(index, claim);
}
