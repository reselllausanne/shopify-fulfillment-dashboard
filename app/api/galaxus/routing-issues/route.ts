import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const prismaAny = prisma as any;
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number(searchParams.get("limit") ?? "50"), 200);
    const offset = Math.max(Number(searchParams.get("offset") ?? "0"), 0);
    const status = searchParams.get("status")?.trim().toUpperCase() ?? "";
    const providerKey = searchParams.get("providerKey")?.trim().toUpperCase() ?? "";

    const where: Record<string, unknown> = {
      ...(status ? { status } : {}),
      ...(providerKey ? { providerKey } : {}),
    };

    const items = await prismaAny.orderRoutingIssue.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: limit,
      skip: offset,
    });
    const total = await prismaAny.orderRoutingIssue.count({ where });
    const unassignedCount = await prismaAny.orderRoutingIssue.count({ where: { status: "UNASSIGNED" } });

    return NextResponse.json({
      ok: true,
      items,
      total,
      unassignedCount,
      nextOffset: items.length === limit ? offset + limit : null,
    });
  } catch (error: any) {
    console.error("[GALAXUS][ROUTING] List failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
