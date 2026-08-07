import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/app/lib/prisma";
import { requireHealthAdmin } from "@/app/lib/healthAdminAuth";
import { recomputeDailyWindow } from "@/healthdata/repository";

export async function GET(req: NextRequest) {
  const denied = await requireHealthAdmin(req);
  if (denied) return denied;
  const rows = await prisma.healthSubjectiveCheckin.findMany({
    orderBy: { localDate: "desc" },
    take: 60,
  });
  return NextResponse.json({ ok: true, checkins: rows });
}

export async function POST(req: NextRequest) {
  const denied = await requireHealthAdmin(req);
  if (denied) return denied;

  const body = (await req.json()) as {
    localDate?: string;
    hunger?: number;
    fatigue?: number;
    motivation?: number;
    pain?: number;
    illness?: boolean;
    rpeSession?: number;
    activityId?: string;
    freeText?: string;
    weightKg?: number;
  };

  const localDateStr = body.localDate ?? new Date().toISOString().slice(0, 10);
  const localDate = new Date(`${localDateStr}T00:00:00.000Z`);

  const checkin = await prisma.healthSubjectiveCheckin.upsert({
    where: { localDate },
    create: {
      id: randomUUID(),
      localDate,
      hunger: body.hunger ?? null,
      fatigue: body.fatigue ?? null,
      motivation: body.motivation ?? null,
      pain: body.pain ?? null,
      illness: Boolean(body.illness),
      rpeSession: body.rpeSession ?? null,
      activityId: body.activityId ?? null,
      freeText: body.freeText ?? null,
    },
    update: {
      hunger: body.hunger ?? undefined,
      fatigue: body.fatigue ?? undefined,
      motivation: body.motivation ?? undefined,
      pain: body.pain ?? undefined,
      illness: body.illness ?? undefined,
      rpeSession: body.rpeSession ?? undefined,
      activityId: body.activityId ?? undefined,
      freeText: body.freeText ?? undefined,
    },
  });

  if (body.weightKg != null) {
    await prisma.healthBodyMeasurement.upsert({
      where: {
        provider_providerUserId_providerRecordId: {
          provider: "manual",
          providerUserId: "self",
          providerRecordId: `weight-${localDateStr}`,
        },
      },
      create: {
        id: randomUUID(),
        provider: "manual",
        providerUserId: "self",
        providerRecordId: `weight-${localDateStr}`,
        measuredAt: new Date(),
        localDate,
        weightKg: body.weightKg,
        transformVersion: "1",
      },
      update: {
        measuredAt: new Date(),
        weightKg: body.weightKg,
        syncedAt: new Date(),
      },
    });
  }

  await recomputeDailyWindow(localDateStr, localDateStr);
  return NextResponse.json({ ok: true, checkin });
}
