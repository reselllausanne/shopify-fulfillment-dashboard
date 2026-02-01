import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { EXCLUDED_SKUS } from "@/app/utils/matching";

export const runtime = "nodejs";

export async function GET() {
  try {
    const items = await prisma.orderMatch.findMany({
      where: {
        AND: [
          {
            OR: [{ stockxTrackingUrl: null }, { stockxTrackingUrl: "" }],
          },
          {
            OR: [
              { supplierSource: "OTHER" },
              { stockxOrderNumber: { contains: "GOAT", mode: "insensitive" } },
            ],
          },
        ],
      },
      orderBy: { shopifyCreatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        shopifyOrderName: true,
        shopifyProductTitle: true,
        shopifySku: true,
        shopifyLineItemId: true,
        shopifyCustomerEmail: true,
        shopifyCustomerFirstName: true,
        shopifyCustomerLastName: true,
        shopifyCreatedAt: true,
        stockxOrderNumber: true,
        stockxAwb: true,
        stockxTrackingUrl: true,
        supplierSource: true,
      },
    });

    const cutoff = new Date("2026-02-01T00:00:00.000Z");
    const filtered = items.filter((item: any) => {
      const sku = item.shopifySku ?? null;
      const title = item.shopifyProductTitle || "";
      if (sku && EXCLUDED_SKUS.includes(sku)) return false;
      if (/%/.test(title)) return false; // liquidation
      if (/liquidation/i.test(title)) return false;
      const createdAt = item.shopifyCreatedAt ? new Date(item.shopifyCreatedAt) : null;
      if (createdAt && createdAt < cutoff) return false;
      return true;
    });

    return NextResponse.json({
      ok: true,
      count: filtered.length,
      items: filtered,
    });
  } catch (error: any) {
    console.error("[GOAT_TRACKING] Failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to load GOAT tracking" },
      { status: 500 }
    );
  }
}
