import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/expenses/categories
 * List all expense categories
 */
export async function GET() {
  try {
    const categories = await prisma.expenseCategory.findMany({
      orderBy: [
        { type: "asc" },
        { name: "asc" },
      ],
    });
    
    return NextResponse.json({
      success: true,
      count: categories.length,
      categories,
    }, { status: 200 });
    
  } catch (error: any) {
    console.error("[CATEGORIES] Fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch categories", details: error.message },
      { status: 500 }
    );
  }
}

