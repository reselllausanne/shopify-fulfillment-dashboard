import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/app/lib/prisma";
import { requireHealthAdmin } from "@/app/lib/healthAdminAuth";

export async function GET(req: NextRequest) {
  const denied = await requireHealthAdmin(req);
  if (denied) return denied;

  const days = Math.min(
    180,
    Math.max(7, Number(req.nextUrl.searchParams.get("days") ?? "28") || 28)
  );
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400_000);

  const activities = await prisma.healthActivity.findMany({
    where: { startAt: { gte: from, lte: to } },
    orderBy: { startAt: "desc" },
    include: { laps: { orderBy: { lapIndex: "asc" } } },
    take: 100,
  });

  const enriched = await Promise.all(
    activities.map(async (act) => {
      const windowStart = new Date(act.startAt.getTime() - 4 * 3600_000);
      const nutritionBefore = await prisma.healthNutritionEvent.findMany({
        where: {
          occurredAt: { gte: windowStart, lte: act.startAt },
        },
        orderBy: { occurredAt: "asc" },
      });
      const carbsBeforeG = nutritionBefore.reduce((a, n) => a + (n.carbsG ?? 0), 0);
      const similar = await prisma.healthActivity.findMany({
        where: {
          sport: act.sport,
          id: { not: act.id },
          durationSec: act.durationSec
            ? { gte: Math.round(act.durationSec * 0.8), lte: Math.round(act.durationSec * 1.2) }
            : undefined,
        },
        orderBy: { startAt: "desc" },
        take: 5,
        select: {
          id: true,
          startAt: true,
          distanceM: true,
          hrAvg: true,
          powerAvg: true,
          rpe: true,
          trainingLoad: true,
        },
      });
      return {
        ...act,
        nutritionBefore,
        carbsBeforeG,
        similarSessions: similar,
      };
    })
  );

  return NextResponse.json({ ok: true, days, activities: enriched });
}

export async function PATCH(req: NextRequest) {
  const denied = await requireHealthAdmin(req);
  if (denied) return denied;

  const body = (await req.json()) as { id?: string; rpe?: number; notes?: string };
  if (!body.id) {
    return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  }

  const updated = await prisma.healthActivity.update({
    where: { id: body.id },
    data: {
      rpe: body.rpe ?? undefined,
      notes: body.notes ?? undefined,
    },
  });
  return NextResponse.json({ ok: true, activity: updated });
}
