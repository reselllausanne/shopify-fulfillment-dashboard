import { Prisma } from "@prisma/client";
import {
  ConfidenceLevel,
  FinanceDirection,
  FinanceCategory,
  MarketplaceChannel,
  OperatingDirection,
  OperatingEventCategory,
  OperatingEventStatus,
  OperatingEventType,
  OperatingSourceType,
} from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { toNumberSafe } from "@/app/utils/numbers";
import { buildOperatingEventKey } from "@/app/lib/finance/keys";
import { toDateKey } from "@/app/lib/cashflow";

type SourceStats = {
  created: number;
  updated: number;
  skipped: number;
  errored: number;
};

type MaterializeResult = {
  totals: SourceStats;
  bySource: Record<string, SourceStats>;
};

export type MaterializeOptions = {
  from?: Date | null;
  to?: Date | null;
  sourceTypes?: OperatingSourceType[];
  dryRun?: boolean;
};

type OperatingEventInput = {
  eventKey: string;
  eventDate: Date;
  channel?: MarketplaceChannel | null;
  eventType: OperatingEventType;
  direction: OperatingDirection;
  category: OperatingEventCategory;
  subcategory?: string | null;
  amount: number;
  currencyCode?: string | null;
  description?: string | null;
  sourceType: OperatingSourceType;
  sourceRecordId?: string | null;
  sourceLineId?: string | null;
  sourceTable?: string | null;
  sourceReference?: string | null;
  paymentMethod?: string | null;
  materializedAt?: Date;
  orderId?: string | null;
  orderLineId?: string | null;
  externalOrderRef?: string | null;
  sku?: string | null;
  providerKey?: string | null;
  counterparty?: string | null;
  status?: OperatingEventStatus;
  confidence?: ConfidenceLevel;
  isManual?: boolean;
  isDerived?: boolean;
  isEstimated?: boolean;
  notes?: string | null;
  metadataJson?: Prisma.InputJsonValue | null;
  manualFinanceEventId?: string | null;
};

const emptyStats = (): SourceStats => ({
  created: 0,
  updated: 0,
  skipped: 0,
  errored: 0,
});

const addStats = (target: SourceStats, delta: Partial<SourceStats>) => {
  target.created += delta.created ?? 0;
  target.updated += delta.updated ?? 0;
  target.skipped += delta.skipped ?? 0;
  target.errored += delta.errored ?? 0;
};

const shouldIncludeSource = (
  sourceType: OperatingSourceType,
  filter?: OperatingSourceType[]
) => {
  if (!filter?.length) return true;
  return filter.includes(sourceType);
};

const lastDayOfMonthUtc = (year: number, monthIndex: number) =>
  new Date(Date.UTC(year, monthIndex + 1, 0, 0, 0, 0, 0));

const getExpenseMapping = (name: string | null | undefined) => {
  const normalized = (name || "").toLowerCase();
  if (normalized.includes("insurance")) {
    return { eventType: OperatingEventType.INSURANCE, category: OperatingEventCategory.FINANCE };
  }
  if (normalized.includes("fuel") || normalized.includes("gas")) {
    return { eventType: OperatingEventType.FUEL, category: OperatingEventCategory.LOGISTICS };
  }
  if (normalized.includes("subscription") || normalized.includes("software") || normalized.includes("tool")) {
    return { eventType: OperatingEventType.SUBSCRIPTION_COST, category: OperatingEventCategory.SOFTWARE };
  }
  if (normalized.includes("shipping") || normalized.includes("post")) {
    return { eventType: OperatingEventType.SHIPPING_COST, category: OperatingEventCategory.LOGISTICS };
  }
  if (normalized.includes("commission") || normalized.includes("marketplace")) {
    return { eventType: OperatingEventType.MARKETPLACE_COMMISSION, category: OperatingEventCategory.MARKETPLACE };
  }
  if (normalized.includes("vat")) {
    return { eventType: OperatingEventType.VAT, category: OperatingEventCategory.TAXES };
  }
  if (normalized.includes("tax")) {
    return { eventType: OperatingEventType.TAX, category: OperatingEventCategory.TAXES };
  }
  if (normalized.includes("owner") || normalized.includes("draw")) {
    return { eventType: OperatingEventType.OWNER_DRAW, category: OperatingEventCategory.PERSONAL_DRAW };
  }
  return { eventType: OperatingEventType.OTHER_EXPENSE, category: OperatingEventCategory.OTHER };
};

const mapManualFinanceCategory = (
  category: FinanceCategory,
  direction: FinanceDirection
) => {
  switch (category) {
    case "SALES":
      return { eventType: OperatingEventType.SALE, category: OperatingEventCategory.REVENUE };
    case "REFUND":
      return { eventType: OperatingEventType.REFUND, category: OperatingEventCategory.REVENUE };
    case "COGS":
      return { eventType: OperatingEventType.COGS, category: OperatingEventCategory.DIRECT_COST };
    case "COMMISSION":
      return { eventType: OperatingEventType.MARKETPLACE_COMMISSION, category: OperatingEventCategory.MARKETPLACE };
    case "SHIPPING":
      return { eventType: OperatingEventType.SHIPPING_COST, category: OperatingEventCategory.LOGISTICS };
    case "ADS":
      return { eventType: OperatingEventType.AD_SPEND, category: OperatingEventCategory.MARKETING };
    case "SUBSCRIPTION":
      return { eventType: OperatingEventType.SUBSCRIPTION_COST, category: OperatingEventCategory.SOFTWARE };
    case "OWNER_DRAW":
      return { eventType: OperatingEventType.OWNER_DRAW, category: OperatingEventCategory.PERSONAL_DRAW };
    case "INSURANCE":
      return { eventType: OperatingEventType.INSURANCE, category: OperatingEventCategory.FINANCE };
    case "FUEL":
      return { eventType: OperatingEventType.FUEL, category: OperatingEventCategory.LOGISTICS };
    case "TAX":
      return { eventType: OperatingEventType.TAX, category: OperatingEventCategory.TAXES };
    default:
      return direction === "IN"
        ? { eventType: OperatingEventType.OTHER_INCOME, category: OperatingEventCategory.OTHER }
        : { eventType: OperatingEventType.OTHER_EXPENSE, category: OperatingEventCategory.OTHER };
  }
};

const getDateFilter = (from?: Date | null, to?: Date | null) => {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: from } : {}),
    ...(to ? { lte: to } : {}),
  };
};

const buildEventData = (input: OperatingEventInput, materializedAt: Date) => ({
  eventKey: input.eventKey,
  eventDate: input.eventDate,
  channel: input.channel ?? null,
  eventType: input.eventType,
  direction: input.direction,
  category: input.category,
  subcategory: input.subcategory ?? null,
  amount: new Prisma.Decimal(Math.abs(input.amount)),
  currencyCode: input.currencyCode || "CHF",
  description: input.description ?? null,
  sourceType: input.sourceType,
  sourceRecordId: input.sourceRecordId ?? null,
  sourceLineId: input.sourceLineId ?? null,
  sourceTable: input.sourceTable ?? null,
  sourceReference: input.sourceReference ?? null,
  paymentMethod: input.paymentMethod ?? null,
  materializedAt,
  orderId: input.orderId ?? null,
  orderLineId: input.orderLineId ?? null,
  externalOrderRef: input.externalOrderRef ?? null,
  sku: input.sku ?? null,
  providerKey: input.providerKey ?? null,
  counterparty: input.counterparty ?? null,
  status: input.status ?? OperatingEventStatus.ACTIVE,
  confidence: input.confidence ?? ConfidenceLevel.MEDIUM,
  isManual: input.isManual ?? false,
  isDerived: input.isDerived ?? false,
  isEstimated: input.isEstimated ?? false,
  notes: input.notes ?? null,
  metadataJson:
    input.metadataJson === undefined || input.metadataJson === null
      ? undefined
      : (input.metadataJson as Prisma.InputJsonValue),
  manualFinanceEventId: input.manualFinanceEventId ?? null,
});

const upsertOperatingEvent = async (
  input: OperatingEventInput,
  dryRun: boolean,
  stats: SourceStats,
  materializedAt: Date
) => {
  if (!input.eventKey || input.amount <= 0) {
    stats.skipped += 1;
    return;
  }

  const existing = await prisma.operatingEvent.findUnique({
    where: { eventKey: input.eventKey },
    select: { id: true },
  });

  if (dryRun) {
    if (existing) {
      stats.updated += 1;
    } else {
      stats.created += 1;
    }
    return;
  }

  const data = buildEventData(input, materializedAt);

  if (existing) {
    await prisma.operatingEvent.update({
      where: { eventKey: input.eventKey },
      data,
    });
    stats.updated += 1;
  } else {
    await prisma.operatingEvent.create({ data });
    stats.created += 1;
  }
};

export async function materializeOperatingEvents(
  options: MaterializeOptions = {}
): Promise<MaterializeResult> {
  const stats: MaterializeResult = { totals: emptyStats(), bySource: {} };
  const materializedAt = new Date();
  const dateFilter = getDateFilter(options.from ?? null, options.to ?? null);

  const ensureStats = (source: OperatingSourceType) => {
    if (!stats.bySource[source]) {
      stats.bySource[source] = emptyStats();
    }
    return stats.bySource[source];
  };

  if (shouldIncludeSource("SHOPIFY_ORDER", options.sourceTypes)) {
    const sourceStats = ensureStats("SHOPIFY_ORDER");
    try {
      const orders = await prisma.shopifyOrder.findMany({
        where: {
          ...(dateFilter ? { createdAt: dateFilter } : {}),
        },
        select: {
          shopifyOrderId: true,
          orderName: true,
          createdAt: true,
          totalSalesChf: true,
          refundedAmountChf: true,
          paymentGatewayNames: true,
          currencyCode: true,
          financialStatus: true,
          cancelledAt: true,
          updatedAt: true,
          syncedAt: true,
        },
      });

      for (const order of orders) {
        const gross = toNumberSafe(order.totalSalesChf, 0);
        const saleKey = buildOperatingEventKey({
          sourceType: "SHOPIFY_ORDER",
          sourceRecordId: order.shopifyOrderId,
          eventType: OperatingEventType.SALE,
        });
        if (!saleKey || gross <= 0) {
          sourceStats.skipped += 1;
          continue;
        }

        const paymentMethod = order.paymentGatewayNames?.length
          ? order.paymentGatewayNames.join(" | ")
          : null;

        await upsertOperatingEvent(
          {
            eventKey: saleKey,
            eventDate: order.createdAt,
            channel: "SHOPIFY",
            eventType: OperatingEventType.SALE,
            direction: OperatingDirection.IN,
            category: OperatingEventCategory.REVENUE,
            amount: gross,
            currencyCode: order.currencyCode,
            description: `Shopify order ${order.orderName}`,
            sourceType: OperatingSourceType.SHOPIFY_ORDER,
            sourceRecordId: order.shopifyOrderId,
            sourceTable: "ShopifyOrder",
            paymentMethod,
            orderId: order.shopifyOrderId,
            externalOrderRef: order.orderName,
            status: order.cancelledAt ? OperatingEventStatus.VOID : OperatingEventStatus.ACTIVE,
            confidence: order.cancelledAt ? ConfidenceLevel.LOW : ConfidenceLevel.HIGH,
            metadataJson: {
              paymentGatewayNames: order.paymentGatewayNames,
              financialStatus: order.financialStatus,
              cancelledAt: order.cancelledAt ? order.cancelledAt.toISOString() : null,
            },
          },
          options.dryRun ?? false,
          sourceStats,
          materializedAt
        );

        const refunded = toNumberSafe(order.refundedAmountChf, 0);
        if (refunded > 0) {
          const refundKey = buildOperatingEventKey({
            sourceType: "SHOPIFY_ORDER",
            sourceRecordId: order.shopifyOrderId,
            eventType: OperatingEventType.REFUND,
          });

          if (refundKey) {
            const refundDate =
              order.updatedAt || order.syncedAt || order.createdAt;
            await upsertOperatingEvent(
              {
                eventKey: refundKey,
                eventDate: refundDate,
                channel: "SHOPIFY",
                eventType: OperatingEventType.REFUND,
                direction: OperatingDirection.OUT,
                category: OperatingEventCategory.REVENUE,
                subcategory: "refund",
                amount: refunded,
                currencyCode: order.currencyCode,
                description: `Shopify refund ${order.orderName}`,
                sourceType: OperatingSourceType.SHOPIFY_ORDER,
                sourceRecordId: order.shopifyOrderId,
                sourceTable: "ShopifyOrder",
                paymentMethod,
                orderId: order.shopifyOrderId,
                externalOrderRef: order.orderName,
                confidence: ConfidenceLevel.LOW,
                metadataJson: {
                  refundDateSource: order.updatedAt
                    ? "updatedAt"
                    : order.syncedAt
                      ? "syncedAt"
                      : "createdAt",
                  refundedAmountChf: refunded,
                },
              },
              options.dryRun ?? false,
              sourceStats,
              materializedAt
            );
          } else {
            sourceStats.skipped += 1;
          }
        }
      }
    } catch (error) {
      console.error("[OPERATING][SHOPIFY_ORDER] Materialize error:", error);
      sourceStats.errored += 1;
    }
  }

  if (shouldIncludeSource("GALAXUS_ORDER_LINE", options.sourceTypes)) {
    const sourceStats = ensureStats("GALAXUS_ORDER_LINE");
    try {
      const lines = await prisma.galaxusOrderLine.findMany({
        where: {
          ...(dateFilter ? { order: { orderDate: dateFilter } } : {}),
        },
        select: {
          id: true,
          orderId: true,
          lineNetAmount: true,
          unitNetPrice: true,
          quantity: true,
          supplierSku: true,
          providerKey: true,
          currencyCode: true,
          order: {
            select: {
              orderDate: true,
              orderNumber: true,
              galaxusOrderId: true,
            },
          },
        },
      });

      for (const line of lines) {
        const orderDate = line.order?.orderDate;
        if (!orderDate) {
          sourceStats.skipped += 1;
          continue;
        }

        const net = toNumberSafe(line.lineNetAmount, 0);
        const fallback = toNumberSafe(line.unitNetPrice, 0) * Number(line.quantity ?? 0);
        const amount = net > 0 ? net : fallback;
        if (amount <= 0) {
          sourceStats.skipped += 1;
          continue;
        }

        const eventKey = buildOperatingEventKey({
          sourceType: "GALAXUS_ORDER_LINE",
          sourceRecordId: line.id,
          eventType: OperatingEventType.SALE,
        });

        if (!eventKey) {
          sourceStats.skipped += 1;
          continue;
        }

        await upsertOperatingEvent(
          {
            eventKey,
            eventDate: orderDate,
            channel: "GALAXUS",
            eventType: OperatingEventType.SALE,
            direction: OperatingDirection.IN,
            category: OperatingEventCategory.REVENUE,
            amount,
            currencyCode: line.currencyCode ?? "CHF",
            description: `Galaxus order ${line.order?.orderNumber ?? line.order?.galaxusOrderId ?? ""}`.trim(),
            sourceType: OperatingSourceType.GALAXUS_ORDER_LINE,
            sourceRecordId: line.id,
            sourceLineId: line.id,
            sourceTable: "GalaxusOrderLine",
            orderId: line.order?.galaxusOrderId ?? line.orderId,
            orderLineId: line.id,
            externalOrderRef: line.order?.orderNumber,
            sku: line.supplierSku ?? null,
            providerKey: line.providerKey ?? null,
            confidence: ConfidenceLevel.HIGH,
          },
          options.dryRun ?? false,
          sourceStats,
          materializedAt
        );
      }
    } catch (error) {
      console.error("[OPERATING][GALAXUS_ORDER_LINE] Materialize error:", error);
      sourceStats.errored += 1;
    }
  }

  if (shouldIncludeSource("DECATHLON_ORDER_LINE", options.sourceTypes)) {
    const sourceStats = ensureStats("DECATHLON_ORDER_LINE");
    try {
      const lines = await prisma.decathlonOrderLine.findMany({
        where: {
          ...(dateFilter ? { order: { orderDate: dateFilter } } : {}),
        },
        select: {
          id: true,
          orderId: true,
          orderLineId: true,
          unitPrice: true,
          lineTotal: true,
          quantity: true,
          offerSku: true,
          providerKey: true,
          currencyCode: true,
          order: {
            select: {
              orderDate: true,
              orderNumber: true,
              orderId: true,
            },
          },
        },
      });

      for (const line of lines) {
        const orderDate = line.order?.orderDate;
        if (!orderDate) {
          sourceStats.skipped += 1;
          continue;
        }
        const lineTotal = toNumberSafe(line.lineTotal, 0);
        const fallback = toNumberSafe(line.unitPrice, 0) * Number(line.quantity ?? 0);
        const amount = lineTotal > 0 ? lineTotal : fallback;
        if (amount <= 0) {
          sourceStats.skipped += 1;
          continue;
        }

        const eventKey = buildOperatingEventKey({
          sourceType: "DECATHLON_ORDER_LINE",
          sourceRecordId: line.orderLineId,
          eventType: OperatingEventType.SALE,
        });

        if (!eventKey) {
          sourceStats.skipped += 1;
          continue;
        }

        await upsertOperatingEvent(
          {
            eventKey,
            eventDate: orderDate,
            channel: "DECATHLON",
            eventType: OperatingEventType.SALE,
            direction: OperatingDirection.IN,
            category: OperatingEventCategory.REVENUE,
            amount,
            currencyCode: line.currencyCode ?? "CHF",
            description: `Decathlon order ${line.order?.orderNumber ?? line.order?.orderId ?? ""}`.trim(),
            sourceType: OperatingSourceType.DECATHLON_ORDER_LINE,
            sourceRecordId: line.orderLineId,
            sourceLineId: line.orderLineId,
            sourceTable: "DecathlonOrderLine",
            orderId: line.order?.orderId ?? line.orderId,
            orderLineId: line.orderLineId,
            externalOrderRef: line.order?.orderNumber,
            sku: line.offerSku ?? null,
            providerKey: line.providerKey ?? null,
            confidence: ConfidenceLevel.HIGH,
          },
          options.dryRun ?? false,
          sourceStats,
          materializedAt
        );
      }
    } catch (error) {
      console.error("[OPERATING][DECATHLON_ORDER_LINE] Materialize error:", error);
      sourceStats.errored += 1;
    }
  }

  if (shouldIncludeSource("ORDER_MATCH", options.sourceTypes)) {
    const sourceStats = ensureStats("ORDER_MATCH");
    try {
      const where: Prisma.OrderMatchWhereInput = {};
      if (dateFilter) {
        where.shopifyCreatedAt = dateFilter;
      }

      const matches = await prisma.orderMatch.findMany({
        where,
        select: {
          id: true,
          shopifyOrderId: true,
          shopifyOrderName: true,
          shopifyLineItemId: true,
          shopifySku: true,
          shopifyCreatedAt: true,
          shopifyCurrencyCode: true,
          supplierSource: true,
          supplierCost: true,
          manualCostOverride: true,
          stockxPurchaseDate: true,
          stockxOrderNumber: true,
        },
      });

      for (const match of matches) {
        const costOverride = match.manualCostOverride;
        const baseCost = costOverride !== null && costOverride !== undefined
          ? toNumberSafe(costOverride, 0)
          : toNumberSafe(match.supplierCost, 0);
        if (baseCost <= 0) {
          sourceStats.skipped += 1;
          continue;
        }

        const eventDate = match.shopifyCreatedAt || match.stockxPurchaseDate;
        if (!eventDate) {
          sourceStats.skipped += 1;
          continue;
        }

        const eventKey = buildOperatingEventKey({
          sourceType: "ORDER_MATCH",
          sourceRecordId: match.id,
          sourceLineId: match.shopifyLineItemId,
          eventType: OperatingEventType.COGS,
        });

        if (!eventKey) {
          sourceStats.skipped += 1;
          continue;
        }

        await upsertOperatingEvent(
          {
            eventKey,
            eventDate,
            channel: "SHOPIFY",
            eventType: OperatingEventType.COGS,
            direction: OperatingDirection.OUT,
            category: OperatingEventCategory.DIRECT_COST,
            subcategory: match.supplierSource,
            amount: baseCost,
            currencyCode: match.shopifyCurrencyCode ?? "CHF",
            description: `COGS ${match.shopifyOrderName}`,
            sourceType: OperatingSourceType.ORDER_MATCH,
            sourceRecordId: match.id,
            sourceLineId: match.shopifyLineItemId,
            sourceTable: "OrderMatch",
            orderId: match.shopifyOrderId,
            orderLineId: match.shopifyLineItemId,
            externalOrderRef: match.shopifyOrderName,
            sku: match.shopifySku ?? null,
            confidence: match.shopifyCreatedAt ? ConfidenceLevel.HIGH : ConfidenceLevel.MEDIUM,
            metadataJson: {
              stockxOrderNumber: match.stockxOrderNumber,
              stockxPurchaseDate: match.stockxPurchaseDate
                ? match.stockxPurchaseDate.toISOString()
                : null,
              manualCostOverride: costOverride !== null && costOverride !== undefined,
            } as Prisma.InputJsonValue,
          },
          options.dryRun ?? false,
          sourceStats,
          materializedAt
        );
      }
    } catch (error) {
      console.error("[OPERATING][ORDER_MATCH] Materialize error:", error);
      sourceStats.errored += 1;
    }
  }

  if (shouldIncludeSource("GALAXUS_STOCKX_MATCH", options.sourceTypes)) {
    const sourceStats = ensureStats("GALAXUS_STOCKX_MATCH");
    try {
      const matches = await prisma.galaxusStockxMatch.findMany({
        where: {
          ...(dateFilter ? { order: { orderDate: dateFilter } } : {}),
        },
        select: {
          id: true,
          galaxusOrderId: true,
          galaxusOrderDate: true,
          galaxusOrderRef: true,
          galaxusOrderLineId: true,
          galaxusSupplierSku: true,
          galaxusCurrencyCode: true,
          stockxAmount: true,
          stockxCurrencyCode: true,
          stockxPurchaseDate: true,
          stockxOrderNumber: true,
          order: { select: { orderDate: true } },
        },
      });

      for (const match of matches) {
        const amount = toNumberSafe(match.stockxAmount, 0);
        if (amount <= 0) {
          sourceStats.skipped += 1;
          continue;
        }
        const eventDate = match.galaxusOrderDate || match.order?.orderDate || match.stockxPurchaseDate;
        if (!eventDate) {
          sourceStats.skipped += 1;
          continue;
        }

        const eventKey = buildOperatingEventKey({
          sourceType: "GALAXUS_STOCKX_MATCH",
          sourceRecordId: match.id,
          sourceLineId: match.galaxusOrderLineId,
          eventType: OperatingEventType.COGS,
        });

        if (!eventKey) {
          sourceStats.skipped += 1;
          continue;
        }

        await upsertOperatingEvent(
          {
            eventKey,
            eventDate,
            channel: "GALAXUS",
            eventType: OperatingEventType.COGS,
            direction: OperatingDirection.OUT,
            category: OperatingEventCategory.DIRECT_COST,
            amount,
            currencyCode: match.stockxCurrencyCode ?? match.galaxusCurrencyCode ?? "CHF",
            description: `Galaxus COGS ${match.galaxusOrderRef ?? match.galaxusOrderId ?? ""}`.trim(),
            sourceType: OperatingSourceType.GALAXUS_STOCKX_MATCH,
            sourceRecordId: match.id,
            sourceLineId: match.galaxusOrderLineId,
            sourceTable: "GalaxusStockxMatch",
            orderId: match.galaxusOrderId,
            orderLineId: match.galaxusOrderLineId,
            externalOrderRef: match.galaxusOrderRef,
            sku: match.galaxusSupplierSku ?? null,
            confidence: match.galaxusOrderDate ? ConfidenceLevel.HIGH : ConfidenceLevel.MEDIUM,
            metadataJson: {
              stockxOrderNumber: match.stockxOrderNumber,
              stockxPurchaseDate: match.stockxPurchaseDate
                ? match.stockxPurchaseDate.toISOString()
                : null,
            } as Prisma.InputJsonValue,
          },
          options.dryRun ?? false,
          sourceStats,
          materializedAt
        );
      }
    } catch (error) {
      console.error("[OPERATING][GALAXUS_STOCKX_MATCH] Materialize error:", error);
      sourceStats.errored += 1;
    }
  }

  if (shouldIncludeSource("DECATHLON_STOCKX_MATCH", options.sourceTypes)) {
    const sourceStats = ensureStats("DECATHLON_STOCKX_MATCH");
    try {
      const matches = await prisma.decathlonStockxMatch.findMany({
        where: {
          ...(dateFilter ? { order: { orderDate: dateFilter } } : {}),
        },
        select: {
          id: true,
          decathlonOrderId: true,
          decathlonOrderDate: true,
          decathlonOrderLineId: true,
          decathlonSupplierSku: true,
          decathlonCurrencyCode: true,
          stockxAmount: true,
          stockxCurrencyCode: true,
          stockxPurchaseDate: true,
          stockxOrderNumber: true,
          order: { select: { orderDate: true, orderNumber: true } },
        },
      });

      for (const match of matches) {
        const amount = toNumberSafe(match.stockxAmount, 0);
        if (amount <= 0) {
          sourceStats.skipped += 1;
          continue;
        }
        const eventDate = match.decathlonOrderDate || match.order?.orderDate || match.stockxPurchaseDate;
        if (!eventDate) {
          sourceStats.skipped += 1;
          continue;
        }

        const eventKey = buildOperatingEventKey({
          sourceType: "DECATHLON_STOCKX_MATCH",
          sourceRecordId: match.id,
          sourceLineId: match.decathlonOrderLineId,
          eventType: OperatingEventType.COGS,
        });

        if (!eventKey) {
          sourceStats.skipped += 1;
          continue;
        }

        await upsertOperatingEvent(
          {
            eventKey,
            eventDate,
            channel: "DECATHLON",
            eventType: OperatingEventType.COGS,
            direction: OperatingDirection.OUT,
            category: OperatingEventCategory.DIRECT_COST,
            amount,
            currencyCode: match.stockxCurrencyCode ?? match.decathlonCurrencyCode ?? "CHF",
            description: `Decathlon COGS ${match.order?.orderNumber ?? match.decathlonOrderId ?? ""}`.trim(),
            sourceType: OperatingSourceType.DECATHLON_STOCKX_MATCH,
            sourceRecordId: match.id,
            sourceLineId: match.decathlonOrderLineId,
            sourceTable: "DecathlonStockxMatch",
            orderId: match.decathlonOrderId,
            orderLineId: match.decathlonOrderLineId,
            sku: match.decathlonSupplierSku ?? null,
            confidence: match.decathlonOrderDate ? ConfidenceLevel.HIGH : ConfidenceLevel.MEDIUM,
            metadataJson: {
              stockxOrderNumber: match.stockxOrderNumber,
              stockxPurchaseDate: match.stockxPurchaseDate
                ? match.stockxPurchaseDate.toISOString()
                : null,
            } as Prisma.InputJsonValue,
          },
          options.dryRun ?? false,
          sourceStats,
          materializedAt
        );
      }
    } catch (error) {
      console.error("[OPERATING][DECATHLON_STOCKX_MATCH] Materialize error:", error);
      sourceStats.errored += 1;
    }
  }

  if (shouldIncludeSource("DAILY_AD_SPEND", options.sourceTypes)) {
    const sourceStats = ensureStats("DAILY_AD_SPEND");
    try {
      const spends = await prisma.dailyAdSpend.findMany({
        where: {
          ...(dateFilter ? { date: dateFilter } : {}),
        },
      });

      for (const spend of spends) {
        const amount = toNumberSafe(spend.amountChf, 0);
        if (amount <= 0) {
          sourceStats.skipped += 1;
          continue;
        }

        const eventKey = buildOperatingEventKey({
          sourceType: "DAILY_AD_SPEND",
          sourceRecordId: toDateKey(spend.date),
          eventType: OperatingEventType.AD_SPEND,
        });

        if (!eventKey) {
          sourceStats.skipped += 1;
          continue;
        }

        await upsertOperatingEvent(
          {
            eventKey,
            eventDate: spend.date,
            eventType: OperatingEventType.AD_SPEND,
            direction: OperatingDirection.OUT,
            category: OperatingEventCategory.MARKETING,
            amount,
            currencyCode: "CHF",
            description: "Daily ad spend",
            sourceType: OperatingSourceType.DAILY_AD_SPEND,
            sourceRecordId: toDateKey(spend.date),
            sourceTable: "DailyAdSpend",
            sourceReference: spend.channel,
            confidence: ConfidenceLevel.MEDIUM,
          },
          options.dryRun ?? false,
          sourceStats,
          materializedAt
        );
      }
    } catch (error) {
      console.error("[OPERATING][DAILY_AD_SPEND] Materialize error:", error);
      sourceStats.errored += 1;
    }
  }

  if (shouldIncludeSource("MONTHLY_VARIABLE_COST", options.sourceTypes)) {
    const sourceStats = ensureStats("MONTHLY_VARIABLE_COST");
    try {
      const rows = await prisma.monthlyVariableCosts.findMany();
      for (const row of rows) {
        const eventDate = lastDayOfMonthUtc(row.year, row.month - 1);
        if (dateFilter) {
          if (dateFilter.gte && eventDate < dateFilter.gte) continue;
          if (dateFilter.lte && eventDate > dateFilter.lte) continue;
        }

        const monthKey = row.monthKey || `${row.year}-${String(row.month).padStart(2, "0")}`;

        const postage = toNumberSafe(row.postageShippingCostChf, 0);
        if (postage > 0) {
          const eventKey = buildOperatingEventKey({
            sourceType: "MONTHLY_VARIABLE_COST",
            sourceRecordId: `${monthKey}:postage`,
            eventType: OperatingEventType.SHIPPING_COST,
          });

          if (eventKey) {
            await upsertOperatingEvent(
              {
                eventKey,
                eventDate,
                eventType: OperatingEventType.SHIPPING_COST,
                direction: OperatingDirection.OUT,
                category: OperatingEventCategory.LOGISTICS,
                subcategory: "postage_shipping",
                amount: postage,
                currencyCode: "CHF",
                description: `Monthly postage/shipping ${monthKey}`,
                sourceType: OperatingSourceType.MONTHLY_VARIABLE_COST,
                sourceRecordId: monthKey,
                sourceTable: "MonthlyVariableCosts",
                confidence: ConfidenceLevel.MEDIUM,
              },
              options.dryRun ?? false,
              sourceStats,
              materializedAt
            );
          } else {
            sourceStats.skipped += 1;
          }
        }

        const fulfillment = toNumberSafe(row.fulfillmentCostChf, 0);
        if (fulfillment > 0) {
          const eventKey = buildOperatingEventKey({
            sourceType: "MONTHLY_VARIABLE_COST",
            sourceRecordId: `${monthKey}:fulfillment`,
            eventType: OperatingEventType.SHIPPING_COST,
          });

          if (eventKey) {
            await upsertOperatingEvent(
              {
                eventKey,
                eventDate,
                eventType: OperatingEventType.SHIPPING_COST,
                direction: OperatingDirection.OUT,
                category: OperatingEventCategory.LOGISTICS,
                subcategory: "fulfillment",
                amount: fulfillment,
                currencyCode: "CHF",
                description: `Monthly fulfillment ${monthKey}`,
                sourceType: OperatingSourceType.MONTHLY_VARIABLE_COST,
                sourceRecordId: monthKey,
                sourceTable: "MonthlyVariableCosts",
                confidence: ConfidenceLevel.MEDIUM,
              },
              options.dryRun ?? false,
              sourceStats,
              materializedAt
            );
          } else {
            sourceStats.skipped += 1;
          }
        }
      }
    } catch (error) {
      console.error("[OPERATING][MONTHLY_VARIABLE_COST] Materialize error:", error);
      sourceStats.errored += 1;
    }
  }

  if (
    shouldIncludeSource("MANUAL_FINANCE_EVENT", options.sourceTypes) ||
    shouldIncludeSource("RECURRING_EXPENSE", options.sourceTypes)
  ) {
    try {
      const manualEvents = await prisma.manualFinanceEvent.findMany({
        where: {
          ...(dateFilter ? { eventDate: dateFilter } : {}),
        },
        include: { expenseCategory: true },
      });

      for (const manual of manualEvents) {
        const derivedSourceType =
          manual.sourceType === "RECURRING"
            ? OperatingSourceType.RECURRING_EXPENSE
            : OperatingSourceType.MANUAL_FINANCE_EVENT;
        if (options.sourceTypes?.length && !options.sourceTypes.includes(derivedSourceType)) {
          continue;
        }

        const sourceStats = ensureStats(derivedSourceType);
        const amount = toNumberSafe(manual.amount, 0);
        if (amount <= 0) {
          sourceStats.skipped += 1;
          continue;
        }

        const mapped = mapManualFinanceCategory(manual.category, manual.direction);
        const eventKey = buildOperatingEventKey({
          sourceType: manual.sourceType === "RECURRING"
            ? "RECURRING_EXPENSE"
            : "MANUAL_FINANCE_EVENT",
          sourceRecordId: manual.id,
          eventType: mapped.eventType,
        });

        if (!eventKey) {
          sourceStats.skipped += 1;
          continue;
        }

        await upsertOperatingEvent(
          {
            eventKey,
            eventDate: manual.eventDate,
            eventType: mapped.eventType,
            direction: manual.direction === "IN" ? OperatingDirection.IN : OperatingDirection.OUT,
            category: mapped.category,
            subcategory: manual.expenseCategory?.name ?? manual.category,
            amount,
            currencyCode: manual.currencyCode,
            description: manual.description,
            sourceType: derivedSourceType,
            sourceRecordId: manual.id,
            sourceLineId: manual.sourceId,
            sourceTable: "ManualFinanceEvent",
            sourceReference: manual.sourceType,
            confidence: ConfidenceLevel.MEDIUM,
            isManual: manual.sourceType === "MANUAL",
            manualFinanceEventId: manual.id,
            metadataJson:
              manual.metadataJson === undefined || manual.metadataJson === null
                ? undefined
                : (manual.metadataJson as Prisma.InputJsonValue),
          },
          options.dryRun ?? false,
          sourceStats,
          materializedAt
        );
      }
    } catch (error) {
      console.error("[OPERATING][MANUAL_FINANCE_EVENT] Materialize error:", error);
      for (const st of ["MANUAL_FINANCE_EVENT", "RECURRING_EXPENSE"] as const) {
        if (shouldIncludeSource(st, options.sourceTypes)) {
          ensureStats(st).errored += 1;
        }
      }
    }
  }

  if (shouldIncludeSource("PERSONAL_EXPENSE", options.sourceTypes)) {
    const sourceStats = ensureStats("PERSONAL_EXPENSE");
    try {
      const expenses = await prisma.personalExpense.findMany({
        where: {
          ...(dateFilter ? { date: dateFilter } : {}),
        },
        include: { category: true },
      });

      for (const expense of expenses) {
        if (expense.note?.includes("[RECURRING:")) {
          sourceStats.skipped += 1;
          continue;
        }
        const amount = toNumberSafe(expense.amount, 0);
        if (amount <= 0) {
          sourceStats.skipped += 1;
          continue;
        }

        const eventKey = buildOperatingEventKey({
          sourceType: "PERSONAL_EXPENSE",
          sourceRecordId: expense.id,
          eventType: OperatingEventType.OTHER_EXPENSE,
        });

        if (!eventKey) {
          sourceStats.skipped += 1;
          continue;
        }

        let mapped = getExpenseMapping(expense.category?.name);
        if (!expense.isBusiness) {
          mapped = {
            eventType: OperatingEventType.OWNER_DRAW,
            category: OperatingEventCategory.PERSONAL_DRAW,
          };
        }

        await upsertOperatingEvent(
          {
            eventKey,
            eventDate: expense.date,
            eventType: mapped.eventType,
            direction: OperatingDirection.OUT,
            category: mapped.category,
            subcategory: expense.category?.name ?? null,
            amount,
            currencyCode: expense.currencyCode,
            description: expense.note,
            sourceType: OperatingSourceType.PERSONAL_EXPENSE,
            sourceRecordId: expense.id,
            sourceTable: "PersonalExpense",
            confidence: ConfidenceLevel.MEDIUM,
            isManual: true,
          },
          options.dryRun ?? false,
          sourceStats,
          materializedAt
        );
      }
    } catch (error) {
      console.error("[OPERATING][PERSONAL_EXPENSE] Materialize error:", error);
      sourceStats.errored += 1;
    }
  }

  for (const sourceStats of Object.values(stats.bySource)) {
    addStats(stats.totals, sourceStats);
  }

  return stats;
}
