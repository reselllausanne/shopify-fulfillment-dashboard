import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? "50"), 500);
  const offset = Math.max(Number(searchParams.get("offset") ?? "0"), 0);

  const items = await prisma.supplierVariant.findMany({
    orderBy: { updatedAt: "desc" },
    take: limit,
    skip: offset,
  });

  const nextOffset = items.length === limit ? offset + limit : null;
  return NextResponse.json({ ok: true, items, nextOffset });
}
