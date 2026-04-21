import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { resolveDecathlonReturnOfferSku } from "@/decathlon/returns/resolveReturnOfferSku";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? "200"), 1), 500);
    const prismaAny = prisma as any;
    const items = await prismaAny.decathlonReturnLine.findMany({
      take: limit,
      orderBy: { updatedAt: "desc" },
      include: {
        decathlonReturn: {
          select: {
            returnId: true,
            orderId: true,
            status: true,
            updatedAt: true,
            order: { select: { id: true } },
          },
        },
        orderLine: { select: { productTitle: true, size: true, offerSku: true } },
      },
    });
    return NextResponse.json({
      ok: true,
      items: items.map((row: any) => ({
        id: row.id,
        returnId: row.decathlonReturn?.returnId ?? row.returnId,
        orderId: row.decathlonReturn?.orderId ?? null,
        decathlonOrderDbId: row.decathlonReturn?.order?.id ?? null,
        status: row.decathlonReturn?.status ?? null,
        offerSku: resolveDecathlonReturnOfferSku(row),
        productTitle: row.orderLine?.productTitle ?? null,
        size: row.orderLine?.size ?? null,
        quantity: row.quantity,
        unitPrice: row.unitPrice,
        returnPrice: row.returnPrice,
        currencyCode: row.currencyCode ?? "CHF",
        restockAppliedAt: row.restockAppliedAt,
        restockSupplierVariantId: row.restockSupplierVariantId ?? null,
        updatedAt: row.decathlonReturn?.updatedAt ?? row.updatedAt,
      })),
    });
  } catch (error: any) {
    console.error("[DECATHLON][RETURNS] Failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to load returns" },
      { status: 500 }
    );
  }
}
