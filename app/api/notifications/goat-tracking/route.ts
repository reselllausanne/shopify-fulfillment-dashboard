import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

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

    return NextResponse.json({
      ok: true,
      count: items.length,
      items,
    });
  } catch (error: any) {
    console.error("[GOAT_TRACKING] Failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to load GOAT tracking" },
      { status: 500 }
    );
  }
}
