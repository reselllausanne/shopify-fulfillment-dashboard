import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getStaffRoleFromRequest } from "@/app/lib/staffAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const staffRole = await getStaffRoleFromRequest(request);
    if (!staffRole) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
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
