import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

/**
 * DELETE /api/db/delete-match
 * 
 * Deletes a match from the database by shopifyLineItemId or match ID.
 */
export async function DELETE(req: Request) {
  try {
    const body = await req.json();
    const { shopifyLineItemId, id } = body;

    if (!shopifyLineItemId && !id) {
      return NextResponse.json(
        { error: "Must provide shopifyLineItemId or id" },
        { status: 400 }
      );
    }

    console.log(`[DB] Deleting match: ${shopifyLineItemId || id}`);

    if (shopifyLineItemId) {
      await prisma.orderMatch.delete({
        where: { shopifyLineItemId },
      });
    } else {
      await prisma.orderMatch.delete({
        where: { id },
      });
    }

    console.log(`[DB] Match deleted successfully`);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: any) {
    console.error("[DB] Error deleting match:", error);
    return NextResponse.json(
      { error: "Failed to delete match", details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/db/delete-match
 * 
 * Batch delete multiple matches (for cleanup).
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { ids, shopifyLineItemIds, deleteAll } = body;

    if (deleteAll === true) {
      console.log(`[DB] ⚠️ Deleting ALL matches (requested by user)`);
      const result = await prisma.orderMatch.deleteMany({});
      return NextResponse.json({ 
        success: true, 
        deleted: result.count,
        message: `Deleted ${result.count} matches` 
      }, { status: 200 });
    }

    if (ids && ids.length > 0) {
      console.log(`[DB] Batch deleting ${ids.length} matches by ID`);
      const result = await prisma.orderMatch.deleteMany({
        where: { id: { in: ids } },
      });
      return NextResponse.json({ 
        success: true, 
        deleted: result.count 
      }, { status: 200 });
    }

    if (shopifyLineItemIds && shopifyLineItemIds.length > 0) {
      console.log(`[DB] Batch deleting ${shopifyLineItemIds.length} matches by lineItemId`);
      const result = await prisma.orderMatch.deleteMany({
        where: { shopifyLineItemId: { in: shopifyLineItemIds } },
      });
      return NextResponse.json({ 
        success: true, 
        deleted: result.count 
      }, { status: 200 });
    }

    return NextResponse.json(
      { error: "No valid deletion criteria provided" },
      { status: 400 }
    );
  } catch (error: any) {
    console.error("[DB] Error batch deleting matches:", error);
    return NextResponse.json(
      { error: "Failed to delete matches", details: error.message },
      { status: 500 }
    );
  }
}

