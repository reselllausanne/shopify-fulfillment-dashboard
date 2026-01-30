/**
 * POST /api/orders/update-chain-ids-from-current
 * 
 * Met à jour les matches existants avec chainId/orderId
 * depuis les supplier orders ACTUELLEMENT EN MÉMOIRE (venant du dernier "Load Supplier Orders").
 * 
 * Body: { supplierOrders: NormalizedSupplierOrder[] }
 * 
 * NO AUTH REQUIRED.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { supplierOrders } = body;

    if (!supplierOrders || !Array.isArray(supplierOrders)) {
      return NextResponse.json(
        { error: "Missing or invalid supplierOrders array" },
        { status: 400 }
      );
    }

    console.log(`[UPDATE-CHAINIDS] Received ${supplierOrders.length} supplier orders`);

    // 1. Trouver tous les matches sans chainId
    const matchesNeedingUpdate = await prisma.orderMatch.findMany({
      where: {
        supplierSource: "STOCKX",
        stockxChainId: null,
        stockxOrderNumber: { not: "" }
      },
      select: {
        id: true,
        stockxOrderNumber: true,
        shopifyOrderName: true,
      }
    });

    console.log(`[UPDATE-CHAINIDS] Found ${matchesNeedingUpdate.length} matches needing chainId`);

    if (matchesNeedingUpdate.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No matches need update",
        updated: 0,
      });
    }

    // 2. Créer mapping orderNumber -> IDs depuis supplierOrders
    const orderMap = new Map();
    for (const order of supplierOrders) {
      if (order.supplierOrderNumber && order.chainId) {
        orderMap.set(order.supplierOrderNumber, {
          chainId: order.chainId,
          orderId: order.orderId || order.supplierOrderNumber,
        });
      }
    }

    console.log(`[UPDATE-CHAINIDS] Built map with ${orderMap.size} orders`);

    // 3. Mettre à jour les matches
    let updated = 0;
    let notFound = 0;

    for (const match of matchesNeedingUpdate) {
      const orderData = orderMap.get(match.stockxOrderNumber);

      if (!orderData) {
        console.log(`[UPDATE-CHAINIDS] ⏭️ ${match.stockxOrderNumber} not in current supplier orders`);
        notFound++;
        continue;
      }

      try {
        await prisma.orderMatch.update({
          where: { id: match.id },
          data: {
            stockxChainId: orderData.chainId,
            stockxOrderId: orderData.orderId,
          }
        });

        console.log(
          `[UPDATE-CHAINIDS] ✅ ${match.shopifyOrderName} (${match.stockxOrderNumber}) ` +
          `→ chainId=${orderData.chainId.substring(0, 10)}...`
        );

        updated++;
      } catch (error: any) {
        console.error(`[UPDATE-CHAINIDS] ❌ Failed to update ${match.id}:`, error.message);
      }
    }

    console.log(`[UPDATE-CHAINIDS] ✅ Complete: ${updated} updated, ${notFound} not found`);

    return NextResponse.json({
      success: true,
      processed: matchesNeedingUpdate.length,
      updated,
      notFound,
    });

  } catch (error: any) {
    console.error("[UPDATE-CHAINIDS] Fatal error:", error);
    return NextResponse.json(
      { error: "Update failed", details: error.message },
      { status: 500 }
    );
  }
}

