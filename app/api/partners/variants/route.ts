import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getPartnerSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? "100"), 500);
  const offset = Math.max(Number(searchParams.get("offset") ?? "0"), 0);

  const partner = await (prisma as any).partner.findUnique({
    where: { id: session.partnerId },
  });
  if (!partner?.key) {
    return NextResponse.json({ error: "Partner key missing" }, { status: 400 });
  }
  const prefix = `${partner.key.toLowerCase()}:`;
  const items = await prisma.supplierVariant.findMany({
    where: { supplierVariantId: { startsWith: prefix } },
    orderBy: { updatedAt: "desc" },
    take: limit,
    skip: offset,
  });

  const nextOffset = items.length === limit ? offset + limit : null;
  return NextResponse.json({ ok: true, items, nextOffset });
}
