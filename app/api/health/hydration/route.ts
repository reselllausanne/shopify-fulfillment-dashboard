import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/app/lib/prisma";
import { requireHealthAdmin } from "@/app/lib/healthAdminAuth";
import { computeSweatTest } from "@/healthdata/analytics/sweat";

export async function GET(req: NextRequest) {
  const denied = await requireHealthAdmin(req);
  if (denied) return denied;
  const tests = await prisma.healthHydrationTest.findMany({
    orderBy: { testedAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ ok: true, tests });
}

export async function POST(req: NextRequest) {
  const denied = await requireHealthAdmin(req);
  if (denied) return denied;

  const body = (await req.json()) as {
    testedAt?: string;
    sport: string;
    intensity?: string;
    durationHours: number;
    weightBeforeKg: number;
    weightAfterKg: number;
    fluidConsumedL: number;
    urineProducedL: number;
    temperatureC?: number;
    humidityPct?: number;
    sodiumConsumedMg?: number;
    sweatSodiumMgPerL?: number | null;
    notes?: string;
  };

  try {
    const computed = computeSweatTest({
      weightBeforeKg: body.weightBeforeKg,
      weightAfterKg: body.weightAfterKg,
      fluidConsumedL: body.fluidConsumedL,
      urineProducedL: body.urineProducedL,
      durationHours: body.durationHours,
      sweatSodiumMgPerL: body.sweatSodiumMgPerL,
    });

    const testedAt = body.testedAt ? new Date(body.testedAt) : new Date();
    const localDate = new Date(`${testedAt.toISOString().slice(0, 10)}T00:00:00.000Z`);

    const test = await prisma.healthHydrationTest.create({
      data: {
        id: randomUUID(),
        testedAt,
        localDate,
        sport: body.sport,
        intensity: body.intensity ?? null,
        durationHours: body.durationHours,
        weightBeforeKg: body.weightBeforeKg,
        weightAfterKg: body.weightAfterKg,
        fluidConsumedL: body.fluidConsumedL,
        urineProducedL: body.urineProducedL,
        temperatureC: body.temperatureC ?? null,
        humidityPct: body.humidityPct ?? null,
        sodiumConsumedMg: body.sodiumConsumedMg ?? null,
        sweatSodiumMgPerL: body.sweatSodiumMgPerL ?? null,
        sweatLossL: computed.sweatLossL,
        sweatRateLPerHour: computed.sweatRateLPerHour,
        formulaVersion: computed.formulaVersion,
        notes: body.notes ?? null,
      },
    });

    return NextResponse.json({ ok: true, test });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "failed" },
      { status: 400 }
    );
  }
}
