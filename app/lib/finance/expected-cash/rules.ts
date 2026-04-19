import { prisma } from "@/app/lib/prisma";
import { toNumberSafe } from "@/app/utils/numbers";
import {
  CashInDelayType,
  CashOutCategory,
  MarketplaceChannel,
} from "@prisma/client";
import { addBusinessDays, addCalendarDays, nextFriday } from "@/app/lib/cashflow";

export type CashInRuleRow = {
  id?: string;
  channel: MarketplaceChannel;
  paymentMethod: string | null;
  delayType: CashInDelayType;
  delayValueDays: number | null;
  priority: number;
  isFallback?: boolean;
};

export type CashOutRuleRow = {
  id: string;
  category: CashOutCategory;
  offsetDays: number | null;
  startDate: Date | null;
  endDate: Date | null;
  active: boolean;
};

export type CashInRuleMatchType = "paymentMethod" | "channelDefault" | "fallback";

const DEFAULT_RULES: CashInRuleRow[] = [
  { channel: "SHOPIFY", paymentMethod: "paypal", delayType: "BUSINESS_DAYS", delayValueDays: 6, priority: 300, isFallback: false },
  { channel: "SHOPIFY", paymentMethod: "twint", delayType: "BUSINESS_DAYS", delayValueDays: 3, priority: 300, isFallback: false },
  { channel: "SHOPIFY", paymentMethod: "powerpay", delayType: "NEXT_FRIDAY", delayValueDays: null, priority: 300, isFallback: false },
  { channel: "SHOPIFY", paymentMethod: null, delayType: "BUSINESS_DAYS", delayValueDays: 4.5, priority: 100, isFallback: false },
  { channel: "GALAXUS", paymentMethod: null, delayType: "CALENDAR_DAYS", delayValueDays: 10, priority: 100, isFallback: false },
  { channel: "DECATHLON", paymentMethod: null, delayType: "CALENDAR_DAYS", delayValueDays: 30, priority: 100, isFallback: false },
];

const matchGateways = (gatewayNames: string[] | null | undefined, paymentMethod: string) => {
  if (!gatewayNames?.length) return false;
  const needle = paymentMethod.toLowerCase();
  return gatewayNames.some((name) => name.toLowerCase().includes(needle));
};

export const loadCashInRules = async (): Promise<CashInRuleRow[]> => {
  const rules = await prisma.cashInRule.findMany({
    where: { active: true },
    orderBy: [{ priority: "desc" }],
  });

  if (!rules.length) {
    return DEFAULT_RULES.map((rule) => ({ ...rule, isFallback: true }));
  }

  return rules.map((rule) => ({
    id: rule.id,
    channel: rule.channel,
    paymentMethod: rule.paymentMethod,
    delayType: rule.delayType,
    delayValueDays: rule.delayValueDays ? toNumberSafe(rule.delayValueDays, 0) : null,
    priority: rule.priority,
  }));
};

export const loadCashOutRules = async (): Promise<CashOutRuleRow[]> => {
  const rules = await prisma.cashOutRule.findMany({
    where: { active: true },
  });
  return rules.map((rule) => ({
    id: rule.id,
    category: rule.category,
    offsetDays: rule.offsetDays ?? null,
    startDate: rule.startDate ?? null,
    endDate: rule.endDate ?? null,
    active: rule.active,
  }));
};

export const resolveCashInRule = (
  channel: MarketplaceChannel,
  gatewayNames: string[] | null | undefined,
  rules: CashInRuleRow[]
) => {
  const channelRules = rules
    .filter((rule) => rule.channel === channel)
    .sort((a, b) => b.priority - a.priority);

  if (!channelRules.length) {
    return { rule: null, matchType: "fallback" as CashInRuleMatchType };
  }

  const methodRule = channelRules.find(
    (rule) => rule.paymentMethod && matchGateways(gatewayNames, rule.paymentMethod)
  );

  if (methodRule) {
    return { rule: methodRule, matchType: "paymentMethod" as CashInRuleMatchType };
  }

  const channelDefault = channelRules.find((rule) => !rule.paymentMethod);
  if (channelDefault) {
    return { rule: channelDefault, matchType: "channelDefault" as CashInRuleMatchType };
  }

  return { rule: channelRules[0], matchType: "fallback" as CashInRuleMatchType };
};

export const applyCashInDelay = (orderDate: Date, rule: CashInRuleRow) => {
  if (rule.delayType === "NEXT_FRIDAY") {
    return nextFriday(orderDate);
  }
  const delay = rule.delayValueDays ?? 0;
  if (rule.delayType === "BUSINESS_DAYS") {
    return addBusinessDays(orderDate, delay);
  }
  return addCalendarDays(orderDate, delay);
};

export const maxCashInDelayDays = (rules: CashInRuleRow[]) =>
  rules.reduce((max, rule) => {
    if (rule.delayType === "NEXT_FRIDAY") return Math.max(max, 7);
    const val = rule.delayValueDays ?? 0;
    return Math.max(max, Math.ceil(val));
  }, 0);

const matchesRuleWindow = (date: Date, rule: CashOutRuleRow) => {
  if (rule.startDate && date < rule.startDate) return false;
  if (rule.endDate && date > rule.endDate) return false;
  return true;
};

export const resolveCashOutOffset = (
  category: CashOutCategory,
  date: Date,
  rules: CashOutRuleRow[]
) => {
  const rule = rules.find((candidate) => candidate.category === category && matchesRuleWindow(date, candidate));
  if (!rule || rule.offsetDays === null || rule.offsetDays === undefined) {
    return { offsetDays: 0, ruleId: null };
  }
  return { offsetDays: rule.offsetDays, ruleId: rule.id };
};
