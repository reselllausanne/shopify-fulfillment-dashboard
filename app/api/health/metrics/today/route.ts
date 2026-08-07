import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/app/lib/prisma";
import { requireHealthAdmin } from "@/app/lib/healthAdminAuth";

function todayDate(): Date {
  return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
}

export async function GET(req: NextRequest) {
  const denied = await requireHealthAdmin(req);
  if (denied) return denied;

  const localDate = todayDate();
  const [metrics, sleep, activities, nutrition, checkin, accounts] = await Promise.all([
    prisma.healthDailyMetrics.findUnique({ where: { localDate } }),
    prisma.healthSleepSession.findMany({
      where: { localDate },
      orderBy: { endAt: "desc" },
    }),
    prisma.healthActivity.findMany({
      where: { localDate },
      orderBy: { startAt: "asc" },
    }),
    prisma.healthNutritionDaily.findMany({ where: { localDate } }),
    prisma.healthSubjectiveCheckin.findUnique({ where: { localDate } }),
    prisma.healthIntegrationAccount.findMany({
      select: {
        id: true,
        provider: true,
        status: true,
        lastSyncAt: true,
        watermarkAt: true,
      },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    localDate: localDate.toISOString().slice(0, 10),
    metrics,
    sleep,
    activities,
    nutrition,
    checkin,
    accounts,
    plannedTraining: null,
    plannedTrainingStatus: "unsupported",
    plannedTrainingNote:
      "Garmin Training API calendar READ is unsupported on public docs. Manual entry only for now.",
    disclaimer:
      "Observations are not medical diagnoses. Consult a professional for health concerns.",
  });
}
