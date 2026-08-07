export type HealthProviderId = "garmin" | "whoop" | "mock_garmin" | "manual" | "mfp_csv";

export type CapabilityStatus = "supported" | "unsupported" | "unconfirmed";

export type DateRange = {
  from: Date;
  to: Date;
};

export type Pkce = {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
};

export type TokenBundle = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  providerUserId: string;
  scope: string | null;
};

export type IntegrationAccountRef = {
  id: string;
  provider: HealthProviderId;
  providerUserId: string;
  accessTokenEnc: string;
  refreshTokenEnc: string | null;
  tokenExpiresAt: Date | null;
  watermarkAt: Date | null;
};

export type RawProviderBatch = {
  resourceType: string;
  records: Array<{
    providerRecordId: string;
    sourceUpdatedAt: Date | null;
    occurredAt: Date | null;
    payload: unknown;
  }>;
};

export type WebhookResult = {
  acknowledged: boolean;
  shouldPull: boolean;
  resourceHints: string[];
  message?: string;
};

export type ProviderCapabilities = {
  provider: HealthProviderId;
  oauth: CapabilityStatus;
  backfill: CapabilityStatus;
  incrementalSync: CapabilityStatus;
  webhooks: CapabilityStatus;
  sleep: CapabilityStatus;
  activities: CapabilityStatus;
  recovery: CapabilityStatus;
  bodyComposition: CapabilityStatus;
  fitFiles: CapabilityStatus;
  /** READ future calendar workouts */
  calendarRead: CapabilityStatus;
  notes: string[];
};

export type NormalizedSleep = {
  provider: HealthProviderId;
  providerUserId: string;
  providerRecordId: string;
  sourceUpdatedAt: Date | null;
  startAt: Date;
  endAt: Date;
  durationMin: number | null;
  timeInBedMin: number | null;
  sleepScore: number | null;
  lightMin: number | null;
  deepMin: number | null;
  remMin: number | null;
  awakeMin: number | null;
  localDate: string;
  transformVersion: string;
  rawPayload: unknown;
};

export type NormalizedActivity = {
  provider: HealthProviderId;
  providerUserId: string;
  providerRecordId: string;
  sourceUpdatedAt: Date | null;
  sport: string;
  startAt: Date;
  endAt: Date | null;
  durationSec: number | null;
  distanceM: number | null;
  caloriesKcal: number | null;
  hrAvg: number | null;
  hrMax: number | null;
  powerAvg: number | null;
  powerMax: number | null;
  powerNormalized: number | null;
  cadenceAvg: number | null;
  speedAvgMps: number | null;
  elevationGainM: number | null;
  trainingEffect: number | null;
  trainingLoad: number | null;
  temperatureC: number | null;
  rpe: number | null;
  localDate: string;
  transformVersion: string;
  rawPayload: unknown;
  laps?: NormalizedActivityLap[];
};

export type NormalizedActivityLap = {
  lapIndex: number;
  startAt: Date | null;
  durationSec: number | null;
  distanceM: number | null;
  hrAvg: number | null;
  powerAvg: number | null;
};

export type NormalizedHealthDaily = {
  provider: HealthProviderId;
  providerUserId: string;
  providerRecordId: string;
  sourceUpdatedAt: Date | null;
  localDate: string;
  restingHr: number | null;
  hrvMs: number | null;
  recoveryScore: number | null;
  stressAvg: number | null;
  bodyBatteryMax: number | null;
  bodyBatteryMin: number | null;
  spo2Avg: number | null;
  respirationAvg: number | null;
  steps: number | null;
  caloriesTotal: number | null;
  intensityMin: number | null;
  transformVersion: string;
  rawPayload: unknown;
};

export type NormalizedBodyMeasurement = {
  provider: HealthProviderId;
  providerUserId: string;
  providerRecordId: string;
  sourceUpdatedAt: Date | null;
  measuredAt: Date;
  localDate: string;
  weightKg: number | null;
  bodyFatPct: number | null;
  muscleMassKg: number | null;
  transformVersion: string;
  rawPayload: unknown;
};
