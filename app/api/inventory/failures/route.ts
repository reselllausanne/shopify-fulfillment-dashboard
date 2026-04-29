import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limitRaw = Number(searchParams.get("limit") ?? "50");
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200) : 50;
    const prismaAny = prisma as any;

    const [listingErrors, failedRuns] = await Promise.all([
      prismaAny.channelListingState?.findMany?.({
        where: { status: "ERROR" },
        orderBy: { updatedAt: "desc" },
        take: limit,
      }) ?? [],
      prismaAny.inventorySyncRun?.findMany?.({
        where: { status: "FAILED" },
        orderBy: { startedAt: "desc" },
        take: limit,
      }) ?? [],
    ]);

    return NextResponse.json({
      ok: true,
      listingErrors,
      failedRuns,
    });
  } catch (error: any) {
    console.error("[INVENTORY][FAILURES] Failed", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Inventory failures query failed" },
      { status: 500 }
    );
  }
}
