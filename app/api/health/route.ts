import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Health check endpoint
 * Tests database connectivity and returns system status
 */
export async function GET() {
  const startTime = Date.now();
  
  try {
    // Test database connection with a simple query
    await prisma.$queryRaw`SELECT 1 as health_check`;
    
    const responseTime = Date.now() - startTime;
    
    // Get counts for monitoring
    const [orderMatchCount, expenseCount] = await Promise.all([
      prisma.orderMatch.count(),
      prisma.personalExpense.count().catch(() => 0), // May not exist yet
    ]);
    
    return NextResponse.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      database: {
        connected: true,
        responseTime: `${responseTime}ms`,
        orderMatches: orderMatchCount,
        expenses: expenseCount,
      },
      environment: process.env.NODE_ENV,
      version: "1.0.0",
    }, { status: 200 });
    
  } catch (error: any) {
    const responseTime = Date.now() - startTime;
    
    console.error("[HEALTH] Database connection failed:", error);
    
    return NextResponse.json({
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      database: {
        connected: false,
        responseTime: `${responseTime}ms`,
        error: error.message,
      },
      environment: process.env.NODE_ENV,
      version: "1.0.0",
    }, { status: 503 });
  }
}

