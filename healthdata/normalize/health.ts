import {
  TRANSFORM_VERSION,
  asNumber,
  asRecord,
  asString,
  localDateFromIso,
} from "@/healthdata/normalize/common";
import type { HealthProviderId, NormalizedHealthDaily } from "@/healthdata/types";

export function normalizeHealthDailyPayload(input: {
  provider: HealthProviderId;
  providerUserId: string;
  providerRecordId: string;
  sourceUpdatedAt: Date | null;
  payload: unknown;
  localDateHint?: string;
}): NormalizedHealthDaily | null {
  const row = asRecord(input.payload);
  if (!row) return null;

  const localDate = localDateFromIso(
    asString(row.localDate ?? row.local_date) ?? input.localDateHint ?? null,
    new Date()
  );

  return {
    provider: input.provider,
    providerUserId: input.providerUserId,
    providerRecordId: input.providerRecordId,
    sourceUpdatedAt: input.sourceUpdatedAt,
    localDate,
    restingHr: asNumber(row.restingHr ?? row.resting_hr ?? row.restingHeartRate),
    hrvMs: asNumber(row.hrvMs ?? row.hrv_ms ?? row.hrvRmssdMilli),
    recoveryScore: asNumber(row.recoveryScore ?? row.recovery_score),
    stressAvg: asNumber(row.stressAvg ?? row.stress_avg),
    bodyBatteryMax: asNumber(row.bodyBatteryMax ?? row.body_battery_max),
    bodyBatteryMin: asNumber(row.bodyBatteryMin ?? row.body_battery_min),
    spo2Avg: asNumber(row.spo2Avg ?? row.spo2_avg),
    respirationAvg: asNumber(row.respirationAvg ?? row.respiration_avg ?? row.respiratoryRate),
    steps: asNumber(row.steps),
    caloriesTotal: asNumber(row.caloriesTotal ?? row.calories_total),
    intensityMin: asNumber(row.intensityMin ?? row.intensity_min),
    transformVersion: TRANSFORM_VERSION,
    rawPayload: input.payload,
  };
}
