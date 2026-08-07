import {
  TRANSFORM_VERSION,
  asDate,
  asNumber,
  asRecord,
  asString,
  localDateFromIso,
} from "@/healthdata/normalize/common";
import type { HealthProviderId, NormalizedSleep } from "@/healthdata/types";

export function normalizeSleepPayload(input: {
  provider: HealthProviderId;
  providerUserId: string;
  providerRecordId: string;
  sourceUpdatedAt: Date | null;
  payload: unknown;
}): NormalizedSleep | null {
  const row = asRecord(input.payload);
  if (!row) return null;

  const startAt = asDate(row.startAt ?? row.start_at ?? row.sleepStart);
  const endAt = asDate(row.endAt ?? row.end_at ?? row.sleepEnd);
  if (!startAt || !endAt) return null;

  return {
    provider: input.provider,
    providerUserId: input.providerUserId,
    providerRecordId: input.providerRecordId,
    sourceUpdatedAt: input.sourceUpdatedAt,
    startAt,
    endAt,
    durationMin: asNumber(row.durationMin ?? row.duration_min),
    timeInBedMin: asNumber(row.timeInBedMin ?? row.time_in_bed_min),
    sleepScore: asNumber(row.sleepScore ?? row.sleep_score),
    lightMin: asNumber(row.lightMin ?? row.light_min),
    deepMin: asNumber(row.deepMin ?? row.deep_min ?? row.swsMin),
    remMin: asNumber(row.remMin ?? row.rem_min),
    awakeMin: asNumber(row.awakeMin ?? row.awake_min),
    localDate: localDateFromIso(asString(row.localDate ?? row.local_date), endAt),
    transformVersion: TRANSFORM_VERSION,
    rawPayload: input.payload,
  };
}
