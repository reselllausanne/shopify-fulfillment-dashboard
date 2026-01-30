import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/expenses/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Get expense summaries: daily totals + category totals
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    
    // Build date filter
    const dateFilter: any = {};
    if (from) {
      const fromDate = new Date(from);
      if (!isNaN(fromDate.getTime())) {
        dateFilter.gte = fromDate;
      }
    }
    if (to) {
      const toDate = new Date(to);
      if (!isNaN(toDate.getTime())) {
        toDate.setHours(23, 59, 59, 999);
        dateFilter.lte = toDate;
      }
    }
    
    const where = Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {};
    
    // Fetch all expenses in range
    const expenses = await prisma.personalExpense.findMany({
      where,
      include: {
        category: true,
        account: true,
      },
      orderBy: {
        date: "asc",
      },
    });
    
    // Aggregate by day
    const dailyTotals: Record<string, { date: string; total: number; count: number; personal: number; business: number }> = {};
    
    // Aggregate by category
    const categoryTotals: Record<string, { categoryId: string; categoryName: string; type: string; total: number; count: number }> = {};
    
    // Aggregate by account
    const accountTotals: Record<string, { accountId: string; accountName: string; total: number; count: number }> = {};
    
    // Process expenses
    for (const exp of expenses) {
      const dateKey = exp.date.toISOString().split("T")[0]; // YYYY-MM-DD
      const amount = exp.amount.toNumber();
      
      // Daily totals
      if (!dailyTotals[dateKey]) {
        dailyTotals[dateKey] = {
          date: dateKey,
          total: 0,
          count: 0,
          personal: 0,
          business: 0,
        };
      }
      dailyTotals[dateKey].total += amount;
      dailyTotals[dateKey].count += 1;
      if (exp.isBusiness) {
        dailyTotals[dateKey].business += amount;
      } else {
        dailyTotals[dateKey].personal += amount;
      }
      
      // Category totals
      if (!categoryTotals[exp.categoryId]) {
        categoryTotals[exp.categoryId] = {
          categoryId: exp.categoryId,
          categoryName: exp.category.name,
          type: exp.category.type,
          total: 0,
          count: 0,
        };
      }
      categoryTotals[exp.categoryId].total += amount;
      categoryTotals[exp.categoryId].count += 1;
      
      // Account totals
      if (!accountTotals[exp.accountId]) {
        accountTotals[exp.accountId] = {
          accountId: exp.accountId,
          accountName: exp.account.name,
          total: 0,
          count: 0,
        };
      }
      accountTotals[exp.accountId].total += amount;
      accountTotals[exp.accountId].count += 1;
    }
    
    // Calculate overall totals
    const grandTotal = expenses.reduce((sum, exp) => sum + exp.amount.toNumber(), 0);
    const personalTotal = expenses
      .filter(exp => !exp.isBusiness)
      .reduce((sum, exp) => sum + exp.amount.toNumber(), 0);
    const businessTotal = expenses
      .filter(exp => exp.isBusiness)
      .reduce((sum, exp) => sum + exp.amount.toNumber(), 0);
    
    // Format and sort results
    const dailyArray = Object.values(dailyTotals)
      .map(day => ({
        ...day,
        total: Number(day.total.toFixed(2)),
        personal: Number(day.personal.toFixed(2)),
        business: Number(day.business.toFixed(2)),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    
    const categoryArray = Object.values(categoryTotals)
      .map(cat => ({
        ...cat,
        total: Number(cat.total.toFixed(2)),
      }))
      .sort((a, b) => b.total - a.total); // Sort by total DESC
    
    const accountArray = Object.values(accountTotals)
      .map(acc => ({
        ...acc,
        total: Number(acc.total.toFixed(2)),
      }))
      .sort((a, b) => b.total - a.total); // Sort by total DESC
    
    console.log(`[EXPENSE SUMMARY] Processed ${expenses.length} expenses`);
    console.log(`[EXPENSE SUMMARY] Total: CHF ${grandTotal.toFixed(2)} (Personal: ${personalTotal.toFixed(2)}, Business: ${businessTotal.toFixed(2)})`);
    
    return NextResponse.json({
      success: true,
      period: {
        from: from || null,
        to: to || null,
      },
      totals: {
        grand: Number(grandTotal.toFixed(2)),
        personal: Number(personalTotal.toFixed(2)),
        business: Number(businessTotal.toFixed(2)),
        count: expenses.length,
      },
      daily: dailyArray,
      byCategory: categoryArray,
      byAccount: accountArray,
    }, { status: 200 });
    
  } catch (error: any) {
    console.error("[EXPENSE SUMMARY] Error:", error);
    return NextResponse.json(
      { error: "Failed to generate summary", details: error.message },
      { status: 500 }
    );
  }
}

