import {
  TRANSFORM_VERSION,
  asDate,
  asNumber,
  asRecord,
  asString,
  localDateFromIso,
} from "@/healthdata/normalize/common";
import type {
  HealthProviderId,
  NormalizedActivity,
  NormalizedActivityLap,
} from "@/healthdata/types";

function normalizeLaps(value: unknown): NormalizedActivityLap[] {
  if (!Array.isArray(value)) return [];
  const out: NormalizedActivityLap[] = [];
  for (const item of value) {
    const lap = asRecord(item);
    if (!lap) continue;
    const lapIndex = asNumber(lap.lapIndex ?? lap.lap_index);
    if (lapIndex === null) continue;
    out.push({
      lapIndex,
      startAt: asDate(lap.startAt ?? lap.start_at),
      durationSec: asNumber(lap.durationSec ?? lap.duration_sec),
      distanceM: asNumber(lap.distanceM ?? lap.distance_m),
      hrAvg: asNumber(lap.hrAvg ?? lap.hr_avg),
      powerAvg: asNumber(lap.powerAvg ?? lap.power_avg),
    });
  }
  return out;
}

export function normalizeActivityPayload(input: {
  provider: HealthProviderId;
  providerUserId: string;
  providerRecordId: string;
  sourceUpdatedAt: Date | null;
  payload: unknown;
}): NormalizedActivity | null {
  const row = asRecord(input.payload);
  if (!row) return null;

  const startAt = asDate(row.startAt ?? row.start_at);
  if (!startAt) return null;

  const sport = asString(row.sport ?? row.sportName ?? row.activityType) ?? "unknown";
  const endAt = asDate(row.endAt ?? row.end_at);

  return {
    provider: input.provider,
    providerUserId: input.providerUserId,
    providerRecordId: input.providerRecordId,
    sourceUpdatedAt: input.sourceUpdatedAt,
    sport,
    startAt,
    endAt,
    durationSec: asNumber(row.durationSec ?? row.duration_sec),
    distanceM: asNumber(row.distanceM ?? row.distance_m),
    caloriesKcal: asNumber(row.caloriesKcal ?? row.calories_kcal ?? row.calories),
    hrAvg: asNumber(row.hrAvg ?? row.hr_avg ?? row.averageHeartRate),
    hrMax: asNumber(row.hrMax ?? row.hr_max ?? row.maxHeartRate),
    powerAvg: asNumber(row.powerAvg ?? row.power_avg),
    powerMax: asNumber(row.powerMax ?? row.power_max),
    powerNormalized: asNumber(row.powerNormalized ?? row.power_normalized),
    cadenceAvg: asNumber(row.cadenceAvg ?? row.cadence_avg),
    speedAvgMps: asNumber(row.speedAvgMps ?? row.speed_avg_mps),
    elevationGainM: asNumber(row.elevationGainM ?? row.elevation_gain_m),
    trainingEffect: asNumber(row.trainingEffect ?? row.training_effect),
    trainingLoad: asNumber(row.trainingLoad ?? row.training_load),
    temperatureC: asNumber(row.temperatureC ?? row.temperature_c),
    rpe: asNumber(row.rpe),
    localDate: localDateFromIso(asString(row.localDate ?? row.local_date), startAt),
    transformVersion: TRANSFORM_VERSION,
    rawPayload: input.payload,
    laps: normalizeLaps(row.laps),
  };
}
