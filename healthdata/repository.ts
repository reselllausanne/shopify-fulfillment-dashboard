import { randomUUID } from "node:crypto";

import { prisma } from "@/app/lib/prisma";
import { encryptSecret } from "@/healthdata/crypto/tokens";
import { toJsonSafe } from "@/healthdata/json";
import type {
  HealthProviderId,
  NormalizedActivity,
  NormalizedBodyMeasurement,
  NormalizedHealthDaily,
  NormalizedSleep,
  TokenBundle,
} from "@/healthdata/types";

function dateOnly(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

export async function upsertIntegrationAccount(input: {
  provider: HealthProviderId;
  tokens: TokenBundle;
  displayName?: string | null;
}): Promise<{ id: string; provider: string; providerUserId: string }> {
  const accessTokenEnc = encryptSecret(input.tokens.accessToken);
  const refreshTokenEnc = input.tokens.refreshToken
    ? encryptSecret(input.tokens.refreshToken)
    : null;

  const row = await prisma.healthIntegrationAccount.upsert({
    where: {
      provider_providerUserId: {
        provider: input.provider,
        providerUserId: input.tokens.providerUserId,
      },
    },
    create: {
      id: randomUUID(),
      provider: input.provider,
      providerUserId: input.tokens.providerUserId,
      displayName: input.displayName ?? null,
      status: "connected",
      accessTokenEnc,
      refreshTokenEnc,
      tokenExpiresAt: input.tokens.expiresAt,
      scope: input.tokens.scope,
    },
    update: {
      status: "connected",
      accessTokenEnc,
      refreshTokenEnc,
      tokenExpiresAt: input.tokens.expiresAt,
      scope: input.tokens.scope,
      displayName: input.displayName ?? undefined,
      lastError: null,
    },
  });

  return { id: row.id, provider: row.provider, providerUserId: row.providerUserId };
}

export async function listIntegrationAccounts() {
  return prisma.healthIntegrationAccount.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      provider: true,
      providerUserId: true,
      displayName: true,
      status: true,
      scope: true,
      watermarkAt: true,
      lastSyncAt: true,
      lastError: true,
      tokenExpiresAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function getAccountById(id: string) {
  return prisma.healthIntegrationAccount.findUnique({ where: { id } });
}

export async function upsertRawEvent(input: {
  provider: string;
  providerUserId: string;
  providerRecordId: string;
  resourceType: string;
  sourceUpdatedAt: Date | null;
  occurredAt: Date | null;
  payload: unknown;
  transformVersion: string;
  syncRunId: string | null;
}): Promise<"inserted" | "updated" | "ignored"> {
  const existing = await prisma.healthRawProviderEvent.findUnique({
    where: {
      provider_providerUserId_resourceType_providerRecordId: {
        provider: input.provider,
        providerUserId: input.providerUserId,
        resourceType: input.resourceType,
        providerRecordId: input.providerRecordId,
      },
    },
  });

  if (
    existing?.sourceUpdatedAt &&
    input.sourceUpdatedAt &&
    existing.sourceUpdatedAt.getTime() > input.sourceUpdatedAt.getTime()
  ) {
    return "ignored";
  }

  await prisma.healthRawProviderEvent.upsert({
    where: {
      provider_providerUserId_resourceType_providerRecordId: {
        provider: input.provider,
        providerUserId: input.providerUserId,
        resourceType: input.resourceType,
        providerRecordId: input.providerRecordId,
      },
    },
    create: {
      id: randomUUID(),
      provider: input.provider,
      providerUserId: input.providerUserId,
      providerRecordId: input.providerRecordId,
      resourceType: input.resourceType,
      sourceUpdatedAt: input.sourceUpdatedAt,
      occurredAt: input.occurredAt,
      payloadJson: toJsonSafe(input.payload) as object,
      transformVersion: input.transformVersion,
      syncRunId: input.syncRunId,
    },
    update: {
      sourceUpdatedAt: input.sourceUpdatedAt,
      occurredAt: input.occurredAt,
      payloadJson: toJsonSafe(input.payload) as object,
      transformVersion: input.transformVersion,
      syncRunId: input.syncRunId,
      syncedAt: new Date(),
    },
  });

  return existing ? "updated" : "inserted";
}

export async function upsertSleep(row: NormalizedSleep): Promise<void> {
  await prisma.healthSleepSession.upsert({
    where: {
      provider_providerUserId_providerRecordId: {
        provider: row.provider,
        providerUserId: row.providerUserId,
        providerRecordId: row.providerRecordId,
      },
    },
    create: {
      id: randomUUID(),
      provider: row.provider,
      providerUserId: row.providerUserId,
      providerRecordId: row.providerRecordId,
      sourceUpdatedAt: row.sourceUpdatedAt,
      startAt: row.startAt,
      endAt: row.endAt,
      localDate: dateOnly(row.localDate),
      durationMin: row.durationMin,
      timeInBedMin: row.timeInBedMin,
      sleepScore: row.sleepScore,
      lightMin: row.lightMin,
      deepMin: row.deepMin,
      remMin: row.remMin,
      awakeMin: row.awakeMin,
      transformVersion: row.transformVersion,
      rawPayload: toJsonSafe(row.rawPayload) as object,
    },
    update: {
      sourceUpdatedAt: row.sourceUpdatedAt,
      syncedAt: new Date(),
      startAt: row.startAt,
      endAt: row.endAt,
      localDate: dateOnly(row.localDate),
      durationMin: row.durationMin,
      timeInBedMin: row.timeInBedMin,
      sleepScore: row.sleepScore,
      lightMin: row.lightMin,
      deepMin: row.deepMin,
      remMin: row.remMin,
      awakeMin: row.awakeMin,
      transformVersion: row.transformVersion,
      rawPayload: toJsonSafe(row.rawPayload) as object,
    },
  });
}

export async function upsertActivity(row: NormalizedActivity): Promise<string> {
  const saved = await prisma.healthActivity.upsert({
    where: {
      provider_providerUserId_providerRecordId: {
        provider: row.provider,
        providerUserId: row.providerUserId,
        providerRecordId: row.providerRecordId,
      },
    },
    create: {
      id: randomUUID(),
      provider: row.provider,
      providerUserId: row.providerUserId,
      providerRecordId: row.providerRecordId,
      sourceUpdatedAt: row.sourceUpdatedAt,
      sport: row.sport,
      startAt: row.startAt,
      endAt: row.endAt,
      localDate: dateOnly(row.localDate),
      durationSec: row.durationSec,
      distanceM: row.distanceM,
      caloriesKcal: row.caloriesKcal,
      hrAvg: row.hrAvg,
      hrMax: row.hrMax,
      powerAvg: row.powerAvg,
      powerMax: row.powerMax,
      powerNormalized: row.powerNormalized,
      cadenceAvg: row.cadenceAvg,
      speedAvgMps: row.speedAvgMps,
      elevationGainM: row.elevationGainM,
      trainingEffect: row.trainingEffect,
      trainingLoad: row.trainingLoad,
      temperatureC: row.temperatureC,
      rpe: row.rpe,
      transformVersion: row.transformVersion,
      rawPayload: toJsonSafe(row.rawPayload) as object,
    },
    update: {
      sourceUpdatedAt: row.sourceUpdatedAt,
      syncedAt: new Date(),
      sport: row.sport,
      startAt: row.startAt,
      endAt: row.endAt,
      localDate: dateOnly(row.localDate),
      durationSec: row.durationSec,
      distanceM: row.distanceM,
      caloriesKcal: row.caloriesKcal,
      hrAvg: row.hrAvg,
      hrMax: row.hrMax,
      powerAvg: row.powerAvg,
      powerMax: row.powerMax,
      powerNormalized: row.powerNormalized,
      cadenceAvg: row.cadenceAvg,
      speedAvgMps: row.speedAvgMps,
      elevationGainM: row.elevationGainM,
      trainingEffect: row.trainingEffect,
      trainingLoad: row.trainingLoad,
      temperatureC: row.temperatureC,
      rpe: row.rpe,
      transformVersion: row.transformVersion,
      rawPayload: toJsonSafe(row.rawPayload) as object,
    },
  });

  if (row.laps?.length) {
    for (const lap of row.laps) {
      await prisma.healthActivityLap.upsert({
        where: {
          activityId_lapIndex: { activityId: saved.id, lapIndex: lap.lapIndex },
        },
        create: {
          id: randomUUID(),
          activityId: saved.id,
          lapIndex: lap.lapIndex,
          startAt: lap.startAt,
          durationSec: lap.durationSec,
          distanceM: lap.distanceM,
          hrAvg: lap.hrAvg,
          powerAvg: lap.powerAvg,
        },
        update: {
          startAt: lap.startAt,
          durationSec: lap.durationSec,
          distanceM: lap.distanceM,
          hrAvg: lap.hrAvg,
          powerAvg: lap.powerAvg,
        },
      });
    }
  }

  return saved.id;
}

export async function upsertBody(row: NormalizedBodyMeasurement): Promise<void> {
  await prisma.healthBodyMeasurement.upsert({
    where: {
      provider_providerUserId_providerRecordId: {
        provider: row.provider,
        providerUserId: row.providerUserId,
        providerRecordId: row.providerRecordId,
      },
    },
    create: {
      id: randomUUID(),
      provider: row.provider,
      providerUserId: row.providerUserId,
      providerRecordId: row.providerRecordId,
      sourceUpdatedAt: row.sourceUpdatedAt,
      measuredAt: row.measuredAt,
      localDate: dateOnly(row.localDate),
      weightKg: row.weightKg,
      bodyFatPct: row.bodyFatPct,
      muscleMassKg: row.muscleMassKg,
      transformVersion: row.transformVersion,
      rawPayload: toJsonSafe(row.rawPayload) as object,
    },
    update: {
      sourceUpdatedAt: row.sourceUpdatedAt,
      syncedAt: new Date(),
      measuredAt: row.measuredAt,
      localDate: dateOnly(row.localDate),
      weightKg: row.weightKg,
      bodyFatPct: row.bodyFatPct,
      muscleMassKg: row.muscleMassKg,
      transformVersion: row.transformVersion,
      rawPayload: toJsonSafe(row.rawPayload) as object,
    },
  });
}

/** Merge provider daily health fields into health_daily_metrics for a date. */
export async function mergeDailyFromHealth(row: NormalizedHealthDaily): Promise<void> {
  const localDate = dateOnly(row.localDate);
  await prisma.healthDailyMetrics.upsert({
    where: { localDate },
    create: {
      id: randomUUID(),
      localDate,
      restingHr: row.restingHr,
      hrvMs: row.hrvMs,
      recoveryScore: row.recoveryScore,
      stressAvg: row.stressAvg,
      bodyBatteryMax: row.bodyBatteryMax,
      steps: row.steps != null ? Math.round(row.steps) : null,
      caloriesBurned: row.caloriesTotal,
      sourcesJson: { health: row.provider } as object,
    },
    update: {
      restingHr: row.restingHr ?? undefined,
      hrvMs: row.hrvMs ?? undefined,
      recoveryScore: row.recoveryScore ?? undefined,
      stressAvg: row.stressAvg ?? undefined,
      bodyBatteryMax: row.bodyBatteryMax ?? undefined,
      steps: row.steps != null ? Math.round(row.steps) : undefined,
      caloriesBurned: row.caloriesTotal ?? undefined,
      computedAt: new Date(),
    },
  });
}

export async function recomputeDailyWindow(fromDate: string, toDate: string): Promise<number> {
  const from = dateOnly(fromDate);
  const to = dateOnly(toDate);
  const sleeps = await prisma.healthSleepSession.findMany({
    where: { localDate: { gte: from, lte: to } },
  });
  const activities = await prisma.healthActivity.findMany({
    where: { localDate: { gte: from, lte: to } },
  });
  const bodies = await prisma.healthBodyMeasurement.findMany({
    where: { localDate: { gte: from, lte: to } },
  });
  const nutrition = await prisma.healthNutritionDaily.findMany({
    where: { localDate: { gte: from, lte: to } },
  });
  const checkins = await prisma.healthSubjectiveCheckin.findMany({
    where: { localDate: { gte: from, lte: to } },
  });

  const dates = new Set<string>();
  for (const s of sleeps) dates.add(s.localDate.toISOString().slice(0, 10));
  for (const a of activities) dates.add(a.localDate.toISOString().slice(0, 10));
  for (const b of bodies) dates.add(b.localDate.toISOString().slice(0, 10));
  for (const n of nutrition) dates.add(n.localDate.toISOString().slice(0, 10));
  for (const c of checkins) dates.add(c.localDate.toISOString().slice(0, 10));

  let written = 0;
  for (const d of [...dates].sort()) {
    const localDate = dateOnly(d);
    const daySleeps = sleeps.filter((s) => s.localDate.toISOString().slice(0, 10) === d);
    const dayActs = activities.filter((a) => a.localDate.toISOString().slice(0, 10) === d);
    const dayBody = bodies.filter((b) => b.localDate.toISOString().slice(0, 10) === d);
    const dayNutr = nutrition.filter((n) => n.localDate.toISOString().slice(0, 10) === d);
    const dayCheck = checkins.find((c) => c.localDate.toISOString().slice(0, 10) === d);

    const sleepMin =
      daySleeps.reduce((acc, s) => acc + (s.durationMin ?? 0), 0) || null;
    const sleepScore =
      daySleeps.length > 0
        ? daySleeps.reduce((acc, s) => acc + (s.sleepScore ?? 0), 0) / daySleeps.length
        : null;
    const trainingLoad = dayActs.reduce((acc, a) => acc + (a.trainingLoad ?? 0), 0);
    const weightKg = dayBody.find((b) => b.weightKg != null)?.weightKg ?? null;
    const nutr = dayNutr[0];

    const existing = await prisma.healthDailyMetrics.findUnique({ where: { localDate } });

    await prisma.healthDailyMetrics.upsert({
      where: { localDate },
      create: {
        id: randomUUID(),
        localDate,
        sleepMin,
        sleepScore,
        weightKg,
        trainingLoad: trainingLoad || null,
        activityCount: dayActs.length,
        caloriesConsumed: nutr?.caloriesKcal ?? null,
        carbsG: nutr?.carbsG ?? null,
        proteinG: nutr?.proteinG ?? null,
        fatG: nutr?.fatG ?? null,
        rpeAvg: dayCheck?.rpeSession ?? null,
        restingHr: existing?.restingHr ?? null,
        hrvMs: existing?.hrvMs ?? null,
        recoveryScore: existing?.recoveryScore ?? null,
      },
      update: {
        sleepMin,
        sleepScore,
        weightKg: weightKg ?? undefined,
        trainingLoad: trainingLoad || null,
        activityCount: dayActs.length,
        caloriesConsumed: nutr?.caloriesKcal ?? undefined,
        carbsG: nutr?.carbsG ?? undefined,
        proteinG: nutr?.proteinG ?? undefined,
        fatG: nutr?.fatG ?? undefined,
        rpeAvg: dayCheck?.rpeSession ?? undefined,
        computedAt: new Date(),
      },
    });

    await prisma.healthDailyTrainingLoad.upsert({
      where: { localDate },
      create: {
        id: randomUUID(),
        localDate,
        loadSum: trainingLoad,
        durationSec: dayActs.reduce((acc, a) => acc + (a.durationSec ?? 0), 0),
        activityCount: dayActs.length,
      },
      update: {
        loadSum: trainingLoad,
        durationSec: dayActs.reduce((acc, a) => acc + (a.durationSec ?? 0), 0),
        activityCount: dayActs.length,
      },
    });

    written += 1;
  }

  // Acute/chronic ratios after window rewrite
  const loads = await prisma.healthDailyTrainingLoad.findMany({
    where: { localDate: { gte: from, lte: to } },
    orderBy: { localDate: "asc" },
  });
  const allLoads = await prisma.healthDailyTrainingLoad.findMany({
    orderBy: { localDate: "asc" },
  });
  for (const row of loads) {
    const idx = allLoads.findIndex((l) => l.id === row.id);
    const slice7 = allLoads.slice(Math.max(0, idx - 6), idx + 1);
    const slice28 = allLoads.slice(Math.max(0, idx - 27), idx + 1);
    const acute7d = slice7.reduce((a, l) => a + l.loadSum, 0) / Math.max(slice7.length, 1);
    const chronic28d = slice28.reduce((a, l) => a + l.loadSum, 0) / Math.max(slice28.length, 1);
    const ratio = chronic28d > 0 ? acute7d / chronic28d : null;
    await prisma.healthDailyTrainingLoad.update({
      where: { id: row.id },
      data: { acute7d, chronic28d, ratio },
    });
  }

  return written;
}

export async function touchAccountSync(
  accountId: string,
  watermarkAt: Date,
  error: string | null
): Promise<void> {
  await prisma.healthIntegrationAccount.update({
    where: { id: accountId },
    data: {
      watermarkAt,
      lastSyncAt: new Date(),
      lastError: error,
      status: error ? "error" : "connected",
    },
  });
}

export async function getDebugSnapshot() {
  const [accounts, runs, rawCount, sleepCount, activityCount, coverage] = await Promise.all([
    listIntegrationAccounts(),
    prisma.healthIntegrationSyncRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 30,
    }),
    prisma.healthRawProviderEvent.count(),
    prisma.healthSleepSession.count(),
    prisma.healthActivity.count(),
    prisma.healthDailyMetrics.aggregate({
      _min: { localDate: true },
      _max: { localDate: true },
      _count: true,
    }),
  ]);

  const failed = runs.filter((r) => r.status === "failed").length;
  const ignoredApprox = runs.reduce((acc, r) => {
    const stats = (r.statsJson ?? {}) as Record<string, unknown>;
    return acc + (typeof stats.ignored === "number" ? stats.ignored : 0);
  }, 0);

  return {
    accounts,
    recentRuns: runs,
    counts: {
      rawEvents: rawCount,
      sleepSessions: sleepCount,
      activities: activityCount,
      dailyMetrics: coverage._count,
      failedRuns: failed,
      ignoredRecords: ignoredApprox,
    },
    coverage: {
      minDate: coverage._min.localDate,
      maxDate: coverage._max.localDate,
    },
  };
}
