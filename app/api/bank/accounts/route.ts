import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const accounts = await prisma.bankAccount.findMany({
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    });
    return NextResponse.json({ success: true, items: accounts });
  } catch (error: any) {
    console.error("[BANK][ACCOUNTS] GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch bank accounts", details: error.message },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, iban, bankName, currencyCode, accountType, isPrimary, notes } = body;

    if (!name) {
      return NextResponse.json({ error: "Missing account name" }, { status: 400 });
    }

    const account = await prisma.bankAccount.create({
      data: {
        name,
        iban: iban || null,
        bankName: bankName || null,
        currencyCode: currencyCode || "CHF",
        accountType: accountType || "BANK",
        isPrimary: !!isPrimary,
        notes: notes || null,
      },
    });

    return NextResponse.json({ success: true, item: account }, { status: 201 });
  } catch (error: any) {
    console.error("[BANK][ACCOUNTS] POST error:", error);
    return NextResponse.json(
      { error: "Failed to create bank account", details: error.message },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { id } = body;
    if (!id) {
      return NextResponse.json({ error: "Missing account id" }, { status: 400 });
    }

    const update: any = {};
    if (body.name) update.name = body.name;
    if (body.iban !== undefined) update.iban = body.iban || null;
    if (body.bankName !== undefined) update.bankName = body.bankName || null;
    if (body.currencyCode) update.currencyCode = body.currencyCode;
    if (body.accountType) update.accountType = body.accountType;
    if (body.isPrimary !== undefined) update.isPrimary = !!body.isPrimary;
    if (body.notes !== undefined) update.notes = body.notes || null;

    const account = await prisma.bankAccount.update({
      where: { id },
      data: update,
    });

    return NextResponse.json({ success: true, item: account });
  } catch (error: any) {
    console.error("[BANK][ACCOUNTS] PUT error:", error);
    return NextResponse.json(
      { error: "Failed to update bank account", details: error.message },
      { status: 500 }
    );
  }
}
