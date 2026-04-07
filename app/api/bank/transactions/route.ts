import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const parseDateParam = (value: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get("accountId");
    const from = parseDateParam(searchParams.get("from"));
    const to = parseDateParam(searchParams.get("to"));

    const where: any = {};
    if (accountId) where.bankAccountId = accountId;
    if (from || to) {
      where.bookingDate = {};
      if (from) where.bookingDate.gte = from;
      if (to) where.bookingDate.lte = to;
    }

    const items = await prisma.bankTransaction.findMany({
      where,
      orderBy: { bookingDate: "desc" },
      take: 1000,
    });

    return NextResponse.json({ success: true, items });
  } catch (error: any) {
    console.error("[BANK][TRANSACTIONS] GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch bank transactions", details: error.message },
      { status: 500 }
    );
  }
}
