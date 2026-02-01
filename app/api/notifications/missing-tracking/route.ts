import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { EXCLUDED_SKUS } from "@/app/utils/matching";

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

const isExcludedNoTracking = (sku: string | null, title: string) => {
  if (sku && EXCLUDED_SKUS.includes(sku)) return true;
  if (/%/.test(title)) return true; // liquidation
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
      const isOlderThan14 = ageDays != null && ageDays >= 14;
      const isGoat = item.stockxOrderNumber?.toUpperCase().includes("GOAT") ?? false;

      return {
        ...item,
        ageDays,
        deliveryDate,
        daysToDelivery,
        isOverdue,
        isDueSoon,
        isOlderThan14,
        isGoat,
      };
    });

    const goatItems = normalized.filter((i) => i.isGoat);
    const criticalItems = normalized.filter((i) => i.isOverdue || i.isDueSoon || i.isOlderThan14);

    return NextResponse.json({
      ok: true,
      count: normalized.length,
      goatCount: goatItems.length,
      criticalCount: criticalItems.length,
      items: normalized,
      goatItems,
      criticalItems,
    });
  } catch (error: any) {
    console.error("[MISSING_TRACKING] Failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to load missing tracking" },
      { status: 500 }
    );
  }
}
