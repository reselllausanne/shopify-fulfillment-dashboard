import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { EXCLUDED_SKUS, isLiquidationShopifyTitle } from "@/app/utils/matching";

export const runtime = "nodejs";

type TrackingItem = {
  id: string;
  shopifyOrderName: string;
  shopifyProductTitle: string;
  shopifySku: string | null;
  stockxOrderNumber: string;
  supplierSource: string | null;
  shopifyCreatedAt: Date | null;
  stockxPurchaseDate: Date | null;
  stockxEstimatedDelivery: Date | null;
  stockxLatestEstimatedDelivery: Date | null;
};

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const CUTOFF_DATE = new Date("2026-02-01T00:00:00.000Z");
const CRITICAL_AGE_DAYS = 9;

const isExcludedNoTracking = (sku: string | null, title: string) => {
  if (sku && EXCLUDED_SKUS.includes(sku)) return true;
  if (isLiquidationShopifyTitle(title)) return true;
  if (/liquidation/i.test(title)) return true;
  return false;
};

export async function GET() {
  try {
    const items = await prisma.orderMatch.findMany({
      where: {
        OR: [{ stockxTrackingUrl: null }, { stockxTrackingUrl: "" }],
      },
      orderBy: { shopifyCreatedAt: "desc" },
      take: 100,
      select: {
        id: true,
        shopifyOrderName: true,
        shopifyProductTitle: true,
        shopifySku: true,
        stockxOrderNumber: true,
        supplierSource: true,
        shopifyCreatedAt: true,
        stockxPurchaseDate: true,
        stockxEstimatedDelivery: true,
        stockxLatestEstimatedDelivery: true,
      },
    });

    const now = new Date();
    const normalized = items
      .filter((item: TrackingItem) => {
        if (isExcludedNoTracking(item.shopifySku, item.shopifyProductTitle || "")) return false;
        const createdAt = item.shopifyCreatedAt || item.stockxPurchaseDate;
        if (createdAt && createdAt < CUTOFF_DATE) return false;
        return true;
      })
      .map((item: TrackingItem) => {
      const createdAt = item.shopifyCreatedAt || item.stockxPurchaseDate;
      const ageDays =
        createdAt ? Math.floor((now.getTime() - createdAt.getTime()) / MS_PER_DAY) : null;

      const deliveryDate = item.stockxLatestEstimatedDelivery || item.stockxEstimatedDelivery;
      const daysToDelivery =
        deliveryDate ? Math.ceil((deliveryDate.getTime() - now.getTime()) / MS_PER_DAY) : null;

      const isOverdue = daysToDelivery != null && daysToDelivery < 0;
      const isDueSoon = daysToDelivery != null && daysToDelivery <= 2 && daysToDelivery >= 0;
      const isOlderThan9 = ageDays != null && ageDays >= CRITICAL_AGE_DAYS;
      const isOver9Days = ageDays != null && ageDays > CRITICAL_AGE_DAYS;
      const isGoat = item.stockxOrderNumber?.toUpperCase().includes("GOAT") ?? false;

      return {
        ...item,
        ageDays,
        deliveryDate,
        daysToDelivery,
        isOverdue,
        isDueSoon,
        isOlderThan9,
        isOver9Days,
        isGoat,
      };
    });

    const goatItems = normalized.filter((i) => i.isGoat);
    const warningItems = normalized.filter((i) => i.isOver9Days && !i.isOverdue && !i.isDueSoon);
    // Avoid duplicate rows: "warning" is the >9d age-only bucket; critical keeps overdue/due-soon and 9d edge case.
    const criticalItems = normalized.filter((i) => {
      const inWarningOnlyBucket =
        i.isOver9Days && !i.isOverdue && !i.isDueSoon;
      if (inWarningOnlyBucket) return false;
      return i.isOverdue || i.isDueSoon || i.isOlderThan9;
    });

    return NextResponse.json({
      ok: true,
      count: normalized.length,
      goatCount: goatItems.length,
      criticalCount: criticalItems.length,
      warningCount: warningItems.length,
      items: normalized,
      goatItems,
      criticalItems,
      warningItems,
    });
  } catch (error: any) {
    console.error("[MISSING_TRACKING] Failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to load missing tracking" },
      { status: 500 }
    );
  }
}
