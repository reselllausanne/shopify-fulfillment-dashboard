import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limitRaw = Number(searchParams.get("limit") ?? "20");
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 100) : 20;
    const staleMinutesRaw = Number(searchParams.get("staleMinutes") ?? "360");
    const staleMinutes = Number.isFinite(staleMinutesRaw)
      ? Math.min(Math.max(Math.trunc(staleMinutesRaw), 5), 60 * 24 * 7)
      : 360;

    const prismaAny = prisma as any;
    const staleCutoff = new Date(Date.now() - staleMinutes * 60 * 1000);

    const [recentRuns, failedListings, staleListings, latestReconcile] = await Promise.all([
      prismaAny.inventorySyncRun?.findMany?.({
        orderBy: { startedAt: "desc" },
        take: limit,
      }) ?? [],
      prismaAny.channelListingState?.findMany?.({
        where: { status: "ERROR" },
        orderBy: { updatedAt: "desc" },
        take: limit,
      }) ?? [],
      prismaAny.channelListingState?.findMany?.({
        where: {
          OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: staleCutoff } }],
          status: { in: ["ACTIVE", "SOLD_OUT", "PENDING"] },
        },
        orderBy: { updatedAt: "desc" },
        take: limit,
      }) ?? [],
      prismaAny.inventorySyncRun?.findFirst?.({
        where: { jobKey: "inventory-reconcile", status: "SUCCESS" },
        orderBy: { startedAt: "desc" },
      }) ?? null,
    ]);

    const latestDrifts =
      latestReconcile && prismaAny.inventoryReconcileDrift?.findMany
        ? await prismaAny.inventoryReconcileDrift.findMany({
            where: { runId: latestReconcile.id },
            orderBy: { createdAt: "desc" },
            take: limit,
          })
        : [];

    return NextResponse.json({
      ok: true,
      staleCutoff: staleCutoff.toISOString(),
      recentRuns,
      failedListings,
      staleListings,
      latestReconcileRun: latestReconcile,
      latestDrifts,
    });
  } catch (error: any) {
    console.error("[INVENTORY][STATUS] Failed", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Inventory status failed" },
      { status: 500 }
    );
  }
}
