import { prisma } from "@/app/lib/prisma";
import type { ReturnReason } from "@prisma/client";
import type { RequestedShopifyReturnLine } from "@/shopify/returns/requestedReturns";
import { computeReturnRestockingFeeTotal } from "@/shopify/returns/restockingFee";

export type ApplyShopifyReturnToOrderMatchesInput = {
  externalOrderId: string;
  lineItems: RequestedShopifyReturnLine[];
  returnReasonCode?: string | null;
  marketplaceReturnId?: string;
  appliedAt?: Date;
};

export type ApplyShopifyReturnToOrderMatchesResult = {
  updatedMatchIds: string[];
  skipped: Array<{ sku: string | null; reason: string }>;
};

function clampDecimal(value: number, maxAbs = 999.99): number {
  if (!Number.isFinite(value)) return 0;
  if (value > maxAbs) return maxAbs;
  if (value < -maxAbs) return -maxAbs;
  return Math.round(value * 100) / 100;
}

export function normalizeOrderRef(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .replace(/^#/, "")
    .toLowerCase();
}

export function orderRefsMatch(
  match: { shopifyOrderId: string; shopifyOrderName: string },
  externalOrderId: string
): boolean {
  const ext = normalizeOrderRef(externalOrderId);
  if (!ext) return false;

  if (normalizeOrderRef(match.shopifyOrderName) === ext) return true;
  if (normalizeOrderRef(match.shopifyOrderId) === ext) return true;

  const extDigits = ext.replace(/\D/g, "");
  const idDigits = String(match.shopifyOrderId || "").replace(/\D/g, "");
  if (extDigits && idDigits && extDigits === idDigits) return true;

  return false;
}

export function mapShopifyReturnReason(code?: string | null): ReturnReason {
  const normalized = String(code || "").trim().toUpperCase();
  if (normalized.includes("EXCHANGE") || normalized.includes("SWAP")) return "EXCHANGE";
  if (
    normalized.includes("DAMAGE") ||
    normalized.includes("DEFECT") ||
    normalized.includes("BROKEN")
  ) {
    return "DAMAGE";
  }
  return "STORE_CREDIT";
}

export function computeLineReturnFee(input: {
  line: RequestedShopifyReturnLine;
  fallbackGrossAmount?: number;
}): { feeAmount: number; feePercent: number | null; grossAmount: number } {
  const unitAmount = Number(input.line.unitAmount) || 0;
  const qty = Math.max(1, Math.trunc(Number(input.line.quantity) || 1));
  const grossAmount =
    unitAmount > 0
      ? Number((unitAmount * qty).toFixed(2))
      : Number(input.fallbackGrossAmount || 0);

  const feeResult = computeReturnRestockingFeeTotal({
    lineItems: [input.line as unknown as Record<string, unknown>],
    grossAmount,
  });

  const feeAmount = feeResult.restockingFeeTotal;
  const feePercent =
    grossAmount > 0 ? clampDecimal((feeAmount / grossAmount) * 100, 100) : null;

  return { feeAmount, feePercent, grossAmount };
}

function normalizeSku(value: string | null | undefined): string | null {
  const sku = String(value || "").trim();
  return sku || null;
}

export async function applyShopifyReturnToOrderMatches(
  input: ApplyShopifyReturnToOrderMatchesInput
): Promise<ApplyShopifyReturnToOrderMatchesResult> {
  const appliedAt = input.appliedAt ?? new Date();
  const returnReason = mapShopifyReturnReason(input.returnReasonCode);
  const updatedMatchIds: string[] = [];
  const skipped: Array<{ sku: string | null; reason: string }> = [];

  const candidates = await prisma.orderMatch.findMany({
    where: {
      OR: [
        { shopifyOrderName: input.externalOrderId },
        { shopifyOrderId: input.externalOrderId },
        ...(normalizeOrderRef(input.externalOrderId)
          ? [{ shopifyOrderName: `#${normalizeOrderRef(input.externalOrderId)}` }]
          : []),
      ],
    },
    select: {
      id: true,
      shopifyOrderId: true,
      shopifyOrderName: true,
      shopifySku: true,
      shopifyTotalPrice: true,
      supplierCost: true,
      manualCostOverride: true,
      returnReason: true,
      manualNote: true,
    },
  });

  const orderMatches = candidates.filter((match) =>
    orderRefsMatch(match, input.externalOrderId)
  );

  if (!orderMatches.length) {
    skipped.push({
      sku: null,
      reason: `No OrderMatch for order ${input.externalOrderId}`,
    });
    return { updatedMatchIds, skipped };
  }

  const lines = input.lineItems.filter((line) => normalizeSku(line.sku));
  const targets =
    lines.length > 0
      ? lines
      : orderMatches.map((match) => ({
          id: "",
          title: "",
          sku: match.shopifySku,
          variantTitle: null,
          quantity: 1,
          unitAmount: Number(match.shopifyTotalPrice) || null,
          currencyCode: null,
          returnReason: input.returnReasonCode ?? null,
          returnReasonLabel: null,
          customerNote: null,
          restockingFeePercent: null,
          restockingFeeAmount: null,
        }));

  for (const line of targets) {
    const sku = normalizeSku(line.sku);
    const match = sku
      ? orderMatches.find((row) => normalizeSku(row.shopifySku) === sku)
      : orderMatches.length === 1
        ? orderMatches[0]
        : null;

    if (!match) {
      skipped.push({ sku, reason: "No matching line on order" });
      continue;
    }

    if (match.returnReason) {
      skipped.push({ sku, reason: "Return already applied" });
      continue;
    }

    const revenue = Number(match.shopifyTotalPrice);
    const effectiveCost =
      match.manualCostOverride != null
        ? Number(match.manualCostOverride)
        : Number(match.supplierCost);
    const { feeAmount, feePercent } = computeLineReturnFee({
      line,
      fallbackGrossAmount: revenue,
    });
    const effectiveRevenue = feeAmount;
    const marginAmount = effectiveRevenue - effectiveCost;
    const marginPercent =
      effectiveRevenue > 0 ? clampDecimal((marginAmount / effectiveRevenue) * 100) : 0;

    const notePrefix = input.marketplaceReturnId
      ? `Auto return from receipt ${input.marketplaceReturnId}`
      : "Auto return from Shopify receipt";

    await prisma.orderMatch.update({
      where: { id: match.id },
      data: {
        manualCaseStatus: "RETURNED",
        returnReason,
        returnFeePercent: feePercent,
        returnFeeAmountChf: effectiveRevenue,
        returnAppliedAt: appliedAt,
        returnedStockValueChf: effectiveCost,
        marginAmount,
        marginPercent,
        manualNote: match.manualNote
          ? `${match.manualNote}\n${notePrefix}`
          : notePrefix,
        updatedAt: appliedAt,
      },
    });

    updatedMatchIds.push(match.id);
  }

  return { updatedMatchIds, skipped };
}
