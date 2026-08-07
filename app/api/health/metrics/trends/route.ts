import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/app/lib/prisma";
import { requireHealthAdmin } from "@/app/lib/healthAdminAuth";

export async function GET(req: NextRequest) {
  const denied = await requireHealthAdmin(req);
  if (denied) return denied;

  const days = Math.min(
    90,
    Math.max(7, Number(req.nextUrl.searchParams.get("days") ?? "28") || 28)
  );
  const to = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  const from = new Date(to.getTime() - (days - 1) * 86400_000);

  const [daily, loads, baselines] = await Promise.all([
    prisma.healthDailyMetrics.findMany({
      where: { localDate: { gte: from, lte: to } },
      orderBy: { localDate: "asc" },
    }),
    prisma.healthDailyTrainingLoad.findMany({
      where: { localDate: { gte: from, lte: to } },
      orderBy: { localDate: "asc" },
    }),
    prisma.healthPersonalBaseline.findMany({
      where: { asOfDate: to },
      orderBy: [{ metricKey: "asc" }, { windowDays: "asc" }],
    }),
  ]);

  return NextResponse.json({
    ok: true,
    days,
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    daily,
    loads,
    baselines,
  });
}
