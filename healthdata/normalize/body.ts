import {
  TRANSFORM_VERSION,
  asDate,
  asNumber,
  asRecord,
  asString,
  localDateFromIso,
} from "@/healthdata/normalize/common";
import type { HealthProviderId, NormalizedBodyMeasurement } from "@/healthdata/types";

export function normalizeBodyPayload(input: {
  provider: HealthProviderId;
  providerUserId: string;
  providerRecordId: string;
  sourceUpdatedAt: Date | null;
  payload: unknown;
}): NormalizedBodyMeasurement | null {
  const row = asRecord(input.payload);
  if (!row) return null;

  const measuredAt = asDate(row.measuredAt ?? row.measured_at ?? row.timestamp);
  if (!measuredAt) return null;

  return {
    provider: input.provider,
    providerUserId: input.providerUserId,
    providerRecordId: input.providerRecordId,
    sourceUpdatedAt: input.sourceUpdatedAt,
    measuredAt,
    localDate: localDateFromIso(asString(row.localDate ?? row.local_date), measuredAt),
    weightKg: asNumber(row.weightKg ?? row.weight_kg ?? row.weight),
    bodyFatPct: asNumber(row.bodyFatPct ?? row.body_fat_pct),
    muscleMassKg: asNumber(row.muscleMassKg ?? row.muscle_mass_kg),
    transformVersion: TRANSFORM_VERSION,
    rawPayload: input.payload,
  };
}
