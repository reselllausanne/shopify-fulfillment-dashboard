import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const partners = await prisma.partner.findMany({
      where: { active: true },
      select: { id: true, key: true, name: true },
      orderBy: { name: "asc" },
    });
    return NextResponse.json({ ok: true, items: partners });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to load partners" },
      { status: 500 }
    );
  }
}
