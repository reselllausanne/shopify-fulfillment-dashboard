import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/expenses
 * Create a new personal expense
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    // Validation
    const { date, amount, currencyCode, categoryId, accountId, note, isBusiness } = body;
    
    if (!date || !amount || !categoryId || !accountId) {
      return NextResponse.json(
        { error: "Missing required fields: date, amount, categoryId, accountId" },
        { status: 400 }
      );
    }
    
    // Validate amount is a positive number
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return NextResponse.json(
        { error: "Amount must be a positive number" },
        { status: 400 }
      );
    }
    
    // Validate date format
    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      return NextResponse.json(
        { error: "Invalid date format. Use YYYY-MM-DD or ISO8601" },
        { status: 400 }
      );
    }
    
    // Verify category exists
    const category = await prisma.expenseCategory.findUnique({
      where: { id: categoryId },
    });
    
    if (!category) {
      return NextResponse.json(
        { error: `Category not found: ${categoryId}` },
        { status: 404 }
      );
    }
    
    // Verify account exists
    const account = await prisma.paymentAccount.findUnique({
      where: { id: accountId },
    });
    
    if (!account) {
      return NextResponse.json(
        { error: `Payment account not found: ${accountId}` },
        { status: 404 }
      );
    }
    
    // Create expense
    const expense = await prisma.personalExpense.create({
      data: {
        date: parsedDate,
        amount: new Prisma.Decimal(amountNum),
        currencyCode: currencyCode || "CHF",
        categoryId,
        accountId,
        note: note || null,
        isBusiness: isBusiness || false,
      },
      include: {
        category: true,
        account: true,
      },
    });
    
    console.log(`[EXPENSE] Created: ${expense.id} - ${expense.amount} ${expense.currencyCode} (${category.name})`);
    
    return NextResponse.json({
      success: true,
      expense: {
        ...expense,
        amount: expense.amount.toNumber(), // Convert Decimal to number for JSON
      },
    }, { status: 201 });
    
  } catch (error: any) {
    console.error("[EXPENSE] Create error:", error);
    return NextResponse.json(
      { error: "Failed to create expense", details: error.message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/expenses?from=YYYY-MM-DD&to=YYYY-MM-DD&category=id&account=id&isBusiness=true
 * List expenses with optional filters
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const categoryId = searchParams.get("category");
    const accountId = searchParams.get("account");
    const isBusinessStr = searchParams.get("isBusiness");
    
    // Build where clause
    const where: any = {};
    
    // Date range filter
    if (from || to) {
      where.date = {};
      if (from) {
        const fromDate = new Date(from);
        if (!isNaN(fromDate.getTime())) {
          where.date.gte = fromDate;
        }
      }
      if (to) {
        const toDate = new Date(to);
        if (!isNaN(toDate.getTime())) {
          // Set to end of day
          toDate.setHours(23, 59, 59, 999);
          where.date.lte = toDate;
        }
      }
    }
    
    // Category filter
    if (categoryId) {
      where.categoryId = categoryId;
    }
    
    // Account filter
    if (accountId) {
      where.accountId = accountId;
    }
    
    // Business filter
    if (isBusinessStr !== null) {
      where.isBusiness = isBusinessStr === "true";
    }
    
    // Fetch expenses
    const expenses = await prisma.personalExpense.findMany({
      where,
      include: {
        category: true,
        account: true,
      },
      orderBy: {
        date: "desc",
      },
      take: 500, // Limit to 500 results (AppSheet compatibility)
    });
    
    // Convert Decimal amounts to numbers for JSON
    const expensesJson = expenses.map((exp: (typeof expenses)[number]) => ({
      ...exp,
      amount: exp.amount.toNumber(),
    }));
    
    console.log(`[EXPENSE] Fetched ${expenses.length} expenses`);
    
    return NextResponse.json({
      success: true,
      count: expenses.length,
      expenses: expensesJson,
      filters: {
        from: from || null,
        to: to || null,
        categoryId: categoryId || null,
        accountId: accountId || null,
        isBusiness: isBusinessStr || null,
      },
    }, { status: 200 });
    
  } catch (error: any) {
    console.error("[EXPENSE] Fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch expenses", details: error.message },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/expenses
 * Update an existing expense
 */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, date, amount, currencyCode, categoryId, accountId, note, isBusiness } = body;
    
    if (!id) {
      return NextResponse.json(
        { error: "Missing required field: id" },
        { status: 400 }
      );
    }
    
    // Prepare update data
    const updateData: any = {};
    
    if (date) {
      const parsedDate = new Date(date);
      if (isNaN(parsedDate.getTime())) {
        return NextResponse.json(
          { error: "Invalid date format" },
          { status: 400 }
        );
      }
      updateData.date = parsedDate;
    }
    
    if (amount !== undefined) {
      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        return NextResponse.json(
          { error: "Amount must be a positive number" },
          { status: 400 }
        );
      }
      updateData.amount = new Prisma.Decimal(amountNum);
    }
    
    if (currencyCode) updateData.currencyCode = currencyCode;
    if (categoryId) updateData.categoryId = categoryId;
    if (accountId) updateData.accountId = accountId;
    if (note !== undefined) updateData.note = note || null;
    if (isBusiness !== undefined) updateData.isBusiness = isBusiness;
    
    updateData.updatedAt = new Date();
    
    const expense = await prisma.personalExpense.update({
      where: { id },
      data: updateData,
      include: {
        category: true,
        account: true,
      },
    });
    
    console.log(`[EXPENSE] Updated: ${expense.id}`);
    
    return NextResponse.json({
      success: true,
      expense: {
        ...expense,
        amount: expense.amount.toNumber(),
      },
    }, { status: 200 });
    
  } catch (error: any) {
    console.error("[EXPENSE] Update error:", error);
    return NextResponse.json(
      { error: "Failed to update expense", details: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/expenses?id=uuid
 * Delete an expense
 */
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    
    if (!id) {
      return NextResponse.json(
        { error: "Missing required parameter: id" },
        { status: 400 }
      );
    }
    
    await prisma.personalExpense.delete({
      where: { id },
    });
    
    console.log(`[EXPENSE] Deleted: ${id}`);
    
    return NextResponse.json({
      success: true,
      message: "Expense deleted",
    }, { status: 200 });
    
  } catch (error: any) {
    console.error("[EXPENSE] Delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete expense", details: error.message },
      { status: 500 }
    );
  }
}

