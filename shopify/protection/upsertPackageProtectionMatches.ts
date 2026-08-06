import { prisma } from "@/app/lib/prisma";
import { isPackageProtectionShopifyLine } from "@/app/utils/matching";
import { toShopifyCreatedAtStorage } from "@/app/utils/shopifySellDate";

export const PACKAGE_PROTECTION_MATCH_TYPE = "package_protection";
export const PACKAGE_PROTECTION_STATUS = "PACKAGE_PROTECTION";

export type PackageProtectionLineInput = {
  shopifyOrderId: string;
  shopifyOrderName: string;
  shopifyLineItemId: string;
  shopifyProductTitle: string;
  shopifySku?: string | null;
  shopifyTotalPrice: number;
  shopifyCurrencyCode?: string | null;
  shopifyCreatedAt: Date | string;
  shopifyCustomerEmail?: string | null;
  shopifyCustomerFirstName?: string | null;
  shopifyCustomerLastName?: string | null;
};

export type UpsertPackageProtectionResult = {
  considered: number;
  upserted: number;
  skipped: number;
};

function toDate(value: Date | string): Date {
  const raw = value instanceof Date ? value : new Date(value);
  // Match save-match: Zurich wall-clock stored as UTC for sell-date grouping.
  return toShopifyCreatedAtStorage(raw);
}

function supplierRef(lineItemId: string): string {
  return `pp:${lineItemId}`;
}

/** Persist package-protection Shopify lines as 100% margin OrderMatch rows (cost 0). */
export async function upsertPackageProtectionMatches(
  lines: PackageProtectionLineInput[]
): Promise<UpsertPackageProtectionResult> {
  let considered = 0;
  let upserted = 0;
  let skipped = 0;

  for (const line of lines) {
    if (!isPackageProtectionShopifyLine(line.shopifyProductTitle, line.shopifySku)) {
      skipped += 1;
      continue;
    }
    if (!line.shopifyLineItemId || !line.shopifyOrderId) {
      skipped += 1;
      continue;
    }

    considered += 1;
    const revenue = Number(Number(line.shopifyTotalPrice || 0).toFixed(2));
    if (revenue < 0) {
      skipped += 1;
      continue;
    }

    const createdAt = toDate(line.shopifyCreatedAt);
    const ref = supplierRef(line.shopifyLineItemId);

    await prisma.orderMatch.upsert({
      where: { shopifyLineItemId: line.shopifyLineItemId },
      create: {
        shopifyOrderId: line.shopifyOrderId,
        shopifyOrderName: line.shopifyOrderName,
        shopifyLineItemId: line.shopifyLineItemId,
        shopifyProductTitle: line.shopifyProductTitle,
        shopifySku: line.shopifySku ?? null,
        shopifyTotalPrice: revenue,
        shopifyCurrencyCode: line.shopifyCurrencyCode || "CHF",
        shopifyCreatedAt: createdAt,
        shopifyCustomerEmail: line.shopifyCustomerEmail ?? null,
        shopifyCustomerFirstName: line.shopifyCustomerFirstName ?? null,
        shopifyCustomerLastName: line.shopifyCustomerLastName ?? null,
        supplierSource: "OTHER",
        stockxOrderNumber: ref,
        stockxProductName: line.shopifyProductTitle,
        matchConfidence: "high",
        matchScore: 100,
        matchType: PACKAGE_PROTECTION_MATCH_TYPE,
        matchReasons: JSON.stringify(["package_protection_auto"]),
        stockxStatus: PACKAGE_PROTECTION_STATUS,
        supplierCost: 0,
        marginAmount: revenue,
        marginPercent: revenue > 0 ? 100 : 0,
        shopifyMetafieldsSynced: true,
      },
      update: {
        shopifyOrderName: line.shopifyOrderName,
        shopifyProductTitle: line.shopifyProductTitle,
        shopifySku: line.shopifySku ?? null,
        shopifyTotalPrice: revenue,
        shopifyCurrencyCode: line.shopifyCurrencyCode || "CHF",
        shopifyCreatedAt: createdAt,
        shopifyCustomerEmail: line.shopifyCustomerEmail ?? null,
        shopifyCustomerFirstName: line.shopifyCustomerFirstName ?? null,
        shopifyCustomerLastName: line.shopifyCustomerLastName ?? null,
        supplierSource: "OTHER",
        stockxOrderNumber: ref,
        stockxProductName: line.shopifyProductTitle,
        matchConfidence: "high",
        matchScore: 100,
        matchType: PACKAGE_PROTECTION_MATCH_TYPE,
        matchReasons: JSON.stringify(["package_protection_auto"]),
        stockxStatus: PACKAGE_PROTECTION_STATUS,
        supplierCost: 0,
        marginAmount: revenue,
        marginPercent: revenue > 0 ? 100 : 0,
        shopifyMetafieldsSynced: true,
        manualCostOverride: null,
      },
    });
    upserted += 1;
  }

  return { considered, upserted, skipped };
}
