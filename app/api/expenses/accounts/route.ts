import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/expenses/accounts
 * List all payment accounts
 */
export async function GET() {
  try {
    const accounts = await prisma.paymentAccount.findMany({
      orderBy: {
        name: "asc",
      },
    });
    
    return NextResponse.json({
      success: true,
      count: accounts.length,
      accounts,
    }, { status: 200 });
    
  } catch (error: any) {
    console.error("[ACCOUNTS] Fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch accounts", details: error.message },
      { status: 500 }
    );
  }
}

