import { Prisma } from "@prisma/client";
import {
  CashOutCategory,
  ConfidenceLevel,
  ExpectedCashDerivationMethod,
  ExpectedCashSourceType,
  ExpectedCashStatus,
  FinanceCategory,
  FinanceDirection,
  MarketplaceChannel,
  OperatingDirection,
  OperatingEventStatus,
  OperatingEventType,
  OperatingSourceType,
} from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { toNumberSafe } from "@/app/utils/numbers";
import { addCalendarDays } from "@/app/lib/cashflow";
import { buildExpectedCashEventKey } from "@/app/lib/finance/keys";
import {
  applyCashInDelay,
  loadCashInRules,
  loadCashOutRules,
  maxCashInDelayDays,
  resolveCashInRule,
  resolveCashOutOffset,
} from "@/app/lib/finance/expected-cash/rules";

type SourceStats = {
  created: number;
  updated: number;
  skipped: number;
  errored: number;
};

type GenerateResult = {
  totals: SourceStats;
  bySource: Record<string, SourceStats>;
};

export type GenerateOptions = {
  from?: Date | null;
  to?: Date | null;
  sourceTypes?: OperatingSourceType[];
  channels?: MarketplaceChannel[];
  dryRun?: boolean;
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

const getDateFilter = (from?: Date | null, to?: Date | null) => {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: from } : {}),
    ...(to ? { lte: to } : {}),
  };
};

const confidenceRank: Record<ConfidenceLevel, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

const minConfidence = (a: ConfidenceLevel, b: ConfidenceLevel) =>
  confidenceRank[a] <= confidenceRank[b] ? a : b;

const mapOperatingToFinanceCategory = (eventType: OperatingEventType) => {
  switch (eventType) {
    case "SALE":
      return FinanceCategory.SALES;
    case "REFUND":
      return FinanceCategory.REFUND;
    case "COGS":
      return FinanceCategory.COGS;
    case "MARKETPLACE_COMMISSION":
      return FinanceCategory.COMMISSION;
    case "SHIPPING_COST":
      return FinanceCategory.SHIPPING;
    case "AD_SPEND":
      return FinanceCategory.ADS;
    case "SUBSCRIPTION_COST":
      return FinanceCategory.SUBSCRIPTION;
    case "OWNER_DRAW":
      return FinanceCategory.OWNER_DRAW;
    case "INSURANCE":
      return FinanceCategory.INSURANCE;
    case "FUEL":
      return FinanceCategory.FUEL;
    case "TAX":
    case "VAT":
      return FinanceCategory.TAX;
    default:
      return FinanceCategory.OTHER;
  }
};

const mapOperatingToCashOutCategory = (eventType: OperatingEventType) => {
  switch (eventType) {
    case "COGS":
      return CashOutCategory.COGS;
    case "AD_SPEND":
      return CashOutCategory.ADS;
    case "SHIPPING_COST":
      return CashOutCategory.SHIPPING;
    case "SUBSCRIPTION_COST":
      return CashOutCategory.SUBSCRIPTION;
    case "OWNER_DRAW":
      return CashOutCategory.OWNER_DRAW;
    case "INSURANCE":
      return CashOutCategory.INSURANCE;
    case "FUEL":
      return CashOutCategory.FUEL;
    default:
      return CashOutCategory.OTHER;
  }
};

const parseGatewayNames = (paymentMethod?: string | null, metadata?: Prisma.JsonValue | null) => {
  if (paymentMethod) {
    return paymentMethod
      .split("|")
      .map((name) => name.trim())
      .filter(Boolean);
  }
  if (metadata && typeof metadata === "object" && "paymentGatewayNames" in metadata) {
    const value = (metadata as { paymentGatewayNames?: string[] }).paymentGatewayNames;
    return Array.isArray(value) ? value : [];
  }
  return [];
};

const buildExpectedCashData = (input: {
  expectedEventKey: string;
  expectedDate: Date;
  amount: number;
  currencyCode: string;
  direction: FinanceDirection;
  category: FinanceCategory;
  subcategory?: string | null;
  description?: string | null;
  channel?: MarketplaceChannel | null;
  paymentMethod?: string | null;
  sourceType: ExpectedCashSourceType;
  sourceRuleId?: string | null;
  derivationMethod: ExpectedCashDerivationMethod;
  derivationVersion: string;
  operatingEventId?: string | null;
  manualFinanceEventId?: string | null;
  status: ExpectedCashStatus;
  confidence: ConfidenceLevel;
  notes?: string | null;
  metadataJson?: Prisma.JsonValue | null;
}) => ({
  expectedEventKey: input.expectedEventKey,
  expectedDate: input.expectedDate,
  amount: new Prisma.Decimal(Math.abs(input.amount)),
  currencyCode: input.currencyCode,
  direction: input.direction,
  category: input.category,
  subcategory: input.subcategory ?? null,
  description: input.description ?? null,
  channel: input.channel ?? null,
  paymentMethod: input.paymentMethod ?? null,
  sourceType: input.sourceType,
  sourceRuleId: input.sourceRuleId ?? null,
  derivationMethod: input.derivationMethod,
  derivationVersion: input.derivationVersion,
  operatingEventId: input.operatingEventId ?? null,
  manualFinanceEventId: input.manualFinanceEventId ?? null,
  isActualized: false,
  actualizedByBankTransactionId: null,
  status: input.status,
  confidence: input.confidence,
  notes: input.notes ?? null,
  metadataJson:
    input.metadataJson === undefined || input.metadataJson === null
      ? undefined
      : (input.metadataJson as Prisma.InputJsonValue),
});

const upsertExpectedCashEvent = async (
  data: ReturnType<typeof buildExpectedCashData>,
  dryRun: boolean,
  stats: SourceStats
) => {
  if (!data.expectedEventKey || data.amount.lte(0)) {
    stats.skipped += 1;
    return;
  }

  const existing = await prisma.expectedCashEvent.findUnique({
    where: { expectedEventKey: data.expectedEventKey },
    select: {
      id: true,
      isActualized: true,
      status: true,
      actualizedByBankTransactionId: true,
    },
  });

  if (dryRun) {
    if (existing) {
      stats.updated += 1;
    } else {
      stats.created += 1;
    }
    return;
  }

  if (existing) {
    const preserveActualization =
      existing.isActualized || existing.status === "ACTUALIZED";
    const updateData = preserveActualization
      ? {
          ...data,
          isActualized: existing.isActualized,
          actualizedByBankTransactionId: existing.actualizedByBankTransactionId,
          status: existing.status,
        }
      : data;
    await prisma.expectedCashEvent.update({
      where: { expectedEventKey: data.expectedEventKey },
      data: updateData,
    });
    stats.updated += 1;
  } else {
    await prisma.expectedCashEvent.create({ data });
    stats.created += 1;
  }
};

export async function generateExpectedCashEvents(
  options: GenerateOptions = {}
): Promise<GenerateResult> {
  const stats: GenerateResult = { totals: emptyStats(), bySource: {} };

  const cashInRules = await loadCashInRules();
  const cashOutRules = await loadCashOutRules();
  const maxDelay = maxCashInDelayDays(cashInRules);

  const windowStart = options.from
    ? addCalendarDays(options.from, -(maxDelay + 7))
    : null;
  const windowEnd = options.to
    ? addCalendarDays(options.to, maxDelay + 7)
    : null;
  const dateFilter = getDateFilter(windowStart, windowEnd);

  const ensureStats = (source: OperatingSourceType) => {
    if (!stats.bySource[source]) {
      stats.bySource[source] = emptyStats();
    }
    return stats.bySource[source];
  };

  const where: Prisma.OperatingEventWhereInput = {
    ...(dateFilter ? { eventDate: dateFilter } : {}),
    ...(options.sourceTypes?.length ? { sourceType: { in: options.sourceTypes } } : {}),
    ...(options.channels?.length ? { channel: { in: options.channels } } : {}),
  };

  const events = await prisma.operatingEvent.findMany({
    where,
    orderBy: { eventDate: "asc" },
  });

  for (const event of events) {
    const sourceStats = ensureStats(event.sourceType);
    try {
      if (event.status === OperatingEventStatus.VOID || event.status === OperatingEventStatus.SUPERSEDED) {
        sourceStats.skipped += 1;
        continue;
      }

      if (event.direction === OperatingDirection.NEUTRAL) {
        sourceStats.skipped += 1;
        continue;
      }

      const amount = toNumberSafe(event.amount, 0);
      if (amount <= 0) {
        sourceStats.skipped += 1;
        continue;
      }

      const direction: FinanceDirection =
        event.direction === OperatingDirection.IN ? "IN" : "OUT";

      let expectedDate = event.eventDate;
      let derivationMethod: ExpectedCashDerivationMethod = ExpectedCashDerivationMethod.SAME_DAY;
      let sourceRuleId: string | null = null;
      let confidence = event.confidence as ConfidenceLevel;
      let metadata: Prisma.JsonValue | null = null;

      if (event.eventType === OperatingEventType.SALE && event.channel) {
        const gatewayNames = parseGatewayNames(event.paymentMethod, event.metadataJson);
        const { rule, matchType } = resolveCashInRule(
          event.channel as MarketplaceChannel,
          gatewayNames,
          cashInRules
        );

        if (rule) {
          expectedDate = applyCashInDelay(event.eventDate, rule);
          derivationMethod = ExpectedCashDerivationMethod.RULE_BASED;
          sourceRuleId = rule.id ?? null;
          if (matchType === "fallback") {
            confidence = ConfidenceLevel.LOW;
          } else if (matchType === "channelDefault" && confidence === ConfidenceLevel.HIGH) {
            confidence = ConfidenceLevel.MEDIUM;
          }
          metadata = {
            ruleMatchType: matchType,
            ruleDelayType: rule.delayType,
            ruleDelayDays: rule.delayValueDays,
          };
        } else {
          confidence = ConfidenceLevel.LOW;
        }
      }

      if (direction === "OUT" && event.eventType !== OperatingEventType.REFUND) {
        const cashOutCategory = mapOperatingToCashOutCategory(event.eventType);
        const { offsetDays, ruleId } = resolveCashOutOffset(
          cashOutCategory,
          event.eventDate,
          cashOutRules
        );
        if (offsetDays !== 0) {
          expectedDate = addCalendarDays(event.eventDate, offsetDays);
          derivationMethod = ExpectedCashDerivationMethod.OFFSET_DAYS;
          sourceRuleId = ruleId;
        }
      }

      if (options.from && expectedDate < options.from) {
        sourceStats.skipped += 1;
        continue;
      }
      if (options.to && expectedDate > options.to) {
        sourceStats.skipped += 1;
        continue;
      }

      if (event.status === OperatingEventStatus.PENDING_REVIEW || event.status === OperatingEventStatus.PARTIAL) {
        confidence = minConfidence(confidence, ConfidenceLevel.MEDIUM);
      }

      const expectedEventKey = buildExpectedCashEventKey({
        operatingEventId: event.id,
        derivationMethod,
        suffix: event.eventType,
      });

      if (!expectedEventKey) {
        sourceStats.skipped += 1;
        continue;
      }

      const data = buildExpectedCashData({
        expectedEventKey,
        expectedDate,
        amount,
        currencyCode: event.currencyCode,
        direction,
        category: mapOperatingToFinanceCategory(event.eventType),
        subcategory: event.subcategory ?? null,
        description: event.description ?? null,
        channel: event.channel,
        paymentMethod: event.paymentMethod,
        sourceType: ExpectedCashSourceType.OPERATING_EVENT,
        sourceRuleId,
        derivationMethod,
        derivationVersion: "v1",
        operatingEventId: event.id,
        manualFinanceEventId: event.manualFinanceEventId,
        status: ExpectedCashStatus.PENDING,
        confidence,
        metadataJson: {
          operatingEventKey: event.eventKey,
          ...((metadata as Prisma.JsonObject) ?? {}),
        },
      });

      await upsertExpectedCashEvent(data, options.dryRun ?? false, sourceStats);
    } catch (error) {
      console.error("[EXPECTED_CASH] Generate error:", error);
      sourceStats.errored += 1;
    }
  }

  for (const sourceStats of Object.values(stats.bySource)) {
    addStats(stats.totals, sourceStats);
  }

  return stats;
}
