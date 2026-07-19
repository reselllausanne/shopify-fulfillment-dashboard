import { prisma } from "@/app/lib/prisma";

export const STOCKX_DELIVERED_MILESTONE_KEYS = [
  "EXPRESS_DELIVERED_TO_SWISS",
  "DELIVERED_TO_SWISS_DISTRIBUTOR",
] as const;

export function parseOptionalDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(d.getTime()) ? d : null;
}

export function secondsBetween(start: Date | null, end: Date | null): number | null {
  if (!start || !end) return null;
  const ms = end.getTime() - start.getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.round(ms / 1000);
}

export function minutesBetween(start: Date | null, end: Date | null): number | null {
  if (!start || !end) return null;
  const ms = end.getTime() - start.getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.round(ms / 60_000);
}

export type StockxDeliveredInfo = {
  stockxDeliveredAt: Date | null;
  stockxDeliveredMilestoneKey: string | null;
};

export async function resolveStockxDeliveredForMatches(
  orderMatchIds: string[]
): Promise<StockxDeliveredInfo> {
  const ids = orderMatchIds.map((id) => String(id || "").trim()).filter(Boolean);
  if (ids.length === 0) {
    return { stockxDeliveredAt: null, stockxDeliveredMilestoneKey: null };
  }

  const event = await prisma.stockXStatusEvent.findFirst({
    where: {
      orderMatchId: { in: ids },
      milestoneKey: { in: [...STOCKX_DELIVERED_MILESTONE_KEYS] },
    },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true, milestoneKey: true },
  });

  if (!event) {
    return { stockxDeliveredAt: null, stockxDeliveredMilestoneKey: null };
  }

  return {
    stockxDeliveredAt: event.createdAt,
    stockxDeliveredMilestoneKey: event.milestoneKey,
  };
}

export type FulfillmentTimingInput = {
  actorRole: string | null;
  scanSessionKey: string | null;
  scanStartedAt: Date | null;
  scanCompletedAt: Date | null;
  requestStartedAt: Date;
  requestCompletedAt: Date;
  labelGeneratedAt: Date | null;
  stockxDeliveredAt: Date | null;
  stockxDeliveredMilestoneKey: string | null;
};

export function buildFulfillmentTimingFields(input: FulfillmentTimingInput) {
  const requestDurationMs = Math.max(
    0,
    input.requestCompletedAt.getTime() - input.requestStartedAt.getTime()
  );
  const fulfillAt = input.requestCompletedAt;
  const stockxDeliveredToFulfillmentMinutes = minutesBetween(
    input.stockxDeliveredAt,
    fulfillAt
  );

  return {
    actorRole: input.actorRole,
    scanSessionKey: input.scanSessionKey,
    scanStartedAt: input.scanStartedAt,
    scanCompletedAt: input.scanCompletedAt,
    requestStartedAt: input.requestStartedAt,
    requestCompletedAt: input.requestCompletedAt,
    requestDurationMs,
    labelGeneratedAt: input.labelGeneratedAt,
    stockxDeliveredAt: input.stockxDeliveredAt,
    stockxDeliveredMilestoneKey: input.stockxDeliveredMilestoneKey,
    stockxDeliveredLagMinutes: stockxDeliveredToFulfillmentMinutes,
    scanToLabelSeconds: secondsBetween(input.scanStartedAt, input.labelGeneratedAt),
    scanToFulfillmentSeconds: secondsBetween(input.scanStartedAt, fulfillAt),
    stockxDeliveredToScanMinutes: minutesBetween(
      input.stockxDeliveredAt,
      input.scanStartedAt
    ),
    stockxDeliveredToFulfillmentMinutes,
  };
}

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function avg(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
