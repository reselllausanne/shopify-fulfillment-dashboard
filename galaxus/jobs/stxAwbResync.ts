import { prisma } from "@/app/lib/prisma";
import { createLimiter } from "@/galaxus/jobs/bulkSql";
import { fetchRecentStockxBuyingOrders, fetchStockxBuyOrderDetails } from "@/galaxus/stx/stockxClient";
import { readGalaxusStockxToken } from "@/lib/stockxGalaxusAuth";

type StxAwbResyncResult = {
  scannedUnits: number;
  uniqueOrders: number;
  updatedUnits: number;
  updatedOrders: number;
  skippedReason?: "missing_token";
};

type StxAwbResyncOptions = {
  minAgeHours?: number;
  limitUnits?: number;
  orderListPages?: number;
  concurrency?: number;
};

export async function runStxAwbResync(options: StxAwbResyncOptions = {}): Promise<StxAwbResyncResult> {
  const minAgeHours = Math.max(1, options.minAgeHours ?? 48);
  const limitUnits = Math.max(1, options.limitUnits ?? 500);
  const orderListPages = Math.max(1, options.orderListPages ?? 12);
  const concurrency = Math.max(1, options.concurrency ?? 2);
  const cutoff = new Date(Date.now() - minAgeHours * 60 * 60 * 1000);

  const token = await readGalaxusStockxToken();
  if (!token) {
    return {
      scannedUnits: 0,
      uniqueOrders: 0,
      updatedUnits: 0,
      updatedOrders: 0,
      skippedReason: "missing_token",
    };
  }

  const pendingUnits = await (prisma as any).stxPurchaseUnit.findMany({
    where: {
      stockxOrderId: { not: null },
      awb: null,
      createdAt: { lte: cutoff },
    },
    orderBy: { createdAt: "asc" },
    take: limitUnits,
    select: { id: true, stockxOrderId: true },
  });

  const orderIds = Array.from(
    new Set<string>(
      pendingUnits
        .map((unit: any) => String(unit?.stockxOrderId ?? "").trim())
        .filter((value: string) => value.length > 0)
    )
  );
  if (orderIds.length === 0) {
    return {
      scannedUnits: pendingUnits.length,
      uniqueOrders: 0,
      updatedUnits: 0,
      updatedOrders: 0,
    };
  }

  const recentOrders = await fetchRecentStockxBuyingOrders(token, {
    first: 50,
    maxPages: orderListPages,
  });
  const chainByOrderId = new Map<string, string>();
  for (const order of recentOrders) {
    const orderId = typeof order.orderId === "string" ? order.orderId.trim() : "";
    const chainId = typeof order.chainId === "string" ? order.chainId.trim() : "";
    if (!orderId || !chainId) continue;
    chainByOrderId.set(orderId, chainId);
  }

  const limiter = createLimiter(concurrency);
  let updatedUnits = 0;
  let updatedOrders = 0;

  await Promise.all(
    orderIds.map((stockxOrderId) =>
      limiter(async () => {
        const chainId = chainByOrderId.get(stockxOrderId) ?? "";
        if (!chainId) return;
        let details: Awaited<ReturnType<typeof fetchStockxBuyOrderDetails>>;
        try {
          details = await fetchStockxBuyOrderDetails(token, {
            chainId,
            orderId: stockxOrderId,
          });
        } catch {
          return;
        }

        const checkoutType =
          typeof details.order?.checkoutType === "string" ? details.order.checkoutType : null;
        const updateData: Record<string, unknown> = {
          etaMin: details.etaMin,
          etaMax: details.etaMax,
        };
        if (details.awb) updateData.awb = details.awb;
        if (checkoutType) updateData.checkoutType = checkoutType;

        const updateResult = await (prisma as any).stxPurchaseUnit.updateMany({
          where: {
            stockxOrderId,
            awb: null,
          },
          data: updateData,
        });
        if ((updateResult?.count ?? 0) > 0) {
          updatedOrders += 1;
          updatedUnits += updateResult.count;
        }
      })
    )
  );

  return {
    scannedUnits: pendingUnits.length,
    uniqueOrders: orderIds.length,
    updatedUnits,
    updatedOrders,
  };
}

