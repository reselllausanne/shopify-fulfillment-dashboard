/**
 * Health data module configuration.
 * Secrets from environment only. Never log token values.
 */

export type HealthConfig = {
  timezone: string;
  tokenEncryptionKey: string | null;
  garminClientId: string | null;
  garminClientSecret: string | null;
  garminRedirectUri: string | null;
  whoopClientId: string | null;
  whoopClientSecret: string | null;
  whoopRedirectUri: string | null;
  webhookSecret: string | null;
  publicBaseUrl: string | null;
};

export const DEFAULT_TIMEZONE = "Europe/Zurich";
export const TRANSFORM_VERSION = "1";

export class HealthConfigError extends Error {
  readonly missing: string[];

  constructor(missing: string[]) {
    super(`Missing health environment variables: ${missing.join(", ")}`);
    this.name = "HealthConfigError";
    this.missing = missing;
  }
}

function readEnv(key: string): string {
  return (process.env[key] ?? "").trim();
}

export function resolveHealthConfig(): HealthConfig {
  return {
    timezone: readEnv("APP_TIMEZONE") || DEFAULT_TIMEZONE,
    tokenEncryptionKey: readEnv("HEALTH_TOKEN_ENCRYPTION_KEY") || null,
    garminClientId: readEnv("GARMIN_CLIENT_ID") || null,
    garminClientSecret: readEnv("GARMIN_CLIENT_SECRET") || null,
    garminRedirectUri: readEnv("GARMIN_REDIRECT_URI") || null,
    whoopClientId: readEnv("WHOOP_CLIENT_ID") || null,
    whoopClientSecret: readEnv("WHOOP_CLIENT_SECRET") || null,
    whoopRedirectUri: readEnv("WHOOP_REDIRECT_URI") || null,
    webhookSecret: readEnv("HEALTH_WEBHOOK_SECRET") || null,
    publicBaseUrl: readEnv("HEALTH_PUBLIC_BASE_URL") || null,
  };
}

/** Never print a secret; only presence + length. */
export function describeHealthConfig(config: HealthConfig): Record<string, string> {
  const mask = (value: string | null) =>
    value && value.length > 0 ? `set (${value.length} chars)` : "missing";
  return {
    timezone: config.timezone,
    tokenEncryptionKey: mask(config.tokenEncryptionKey),
    garminClientId: mask(config.garminClientId),
    garminClientSecret: mask(config.garminClientSecret),
    garminRedirectUri: config.garminRedirectUri ?? "missing",
    whoopClientId: mask(config.whoopClientId),
    whoopClientSecret: mask(config.whoopClientSecret),
    whoopRedirectUri: config.whoopRedirectUri ?? "missing",
    webhookSecret: mask(config.webhookSecret),
    publicBaseUrl: config.publicBaseUrl ?? "missing",
  };
}
